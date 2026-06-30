import { Router } from "express";
import { db, materialsTable, summariesTable, flashcardDecksTable, flashcardsTable, questionSetsTable, questionsTable, activityTable, glossaryTermsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { generateSummary, generateFlashcardsAI, generateQuestionsAI, RateLimitExhaustedError, SystemBlockedError, AIServiceError } from "../lib/ai";
import { splitTextIntoChunks } from "../lib/chunker";
import { logger } from "../lib/logger";
import { MIN_CONTENT_LENGTH, insufficientContentMessage, getDynamicGenerationLimits } from "../lib/validation";
import { generationRateLimiter } from "../lib/rate-limit";
import { requireTokenBalance, deductTokensForGeneration, deductTokensForSummary, InsufficientTokensError } from "../lib/tokens";
import { setGenerationProgress } from "../lib/progress";
import { getExistingQuestionTexts } from "../lib/question-history";
import { parseVocabEntries, generateVocabFlashcards } from "../lib/prompts/vocab";

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
    console.log(`generate-all[${materialId}]: vocab-kit -- generating ${practiceQuestionCount} fill-in-blank questions via AI...`);
    let questionResult: Awaited<ReturnType<typeof generateQuestionsAI>> = [];
    let questionFailed = false;
    try {
      questionResult = await withTimeout(
        generateQuestionsAI({
          language: "en",  // vocab fill-in-blank is always English sentences regardless of material language
          materialContent: content,
          materialTitle: material.title,
          materialId,
          questionCount: practiceQuestionCount,
          questionTypes: ["fill_in_blank"],
          difficulty: "mixed",
          subjectType: "vocabulary",
        }),
        AI_TASK_TIMEOUT_MS,
        "generateQuestionsAI(vocab)",
      );
    } catch (err) {
      questionFailed = true;
      logger.warn({ err, materialId }, "generate-all: vocab question generation failed, continuing without it");
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
          questionType: q.questionType || "fill_in_blank",
          question: q.question,
          answer: q.answer,
          explanation: q.explanation || null,
          options: q.options || [],
          difficulty: q.difficulty || "medium",
          concept: q.concept || null,
        }))
      );
    }

    await db.insert(activityTable).values({
      userId,
      activityType: "summary",
      description: `Generated full exam kit for "${material.title}"`,
      materialTitle: material.title,
    });

    // Vocab flashcards are deterministic (no Gemini for flashcards), but the
    // questions stage now uses AI (fill-in-blank), so bill for it.
    await deductTokensForSummary(userId, content);
    if (!questionFailed && questionResult.length > 0) {
      await deductTokensForGeneration(userId, "", JSON.stringify(questionResult));
    }

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
        partialFailure: questionFailed,
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
// Per-subject-type card and question type profiles. These determine what the
// AI generates for each category, matching the pedagogical intent described
// in the subject-type spec (vocabulary = fill-in-blank quiz, STEM = formulas
// + calculation problems, etc.).
const SUBJECT_TYPE_CARD_TYPES: Record<string, string[]> = {
  stem:       ["formula", "concept"],
  history:    ["qa", "concept"],
  literature: ["qa", "concept"],
  law:        ["qa", "concept"],
  other:      ["definition", "qa", "formula", "concept"],
};

const SUBJECT_TYPE_QUESTION_TYPES: Record<string, string[]> = {
  stem:       ["multiple_choice", "open"],
  history:    ["multiple_choice", "true_false"],
  literature: ["multiple_choice", "open"],
  law:        ["multiple_choice", "open"],
  other:      ["multiple_choice", "true_false"],
};

