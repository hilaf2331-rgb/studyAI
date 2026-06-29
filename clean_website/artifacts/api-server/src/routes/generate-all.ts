import { Router } from "express";
import { db, materialsTable, summariesTable, flashcardDecksTable, flashcardsTable, questionSetsTable, questionsTable, activityTable, glossaryTermsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { generateSummary, generateFlashcardsAI, generateQuestionsAI, RateLimitExhaustedError, SystemBlockedError, AIServiceError } from "../lib/ai";
import { logger } from "../lib/logger";
import { MIN_CONTENT_LENGTH, insufficientContentMessage, getDynamicGenerationLimits, looksLikeVocabularyList } from "../lib/validation";
import { generationRateLimiter } from "../lib/rate-limit";
import { requireTokenBalance, deductTokensForGeneration, deductTokensForSummary, InsufficientTokensError } from "../lib/tokens";
import { setGenerationProgress } from "../lib/progress";
import { getExistingQuestionTexts } from "../lib/question-history";
import { parseVocabEntries, generateVocabFlashcards, generateVocabQuiz } from "../lib/vocab";

const router = Router();

// Per-task timeout. Each stage's Gemini work gets its own clock instead of
// sharing one budget, so a single slow stage can't silently swallow the
// others' remaining time. This only bounds a background promise (the 202
// response has already gone out by the time runGenerateAll runs -- see
// below), so it isn't constrained by Render's proxy or any HTTP timeout; it
// just needs to stay comfortably above the worst case for a large, chunked
// document. Every stage (summary, flashcards, questions) now processes the
// document strictly one chunk at a time with a fixed cooldown between them
// (ai.ts), trading speed for reliability against Gemini's 503 "high demand"
// errors. Per-chunk worst case in ai.ts is ~256s (4 attempts x 60s
// ATTEMPT_TIMEOUT_MS + full exponential backoff with jitter), so a
// dozen-plus chunks each hitting that worst case -- extremely unlikely, but
// this is a ceiling, not an estimate -- could take the better part of an
// hour. Sized generously rather than tightly since the cost of cutting a
// real, in-progress generation short is much higher than the cost of a
// stuck job taking longer to time out.
const AI_TASK_TIMEOUT_MS = 1_800_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

type MaterialRow = typeof materialsTable.$inferSelect;

// Practice questions are deliberately capped well below maxQuestions'
// previous dynamic ceiling -- per product direction, a single run is meant
// to feel like one quiz (not an attempt to exhaust every possible question
// from the document), and students are expected to re-run generation for a
// fresh set. Summary and flashcards stay on the dynamic, document-size-aware
// limits below since those two are the priority: thorough, comprehensive
// coverage of the whole document.
//
// The target itself still scales with the document's actual chunk count
// (computeQuestionCount below) -- a fixed single number meant an 80-page
// chunked document and a 2-page one got the same 10-question quiz, even
// though generateQuestionsAI's chunked branch only asks each chunk for a
// couple of questions, so a document with many chunks needs a higher target
// to actually produce a reasonably sized quiz instead of getting trimmed
// back down to (or undershooting) a number sized for a single-chunk document.
const PRACTICE_QUESTION_COUNT_MIN = 10;
const PRACTICE_QUESTION_COUNT_MAX = 20;

function computeQuestionCount(chunkCount: number): number {
  return Math.max(PRACTICE_QUESTION_COUNT_MIN, Math.min(PRACTICE_QUESTION_COUNT_MAX, chunkCount * 2));
}

function userFacingAIErrorMessage(err: unknown, fallbackHe: string): string {
  if (err instanceof RateLimitExhaustedError || err instanceof SystemBlockedError || err instanceof AIServiceError) {
    return err.message;
  }
  return fallbackHe;
}

// Vocab-Kit branch of generate-all: a plain term/definition word list skips
// the summary stage entirely (no narrative to summarize -- see
// summaries.ts), and the flashcards/questions stages call the deterministic
// helpers in lib/vocab.ts instead of Gemini. Kept as a separate function
// rather than threading branches through runGenerateAll below, since the two
// pipelines no longer share a "summary chunks reused by later stages"
// structure once Stage 1 is gone.
async function runGenerateAllVocab(material: MaterialRow, userId: number, content: string): Promise<void> {
  const materialId = material.id;
  const language = "he" as const;

  try {
    const entries = parseVocabEntries(content);

    console.log(`generate-all[${materialId}]: vocab-kit -- generating flashcards for ${entries.length} terms...`);
    const flashResult = generateVocabFlashcards(entries);

    const [deck] = await db.insert(flashcardDecksTable).values({
      materialId,
      title: `${material.title} — כרטיסיות`,
      language,
    }).returning();

    if (flashResult.length > 0 && deck?.id) {
      await db.insert(flashcardsTable).values(
        flashResult.map(c => ({
          deckId: deck.id,
          front: c.front,
          back: c.back,
          difficulty: c.difficulty,
          cardType: c.cardType,
          concept: c.concept,
        }))
      );
    }

    setGenerationProgress(materialId, {
      currentChunk: 0, totalChunks: 0, percentage: 50, stage: "running",
      result: { deck: deck?.id ? { id: deck.id, cardCount: flashResult.length } : undefined },
    });

    const practiceQuestionCount = computeQuestionCount(Math.ceil(entries.length / 4));
    console.log(`generate-all[${materialId}]: vocab-kit -- generating ${practiceQuestionCount} quiz questions...`);
    const questionResult = generateVocabQuiz(entries, practiceQuestionCount);

    const [qSet] = await db.insert(questionSetsTable).values({
      materialId,
      title: `${material.title} — חידון`,
      language,
    }).returning();

    if (questionResult.length > 0 && qSet?.id) {
      await db.insert(questionsTable).values(
        questionResult.map(q => ({
          setId: qSet.id,
          questionType: q.questionType,
          question: q.question,
          answer: q.answer,
          explanation: q.explanation,
          options: q.options,
          difficulty: q.difficulty,
          concept: q.concept,
        }))
      );
    }

    await db.insert(activityTable).values({
      userId,
      activityType: "summary",
      description: `Generated full exam kit for "${material.title}"`,
      materialTitle: material.title,
    });

    // Deterministic vocab generation has no Gemini output to bill for the
    // standard per-token rate -- only the standardized source-material
    // (page-based) charge applies, same as a regular summary's source charge.
    await deductTokensForSummary(userId, content);

    if (!qSet?.id) {
      logger.error({ materialId }, "generate-all: incomplete insert result, reporting failure");
      setGenerationProgress(materialId, {
        currentChunk: 0, totalChunks: 0, percentage: 0, stage: "error",
        error: "Generated content was incomplete. Please try again.",
      });
      return;
    }

    setGenerationProgress(materialId, {
      currentChunk: 0,
      totalChunks: 0,
      percentage: 100,
      stage: "done",
      result: {
        deck: deck?.id ? { id: deck.id, cardCount: flashResult.length } : undefined,
        questionSet: { id: qSet.id, questionCount: questionResult.length },
        partialFailure: false,
      },
    });
  } catch (err) {
    logger.error({ err, materialId }, "generate-all: unhandled background failure (vocab-kit)");
    const message = err instanceof InsufficientTokensError
      ? err.message
      : "Something went wrong while generating your study kit. Please try again.";
    setGenerationProgress(materialId, { currentChunk: 0, totalChunks: 0, percentage: 0, stage: "error", error: message });
  }
}

// The actual Gemini + DB-insert pipeline, run after the 202 has already gone
// out to the client. Nothing in here can hold an HTTP response open, so
// however long Gemini takes, Render's proxy never sees it -- the frontend
// finds out via polling GET /materials/:id/progress instead. Every exit path
// (success or failure) ends by writing a terminal "done"/"error" progress
// entry, since that's the only signal the polling frontend ever gets.
//
// Summary, flashcards, and practice questions now run as three dedicated
// SEQUENTIAL stages, each one persisted to the DB and surfaced to the
// frontend (via a cumulative `result` on the progress entry) the moment it
// finishes -- summary first, since that's the priority the user actually
// reads while the other two keep generating. Each stage's own failure
// (after its internal retries) is caught locally and replaced with a clear
// fallback instead of aborting the rest of the job, so e.g. a flaky
// question-generation call can never take down an otherwise successful
// summary + flashcard run. Flashcards and questions reuse the exact chunk
// boundaries the summary stage already computed (summaryResult.parts)
// instead of each independently re-chunking and re-summarizing the same raw
// document -- the same call-count savings the old merged pipeline aimed for,
// without merging the calls themselves back together.
async function runGenerateAll(material: MaterialRow, userId: number, content: string): Promise<void> {
  const materialId = material.id;
  const language = "he" as const;

  try {
    const { maxFlashcards } = getDynamicGenerationLimits(content.length);

    // Course-specific terminology the student pre-defined (see glossary.ts)
    // -- fetched once up front and passed into generateSummary below so the
    // model grounds its summary against the student's own definitions
    // instead of guessing at course-specific jargon.
    const glossaryTerms = material.courseId
      ? await db.select({ term: glossaryTermsTable.term, definition: glossaryTermsTable.definition })
          .from(glossaryTermsTable)
          .where(eq(glossaryTermsTable.courseId, material.courseId))
      : [];

    // Stage 1/3: summary -- top priority. generateSummary is already
    // internally chunked (ai.ts/buildAggregatedContent) for large documents,
    // and now also returns `parts`/`chunked` so stages 2 and 3 below can
    // reuse those same chunks instead of re-chunking the raw document again.
    console.log(`generate-all[${materialId}]: stage 1/3 -- generating summary...`);
    let summaryResult: { content: string; keyPoints: string[]; parts: string[]; chunked: boolean };
    let summaryFailed = false;
    try {
      summaryResult = await withTimeout(
        generateSummary({ language, materialContent: content, materialTitle: material.title, summaryType: "detailed", materialId, glossaryTerms }),
        AI_TASK_TIMEOUT_MS,
        "generateSummary",
      );
      console.log(`generate-all[${materialId}]: summary stage done -- ${summaryResult.content.length} chars, ${summaryResult.keyPoints.length} key points.`);
    } catch (err) {
      summaryFailed = true;
      logger.error({ err, materialId }, "generate-all: summary generation failed, using fallback");
      summaryResult = {
        content: userFacingAIErrorMessage(err, "לא ניתן היה ליצור סיכום עבור מסמך זה. אנא נסה שוב."),
        keyPoints: [],
        parts: [content],
        chunked: false,
      };
    }

    const [summary] = await db.insert(summariesTable).values({
      materialId,
      summaryType: "detailed",
      language,
      content: summaryResult.content,
      keyPoints: summaryResult.keyPoints,
    }).returning();

    if (!summary?.id) {
      logger.error({ materialId }, "generate-all: summary insert failed, aborting");
      setGenerationProgress(materialId, {
        currentChunk: 0, totalChunks: 0, percentage: 0, stage: "error",
        error: "Generated content was incomplete. Please try again.",
      });
      return;
    }

    setGenerationProgress(materialId, {
      currentChunk: 0, totalChunks: 0, percentage: 33, stage: "running",
      result: { summary: { id: summary.id, keyPointCount: summaryResult.keyPoints.length } },
    });

    // Stage 2/3: flashcards -- reuses summaryResult.parts (when the document
    // was actually chunked) so this stage processes the document one small,
    // bounded-output Gemini call per chunk instead of re-chunking and
    // re-summarizing a second time.
    console.log(`generate-all[${materialId}]: stage 2/3 -- generating flashcards (up to ${maxFlashcards} cards)...`);
    let flashResult: Array<{ front: string; back: string; difficulty: string; cardType: string }> = [];
    let flashFailed = false;
    try {
      flashResult = await withTimeout(
        generateFlashcardsAI({
          language,
          materialContent: content,
          materialTitle: material.title,
          materialId,
          cardCount: maxFlashcards,
          cardTypes: ["definition", "qa", "formula", "concept"],
          precomputedParts: summaryFailed ? undefined : summaryResult.parts,
        }),
        AI_TASK_TIMEOUT_MS,
        "generateFlashcardsAI",
      );
      console.log(`generate-all[${materialId}]: flashcards stage done -- ${flashResult.length} cards.`);
    } catch (err) {
      flashFailed = true;
      logger.warn({ err, materialId }, "generate-all: flashcard generation failed, continuing without it");
    }

    const [deck] = await db.insert(flashcardDecksTable).values({
      materialId,
      title: `${material.title} — כרטיסיות`,
      language,
    }).returning();

    if (flashResult.length > 0 && deck?.id) {
      await db.insert(flashcardsTable).values(
        flashResult.map(c => ({
          deckId: deck.id,
          front: c.front,
          back: c.back,
          difficulty: c.difficulty || "medium",
          cardType: c.cardType || "qa",
          concept: c.concept || null,
        }))
      );
    }

    setGenerationProgress(materialId, {
      currentChunk: 0, totalChunks: 0, percentage: 66, stage: "running",
      result: {
        summary: { id: summary.id, keyPointCount: summaryResult.keyPoints.length },
        deck: deck?.id ? { id: deck.id, cardCount: flashResult.length } : undefined,
      },
    });

    // Stage 3/3: practice questions -- one quiz's worth per run (re-run for a
    // fresh set), sized to the document's actual chunk count instead of a
    // single fixed number (see computeQuestionCount above). Excludes any
    // question already generated for this material in a previous run/exam
    // so repeated runs don't just hand back the same quiz. Also reuses
    // summaryResult.parts, same as the flashcards stage above.
    const practiceQuestionCount = computeQuestionCount(summaryResult.parts.length);
    console.log(`generate-all[${materialId}]: stage 3/3 -- generating ${practiceQuestionCount} practice questions...`);
    let questionResult: Awaited<ReturnType<typeof generateQuestionsAI>> = [];
    let questionFailed = false;
    try {
      const excludeQuestions = await getExistingQuestionTexts(materialId);
      questionResult = await withTimeout(
        generateQuestionsAI({
          language,
          materialContent: content,
          materialTitle: material.title,
          materialId,
          questionCount: practiceQuestionCount,
          questionTypes: ["multiple_choice", "true_false"],
          difficulty: "mixed",
          excludeQuestions,
          precomputedParts: summaryFailed ? undefined : summaryResult.parts,
        }),
        AI_TASK_TIMEOUT_MS,
        "generateQuestionsAI",
      );
      console.log(`generate-all[${materialId}]: questions stage done -- ${questionResult.length} questions.`);
    } catch (err) {
      questionFailed = true;
      logger.warn({ err, materialId }, "generate-all: question generation failed, continuing without it");
    }

    const [qSet] = await db.insert(questionSetsTable).values({
      materialId,
      title: `${material.title} — חידון`,
      language,
    }).returning();

    if (questionResult.length > 0 && qSet?.id) {
      await db.insert(questionsTable).values(
        questionResult.map(q => ({
          setId: qSet.id,
          questionType: q.questionType || "multiple_choice",
          question: q.question,
          answer: q.answer,
          explanation: q.explanation || null,
          options: q.options || [],
          difficulty: q.difficulty || "medium",
          concept: q.concept || null,
          optionExplanations: Array.isArray(q.optionExplanations)
            ? q.optionExplanations.map((e) => (typeof e === "string" ? e : null))
            : null,
        }))
      );
    }

    await db.insert(activityTable).values({
      userId,
      activityType: "summary",
      description: `Generated full exam kit for "${material.title}"`,
      materialTitle: material.title,
    });

    // Summary stage billed at the standardized page-based rate (1 Token per
    // 5 "standard pages" of source material, see lib/tokens.ts), which
    // already covers the source material itself -- so the flashcards/
    // questions deduction below only charges for their own generated
    // output, not the source material a second time.
    await deductTokensForSummary(userId, content);
    await deductTokensForGeneration(
      userId,
      "",
      JSON.stringify(flashResult) + JSON.stringify(questionResult),
    );

    if (!qSet?.id) {
      logger.error({ materialId }, "generate-all: incomplete insert result, reporting failure");
      setGenerationProgress(materialId, {
        currentChunk: 0, totalChunks: 0, percentage: 0, stage: "error",
        error: "Generated content was incomplete. Please try again.",
      });
      return;
    }

    setGenerationProgress(materialId, {
      currentChunk: 0,
      totalChunks: 0,
      percentage: 100,
      stage: "done",
      result: {
        summary: { id: summary.id, keyPointCount: summaryResult.keyPoints.length },
        deck: deck?.id ? { id: deck.id, cardCount: flashResult.length } : undefined,
        questionSet: { id: qSet.id, questionCount: questionResult.length },
        partialFailure: summaryFailed || flashFailed || questionFailed,
      },
    });
  } catch (err) {
    logger.error({ err, materialId }, "generate-all: unhandled background failure");
    const message = err instanceof InsufficientTokensError
      ? err.message
      : "Something went wrong while generating your study kit. Please try again.";
    setGenerationProgress(materialId, { currentChunk: 0, totalChunks: 0, percentage: 0, stage: "error", error: message });
  }
}

// Fire-and-forget by design: Render's free-tier proxy cuts the connection
// well before a multi-Gemini-call pipeline can finish, turning an in-flight
// generation into a bare 502 regardless of what our own retry/timeout logic
// decides. So this handler only does the fast, synchronous checks (auth,
// lookup, content length, token balance) before responding -- the actual
// generation runs after the response is sent, and the frontend finds out
// how it went by polling GET /materials/:id/progress.
router.post("/materials/:id/generate-all", generationRateLimiter, async (req, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated." });
    }

    const materialId = Number(req.params.id);
    if (isNaN(materialId)) {
      return res.status(400).json({ error: "Invalid material id" });
    }

    const [material] = await db.select().from(materialsTable)
      .where(and(eq(materialsTable.id, materialId), eq(materialsTable.userId, userId)));
    if (!material) {
      return res.status(404).json({ error: "Not found" });
    }

    // No fallback to the title or any other metadata -- if there's no real
    // extracted content, the length check right below rejects the request
    // outright instead of generating a kit out of thin air.
    const content = material.extractedText || "";
    const language = "he";

    // Length & sufficiency check — run BEFORE any Gemini calls. There is no
    // point burning API calls (and risking hallucinated filler content) on
    // material that's too thin to generate a meaningful study kit from. A
    // short vocabulary/glossary list bypasses this floor entirely -- see
    // looksLikeVocabularyList -- since it's valuable, legitimate source
    // material even when very short.
    if (!looksLikeVocabularyList(content) && content.trim().length < MIN_CONTENT_LENGTH) {
      return res.status(400).json({
        error: "insufficient_content",
        message: insufficientContentMessage(language),
        minLength: MIN_CONTENT_LENGTH,
        receivedLength: content.trim().length,
      });
    }

    await requireTokenBalance(userId);

    setGenerationProgress(materialId, { currentChunk: 0, totalChunks: 0, percentage: 0, stage: "running" });
    res.status(202).json({ materialId, status: "running" });

    if (looksLikeVocabularyList(content)) {
      void runGenerateAllVocab(material, userId, content);
    } else {
      void runGenerateAll(material, userId, content);
    }
  } catch (err) {
    logger.error({ err, materialId: req.params.id }, "generate-all: failed before dispatch");
    if (!res.headersSent) {
      if (err instanceof InsufficientTokensError) {
        res.status(402).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: "Something went wrong while generating your study kit. Please try again." });
    }
  }
});

export default router;
