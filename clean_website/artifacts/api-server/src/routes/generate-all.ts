import { Router } from "express";
import { db, materialsTable, summariesTable, flashcardDecksTable, flashcardsTable, questionSetsTable, questionsTable, activityTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { generateSummary, generateFlashcardsAI, generateQuestionsAI } from "../lib/ai";
import { logger } from "../lib/logger";
import { MIN_CONTENT_LENGTH, insufficientContentMessage, getDynamicGenerationLimits } from "../lib/validation";

const router = Router();

// Per-task timeout. Each Groq call gets its own clock instead of sharing
// one budget, so a single slow call can't silently swallow the others'
// remaining time. Pick a value comfortably above your slowest observed
// generation (large materials can legitimately take 30-60s per call).
const AI_TASK_TIMEOUT_MS = 90_000;

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

router.post("/materials/:id/generate-all", async (req, res) => {
  // EVERYTHING below is wrapped in one try/catch. This is the actual fix for
  // "Unexpected end of JSON input": previously, an unhandled throw/rejection
  // anywhere above the inner try block (auth, DB lookup, param parsing) would
  // crash the request without ever calling res.json(), and Express 4 does not
  // auto-catch async handler errors — the socket just closes with an empty
  // body. Now, no matter where something fails, we always send valid JSON.
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
    const language = "he" as const;

    // Length & sufficiency check — run BEFORE any Groq calls. There is no
    // point burning API calls (and risking hallucinated filler content) on
    // material that's too thin to generate a meaningful study kit from.
    // Uses the same 500-char threshold enforced on upload and on the
    // single-item summary/quiz generation routes, so the rule is consistent
    // everywhere in the app.
    if (content.trim().length < MIN_CONTENT_LENGTH) {
      return res.status(400).json({
        error: "insufficient_content",
        message: insufficientContentMessage(language),
        minLength: MIN_CONTENT_LENGTH,
        receivedLength: content.trim().length,
      });
    }

    // Dynamic scaling: short-but-valid material (>= 500 chars but
    // < SHORT_CONTENT_THRESHOLD) gets fewer requested cards/questions, so
    // Groq doesn't duplicate, pad, or come back empty. Uses the same
    // helper (and the same 800-char threshold) as the single-item
    // flashcards/questions routes, so behavior is consistent everywhere.
    const { maxFlashcards, maxQuestions } = getDynamicGenerationLimits(content.length);
    const targetCards = maxFlashcards;
    const targetQuestions = maxQuestions;

    // Run all three generations in parallel, each with its own timeout, and
    // never let one task's failure take down the others. We get back
    // settled results instead of throwing, so we can decide per-task whether
    // to fall back to an empty result or fail the whole request.
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
        cardCount: targetCards, // עבר לחישוב דינמי וחכם!
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
        questionCount: targetQuestions, // עבר לחישוב דינמי וחכם!
        questionTypes: ["multiple_choice", "true_false"],
        difficulty: "mixed",
      }),
      AI_TASK_TIMEOUT_MS,
      "generateQuestionsAI",
    ),
  ]);

  // If the summary itself failed, there's nothing useful to save — bail
  // out with a clear JSON error instead of a half-built result.
  if (summarySettled.status === "rejected") {
    logger.error({ err: summarySettled.reason, materialId }, "generate-all: summary generation failed");
    return res.status(502).json({
      error: "Failed to generate summary. Please try again.",
    });
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

    const payload = {
      summary: { id: summary?.id, keyPointCount: summaryResult.keyPoints.length },
      deck: { id: deck?.id, cardCount: flashResult.length },
      questionSet: { id: qSet?.id, questionCount: questionResult.length },
      partialFailure: flashSettled.status === "rejected" || questionSettled.status === "rejected",
    };

    // Validation: never send an empty/incomplete body. If any of the three
    // inserts didn't actually come back with an id (e.g. .returning() gave
    // back an empty array for some driver-specific reason), treat it as a
    // failure instead of silently shipping a payload the client can't use.
    if (!payload.summary.id || !payload.deck.id || !payload.questionSet.id) {
      logger.error({ payload, materialId }, "generate-all: incomplete payload after insert, refusing to send");
      return res.status(500).json({ error: "Generated content was incomplete. Please try again." });
    }

    return res.status(201).json(payload);
  } catch (err) {
    // This catch wraps the WHOLE handler — auth, param parsing, the DB
    // lookup, the Groq calls, and the inserts. Whatever breaks, anywhere,
    // the client always gets valid JSON and a real status code instead of
    // an empty body / dropped connection.
    logger.error({ err, materialId: req.params.id }, "generate-all: unhandled failure");
    if (!res.headersSent) {
      res.status(500).json({ error: "Something went wrong while generating your study kit. Please try again." });
    }
  }
});

export default router;
