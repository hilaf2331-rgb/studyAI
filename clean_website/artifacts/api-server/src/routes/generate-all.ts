import { Router } from "express";
import { db, materialsTable, summariesTable, flashcardDecksTable, flashcardsTable, questionSetsTable, questionsTable, activityTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { generateSummary, generateFlashcardsAI, generateQuestionsAI, RateLimitExhaustedError, SystemBlockedError, AIServiceError } from "../lib/ai";
import { logger } from "../lib/logger";
import { MIN_CONTENT_LENGTH, insufficientContentMessage, getDynamicGenerationLimits } from "../lib/validation";
import { generationRateLimiter } from "../lib/rate-limit";
import { requireTokenBalance, deductTokensForGeneration, InsufficientTokensError } from "../lib/tokens";
import { setGenerationProgress } from "../lib/progress";

const router = Router();

// Per-task timeout. Each Gemini call gets its own clock instead of sharing
// one budget, so a single slow call can't silently swallow the others'
// remaining time. Must stay comfortably above ai.ts's own internal retry
// budget (~78s worst case: 3 attempts x 25s timeout + backoff) so a real
// retry exhaustion produces our clear "network or service issue" message
// instead of this generic timeout firing first.
const AI_TASK_TIMEOUT_MS = 100_000;

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

// The actual Gemini + DB-insert pipeline, run after the 202 has already gone
// out to the client. Nothing in here can hold an HTTP response open, so
// however long Gemini takes, Render's proxy never sees it -- the frontend
// finds out via polling GET /materials/:id/progress instead. Every exit path
// (success or failure) ends by writing a terminal "done"/"error" progress
// entry, since that's the only signal the polling frontend ever gets.
async function runGenerateAll(material: MaterialRow, userId: number, content: string): Promise<void> {
  const materialId = material.id;
  const language = "he" as const;

  try {
    const { maxFlashcards, maxQuestions } = getDynamicGenerationLimits(content.length);

    const [summarySettled, flashSettled, questionSettled] = await Promise.allSettled([
      withTimeout(
        generateSummary({
          language,
          materialContent: content,
          materialTitle: material.title,
          summaryType: "detailed",
        }),
        AI_TASK_TIMEOUT_MS,
        "generateSummary",
      ),
      withTimeout(
        generateFlashcardsAI({
          language,
          materialContent: content,
          materialTitle: material.title,
          cardCount: maxFlashcards,
          cardTypes: ["definition", "qa", "formula", "concept"],
        }),
        AI_TASK_TIMEOUT_MS,
        "generateFlashcardsAI",
      ),
      withTimeout(
        generateQuestionsAI({
          language,
          materialContent: content,
          materialTitle: material.title,
          questionCount: maxQuestions,
          questionTypes: ["multiple_choice", "true_false"],
          difficulty: "mixed",
        }),
        AI_TASK_TIMEOUT_MS,
        "generateQuestionsAI",
      ),
    ]);

    if (summarySettled.status === "rejected") {
      logger.error({ err: summarySettled.reason, materialId }, "generate-all: summary generation failed");
      const reason = summarySettled.reason;
      const message =
        reason instanceof RateLimitExhaustedError || reason instanceof SystemBlockedError || reason instanceof AIServiceError
          ? reason.message
          : "Failed to generate summary. Please try again.";
      setGenerationProgress(materialId, { currentChunk: 0, totalChunks: 0, percentage: 0, stage: "error", error: message });
      return;
    }

    const summaryResult = summarySettled.value;

    if (flashSettled.status === "rejected") {
      logger.warn({ err: flashSettled.reason, materialId }, "generate-all: flashcard generation failed, continuing without it");
    }
    if (questionSettled.status === "rejected") {
      logger.warn({ err: questionSettled.reason, materialId }, "generate-all: question generation failed, continuing without it");
    }

    const flashResult = flashSettled.status === "fulfilled" ? flashSettled.value : [];
    const questionResult = questionSettled.status === "fulfilled" ? questionSettled.value : [];

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
        partialFailure: flashSettled.status === "rejected" || questionSettled.status === "rejected",
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
