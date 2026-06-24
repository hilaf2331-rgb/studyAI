import { Router } from "express";
import { db, materialsTable, summariesTable, flashcardDecksTable, flashcardsTable, questionSetsTable, questionsTable, activityTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { generateSummary, generateFlashcardsAI, generateQuestionsAI, RateLimitExhaustedError, SystemBlockedError, AIServiceError } from "../lib/ai";
import { logger } from "../lib/logger";
import { MIN_CONTENT_LENGTH, insufficientContentMessage, getDynamicGenerationLimits } from "../lib/validation";
import { generationRateLimiter } from "../lib/rate-limit";
import { requireTokenBalance, deductTokensForGeneration, InsufficientTokensError } from "../lib/tokens";
import { setGenerationProgress } from "../lib/progress";
import { getExistingQuestionTexts } from "../lib/question-history";

const router = Router();

// Per-task timeout. Each Gemini call gets its own clock instead of sharing
// one budget, so a single slow call can't silently swallow the others'
// remaining time. This only bounds a background promise (the 202 response
// has already gone out by the time runGenerateAll runs -- see below), so it
// isn't constrained by Render's proxy or any HTTP timeout; it just needs to
// stay comfortably above the worst case for a large, chunked document.
// generateSummary/generateFlashcardsAI/generateQuestionsAI each chunk the
// material via buildAggregatedContent, which (ai.ts) now processes chunks
// strictly one at a time (CONCURRENCY_LIMIT = 1) with a fixed cooldown
// between them, trading speed for reliability against Gemini's 503 "high
// demand" errors. Per-chunk worst case in ai.ts is ~256s (4 attempts x 60s
// ATTEMPT_TIMEOUT_MS + full exponential backoff with jitter), so a dozen-plus
// chunks each hitting that worst case -- extremely unlikely, but this is a
// ceiling, not an estimate -- could take the better part of an hour. Sized
// generously rather than tightly since the cost of cutting a real,
// in-progress generation short is much higher than the cost of a stuck job
// taking longer to time out.
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
const PRACTICE_QUESTION_COUNT = 10;

function userFacingAIErrorMessage(err: unknown, fallbackHe: string): string {
  if (err instanceof RateLimitExhaustedError || err instanceof SystemBlockedError || err instanceof AIServiceError) {
    return err.message;
  }
  return fallbackHe;
}

// The actual Gemini + DB-insert pipeline, run after the 202 has already gone
// out to the client. Nothing in here can hold an HTTP response open, so
// however long Gemini takes, Render's proxy never sees it -- the frontend
// finds out via polling GET /materials/:id/progress instead. Every exit path
// (success or failure) ends by writing a terminal "done"/"error" progress
// entry, since that's the only signal the polling frontend ever gets.
//
// Summary, flashcards, and questions are generated in three dedicated
// sequential stages rather than one concurrent Promise.allSettled batch --
// each stage's own failure (after its internal retries) is caught locally
// and replaced with a clear fallback instead of aborting the other stages,
// so e.g. a flaky question-generation call can never take down an otherwise
// successful summary + flashcard run.
async function runGenerateAll(material: MaterialRow, userId: number, content: string): Promise<void> {
  const materialId = material.id;
  const language = "he" as const;

  try {
    const { maxFlashcards } = getDynamicGenerationLimits(content.length);

    // Stage 1/3: summary -- top priority, must be thorough. A failure here
    // no longer aborts the whole job; it's replaced with a clear fallback
    // message so flashcards/questions still get a chance to run.
    console.log(`generate-all[${materialId}]: stage 1/3 -- generating summary...`);
    let summaryResult: { content: string; keyPoints: string[] };
    let summaryFailed = false;
    try {
      summaryResult = await withTimeout(
        generateSummary({
          language,
          materialContent: content,
          materialTitle: material.title,
          summaryType: "detailed",
        }),
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
      };
    }

    // Stage 2/3: flashcards -- also top priority, thorough coverage of the
    // document (dynamic cap based on content length). A failure leaves an
    // empty deck rather than aborting.
    console.log(`generate-all[${materialId}]: stage 2/3 -- generating flashcards (up to ${maxFlashcards})...`);
    let flashResult: Awaited<ReturnType<typeof generateFlashcardsAI>> = [];
    let flashFailed = false;
    try {
      flashResult = await withTimeout(
        generateFlashcardsAI({
          language,
          materialContent: content,
          materialTitle: material.title,
          cardCount: maxFlashcards,
          cardTypes: ["definition", "qa", "formula", "concept"],
        }),
        AI_TASK_TIMEOUT_MS,
        "generateFlashcardsAI",
      );
      console.log(`generate-all[${materialId}]: flashcards stage done -- ${flashResult.length} cards.`);
    } catch (err) {
      flashFailed = true;
      logger.warn({ err, materialId }, "generate-all: flashcard generation failed, continuing without it");
    }

    // Stage 3/3: practice questions -- fixed at PRACTICE_QUESTION_COUNT
    // (one quiz's worth per run; re-run for a fresh set), excluding any
    // question already generated for this material in a previous run/exam
    // so repeated runs don't just hand back the same quiz.
    console.log(`generate-all[${materialId}]: stage 3/3 -- generating ${PRACTICE_QUESTION_COUNT} practice questions...`);
    let questionResult: Awaited<ReturnType<typeof generateQuestionsAI>> = [];
    let questionFailed = false;
    try {
      const excludeQuestions = await getExistingQuestionTexts(materialId);
      questionResult = await withTimeout(
        generateQuestionsAI({
          language,
          materialContent: content,
          materialTitle: material.title,
          questionCount: PRACTICE_QUESTION_COUNT,
          questionTypes: ["multiple_choice", "true_false"],
          difficulty: "mixed",
          excludeQuestions,
        }),
        AI_TASK_TIMEOUT_MS,
        "generateQuestionsAI",
      );
      console.log(`generate-all[${materialId}]: questions stage done -- ${questionResult.length} questions.`);
    } catch (err) {
      questionFailed = true;
      logger.warn({ err, materialId }, "generate-all: question generation failed, continuing without it");
    }

    await deductTokensForGeneration(
      userId,
      content,
      summaryResult.content + JSON.stringify(flashResult) + JSON.stringify(questionResult),
    );

    const [[summary], [deck], [qSet]] = await Promise.all([
      db.insert(summariesTable).values({
        materialId,
        summaryType: "detailed",
        language,
        content: summaryResult.content,
        keyPoints: summaryResult.keyPoints,
      }).returning(),

      db.insert(flashcardDecksTable).values({
        materialId,
        title: `${material.title} — כרטיסיות`,
        language,
      }).returning(),

      db.insert(questionSetsTable).values({
        materialId,
        title: `${material.title} — חידון`,
        language,
      }).returning(),
    ]);

    await Promise.all([
      flashResult.length > 0
        ? db.insert(flashcardsTable).values(
            flashResult.map(c => ({
              deckId: deck.id,
              front: c.front,
              back: c.back,
              difficulty: c.difficulty || "medium",
              cardType: c.cardType || "qa",
            }))
          )
        : Promise.resolve(),

      questionResult.length > 0
        ? db.insert(questionsTable).values(
            questionResult.map(q => ({
              setId: qSet.id,
              questionType: q.questionType || "multiple_choice",
              question: q.question,
              answer: q.answer,
              explanation: q.explanation || null,
              options: q.options || [],
              difficulty: q.difficulty || "medium",
            }))
          )
        : Promise.resolve(),

      db.insert(activityTable).values({
        userId,
        activityType: "summary",
        description: `Generated full exam kit for "${material.title}"`,
        materialTitle: material.title,
      }),
    ]);

    if (!summary?.id || !deck?.id || !qSet?.id) {
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
        deck: { id: deck.id, cardCount: flashResult.length },
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

    const content = material.extractedText || material.title;
    const language = "he";

    // Length & sufficiency check — run BEFORE any Gemini calls. There is no
    // point burning API calls (and risking hallucinated filler content) on
    // material that's too thin to generate a meaningful study kit from.
    if (content.trim().length < MIN_CONTENT_LENGTH) {
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

    void runGenerateAll(material, userId, content);
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