async function runGenerateAll(material: MaterialRow, userId: number, content: string, subjectType: string): Promise<void> {
  const materialId = material.id;
  const language = "he" as const;

  try {
    const { maxFlashcards } = getDynamicGenerationLimits(content.length);

    const glossaryTerms = material.courseId
      ? await db.select({ term: glossaryTermsTable.term, definition: glossaryTermsTable.definition })
          .from(glossaryTermsTable)
          .where(eq(glossaryTermsTable.courseId, material.courseId))
      : [];

    const cardTypes = SUBJECT_TYPE_CARD_TYPES[subjectType] ?? SUBJECT_TYPE_CARD_TYPES.other;
    const questionTypes = SUBJECT_TYPE_QUESTION_TYPES[subjectType] ?? SUBJECT_TYPE_QUESTION_TYPES.other;

    // Determine pipeline strategy before any AI calls:
    // - Short doc (1 chunk): all 3 stages run in parallel — ~3x faster since
    //   no stage depends on another.
    // - Long doc (multiple chunks): summary must run first so its per-chunk
    //   bullet summaries (precomputedParts) can be reused by flashcards and
    //   questions; those two then run in parallel.
    const isShortDoc = splitTextIntoChunks(content).length === 1;

    let summaryId = 0;
    let summaryKeyPointCount = 0;
    let summaryFailed = false;
    let flashResult: Array<{ front: string; back: string; difficulty: string; cardType: string; concept?: string }> = [];
    let flashFailed = false;
    let questionResult: Awaited<ReturnType<typeof generateQuestionsAI>> = [];
    let questionFailed = false;

    if (isShortDoc) {
      // === SHORT DOCUMENT: all 3 stages in parallel ===
      // Flashcards and questions receive precomputedParts: [content] so they
      // skip buildAggregatedContent and issue a single Gemini call directly.
      // Peak concurrency: 3 calls at t=0, then done. With 3 API keys this
      // is 1 call per key — well within any rate limit.
      console.log(`generate-all[${materialId}]: short doc, all 3 stages in parallel (subjectType=${subjectType}, up to ${maxFlashcards} cards, ${computeQuestionCount(1)} questions)...`);

      const excludeQuestions = await getExistingQuestionTexts(materialId);
      let summaryRowId: number | undefined;

      await Promise.allSettled([
        // Stage 1: summary
        (async () => {
          try {
            const result = await withTimeout(
              generateSummary({ language, materialContent: content, materialTitle: material.title, summaryType: "detailed", materialId, glossaryTerms, subjectType }),
              AI_TASK_TIMEOUT_MS, "generateSummary",
            );
            const [row] = await db.insert(summariesTable).values({
              materialId, summaryType: "detailed", language,
              content: result.content, keyPoints: result.keyPoints,
            }).returning();
            if (row?.id) {
              summaryRowId = row.id;
              summaryKeyPointCount = result.keyPoints.length;
              // Signal "summary ready" so the frontend can show "View Summary"
              // while flashcards/questions are still generating.
              setGenerationProgress(materialId, {
                currentChunk: 0, totalChunks: 0, percentage: 33, stage: "running",
                result: { summary: { id: row.id, keyPointCount: result.keyPoints.length } },
              });
            }
          } catch (err) {
            summaryFailed = true;
            logger.error({ err, materialId }, "generate-all: summary generation failed (short path), inserting fallback");
            const [row] = await db.insert(summariesTable).values({
              materialId, summaryType: "detailed", language,
              content: userFacingAIErrorMessage(err, "לא ניתן היה ליצור סיכום עבור מסמך זה. אנא נסה שוב."),
              keyPoints: [],
            }).returning();
            if (row?.id) summaryRowId = row.id;
          }
        })(),
        // Stage 2: flashcards
        (async () => {
          try {
            flashResult = await withTimeout(
              generateFlashcardsAI({
                language, materialContent: content, materialTitle: material.title, materialId,
                cardCount: maxFlashcards, cardTypes, subjectType,
                precomputedParts: [content],
              }),
              AI_TASK_TIMEOUT_MS, "generateFlashcardsAI",
            );
            console.log(`generate-all[${materialId}]: flashcards done -- ${flashResult.length} cards.`);
          } catch (err) {
            flashFailed = true;
            logger.warn({ err, materialId }, "generate-all: flashcard generation failed, continuing without it");
          }
        })(),
        // Stage 3: questions
        (async () => {
          try {
            questionResult = await withTimeout(
              generateQuestionsAI({
                language, materialContent: content, materialTitle: material.title, materialId,
                questionCount: computeQuestionCount(1), questionTypes, difficulty: "mixed",
                excludeQuestions, subjectType, precomputedParts: [content],
              }),
              AI_TASK_TIMEOUT_MS, "generateQuestionsAI",
            );
            console.log(`generate-all[${materialId}]: questions done -- ${questionResult.length} questions.`);
          } catch (err) {
            questionFailed = true;
            logger.warn({ err, materialId }, "generate-all: question generation failed, continuing without it");
          }
        })(),
      ]);

      if (!summaryRowId) {
        logger.error({ materialId }, "generate-all: summary insert failed (short path), aborting");
        setGenerationProgress(materialId, { currentChunk: 0, totalChunks: 0, percentage: 0, stage: "error", error: "Generated content was incomplete. Please try again." });
        return;
      }
      summaryId = summaryRowId;

    } else {
      // === LONG DOCUMENT: summary first, then flashcards + questions in parallel ===
      // Summary produces per-chunk bullet summaries (precomputedParts) that
      // flashcards and questions iterate over instead of re-chunking raw text.
      console.log(`generate-all[${materialId}]: long doc, stage 1/3 -- summary (subjectType=${subjectType})...`);

      let summaryResult: { content: string; keyPoints: string[]; parts: string[]; chunked: boolean };
      try {
        summaryResult = await withTimeout(
          generateSummary({ language, materialContent: content, materialTitle: material.title, summaryType: "detailed", materialId, glossaryTerms, subjectType }),
          AI_TASK_TIMEOUT_MS, "generateSummary",
        );
        console.log(`generate-all[${materialId}]: summary done -- ${summaryResult.content.length} chars, ${summaryResult.keyPoints.length} key points.`);
      } catch (err) {
        summaryFailed = true;
        logger.error({ err, materialId }, "generate-all: summary generation failed, using fallback");
        summaryResult = {
          content: userFacingAIErrorMessage(err, "לא ניתן היה ליצור סיכום עבור מסמך זה. אנא נסה שוב."),
          keyPoints: [], parts: [content], chunked: false,
        };
      }

      const [summaryRow] = await db.insert(summariesTable).values({
        materialId, summaryType: "detailed", language,
        content: summaryResult.content, keyPoints: summaryResult.keyPoints,
      }).returning();

      if (!summaryRow?.id) {
        logger.error({ materialId }, "generate-all: summary insert failed, aborting");
        setGenerationProgress(materialId, { currentChunk: 0, totalChunks: 0, percentage: 0, stage: "error", error: "Generated content was incomplete. Please try again." });
        return;
      }
      summaryId = summaryRow.id;
      summaryKeyPointCount = summaryResult.keyPoints.length;

      setGenerationProgress(materialId, {
        currentChunk: 0, totalChunks: 0, percentage: 33, stage: "running",
        result: { summary: { id: summaryRow.id, keyPointCount: summaryResult.keyPoints.length } },
      });

      // Stages 2+3 in parallel — each iterates over summaryResult.parts
      // one chunk at a time (2s cooldown between chunks), so peak concurrency
      // is 2 simultaneous Gemini calls.
      console.log(`generate-all[${materialId}]: long doc, stages 2+3 in parallel (up to ${maxFlashcards} cards, ${computeQuestionCount(summaryResult.parts.length)} questions)...`);

      const practiceQuestionCount = computeQuestionCount(summaryResult.parts.length);
      const excludeQuestions = await getExistingQuestionTexts(materialId);

      await Promise.allSettled([
        (async () => {
          try {
            flashResult = await withTimeout(
              generateFlashcardsAI({
                language, materialContent: content, materialTitle: material.title, materialId,
                cardCount: maxFlashcards, cardTypes, subjectType,
                precomputedParts: summaryFailed ? undefined : summaryResult.parts,
              }),
              AI_TASK_TIMEOUT_MS, "generateFlashcardsAI",
            );
            console.log(`generate-all[${materialId}]: flashcards done -- ${flashResult.length} cards.`);
          } catch (err) {
            flashFailed = true;
            logger.warn({ err, materialId }, "generate-all: flashcard generation failed, continuing without it");
          }
        })(),
        (async () => {
          try {
            questionResult = await withTimeout(
              generateQuestionsAI({
                language, materialContent: content, materialTitle: material.title, materialId,
                questionCount: practiceQuestionCount, questionTypes, difficulty: "mixed",
                excludeQuestions, subjectType,
                precomputedParts: summaryFailed ? undefined : summaryResult.parts,
              }),
              AI_TASK_TIMEOUT_MS, "generateQuestionsAI",
            );
            console.log(`generate-all[${materialId}]: questions done -- ${questionResult.length} questions.`);
          } catch (err) {
            questionFailed = true;
            logger.warn({ err, materialId }, "generate-all: question generation failed, continuing without it");
          }
        })(),
      ]);
    }

    // DB inserts for flashcards and questions (shared by both paths)
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

    await deductTokensForSummary(userId, content);
    await deductTokensForGeneration(userId, "", JSON.stringify(flashResult) + JSON.stringify(questionResult));

    if (!qSet?.id) {
      logger.error({ materialId }, "generate-all: incomplete insert result, reporting failure");
      setGenerationProgress(materialId, { currentChunk: 0, totalChunks: 0, percentage: 0, stage: "error", error: "Generated content was incomplete. Please try again." });
      return;
    }

    setGenerationProgress(materialId, {
      currentChunk: 0,
      totalChunks: 0,
      percentage: 100,
      stage: "done",
      result: {
        summary: { id: summaryId, keyPointCount: summaryKeyPointCount },
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

    // Length & sufficiency check — run BEFORE any Gemini calls. Vocabulary
    // materials bypass the minimum-length floor since a short term list is
    // still valid study material even when compact.
    const subjectType = material.subjectType || "other";
    if (subjectType !== "vocabulary" && content.trim().length < MIN_CONTENT_LENGTH) {
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

    if (subjectType === "vocabulary") {
      void runGenerateAllVocab(material, userId, content);
    } else {
      void runGenerateAll(material, userId, content, subjectType);
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
