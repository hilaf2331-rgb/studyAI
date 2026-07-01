import { Router } from "express";
import { db, questionSetsTable, questionsTable, materialsTable, activityTable, examsTable, examResultsTable, flashcardDecksTable, flashcardsTable } from "@workspace/db";
import { eq, and, inArray, isNotNull, avg, count, sql, or, isNull, lte } from "drizzle-orm";
import {
  ListQuestionSetsParams, GenerateQuestionsParams, GenerateQuestionsBody,
  GetQuestionSetParams, DeleteQuestionSetParams,
  GenerateTargetedQuestionParams, GenerateTargetedQuestionBody,
  UpdateQuestionSetStudiedParams, UpdateQuestionSetStudiedBody,
  GetWeakConceptsParams, GetMaterialReadinessParams,
} from "@workspace/api-zod";
import { generateQuestionsAI, generateTargetedConceptQuestionAI } from "../lib/ai";
import { rejectIfTooShort, clampToContentLength, looksLikeVocabularyList } from "../lib/validation";
import { generationRateLimiter } from "../lib/rate-limit";
import { requireTokenBalance, deductTokensForGeneration, requireAndDeductFeatureTokens, FEATURE_TOKEN_COSTS } from "../lib/tokens";
import { parseVocabEntries, generateVocabQuiz } from "../lib/prompts/vocab";

const router = Router();

async function assertMaterialOwner(materialId: number, userId: number) {
  const [m] = await db.select({ id: materialsTable.id }).from(materialsTable)
    .where(and(eq(materialsTable.id, materialId), eq(materialsTable.userId, userId)));
  return !!m;
}

async function getSetWithQuestions(setId: number) {
  const [set] = await db.select().from(questionSetsTable).where(eq(questionSetsTable.id, setId));
  if (!set) return null;
  const qs = await db.select().from(questionsTable).where(eq(questionsTable.setId, setId));
  return { ...set, questionCount: qs.length, questions: qs };
}

router.get("/materials/:id/question-sets", async (req, res) => {
  const userId = req.user!.userId;
  const { id } = ListQuestionSetsParams.parse({ id: Number(req.params.id) });
  if (!await assertMaterialOwner(id, userId)) return res.status(404).json({ error: "Not found" });
  const sets = await db.select().from(questionSetsTable).where(eq(questionSetsTable.materialId, id));
  const withQ = await Promise.all(sets.map(s => getSetWithQuestions(s.id)));
  res.json(withQ.filter(Boolean));
});

router.post("/materials/:id/question-sets", generationRateLimiter, async (req, res) => {
  const userId = req.user!.userId;
  const { id } = GenerateQuestionsParams.parse({ id: Number(req.params.id) });
  const body = GenerateQuestionsBody.parse(req.body);

  const [material] = await db.select().from(materialsTable)
    .where(and(eq(materialsTable.id, id), eq(materialsTable.userId, userId)));
  if (!material) return res.status(404).json({ error: "Not found" });

  if (rejectIfTooShort(res, material.extractedText, body.language === "en" ? "en" : "he")) return;

  // No fallback to the title or any other metadata -- rejectIfTooShort above
  // already guarantees extractedText clears the minimum.
  const materialContent = material.extractedText || "";
  const contentLength = materialContent.trim().length;
  // Cap the requested count when the material is short-but-valid (between
  // MIN_CONTENT_LENGTH and SHORT_CONTENT_THRESHOLD). Asking for 10 questions
  // out of ~500-799 characters is exactly what causes Groq to duplicate
  // questions, pad with filler, or come back with an empty array.
  const questionCount = clampToContentLength(body.questionCount || 5, contentLength, "questions");

  await requireTokenBalance(userId);

  // Vocab-Kit "Dynamic Matching" quiz: term/definition word lists get a
  // deterministic multiple-choice quiz (one word, 4 options, randomized
  // EN<->HE direction) instead of the general-purpose AI question
  // generator -- see lib/vocab.ts for why an LLM adds no value here.
  const vocabEntries = looksLikeVocabularyList(materialContent) ? parseVocabEntries(materialContent) : [];
  const generated = vocabEntries.length > 0
    ? generateVocabQuiz(vocabEntries, questionCount)
    : await generateQuestionsAI({
        language: body.language as "he" | "en",
        materialContent,
        materialTitle: material.title,
        questionCount,
        questionTypes: body.questionTypes?.length ? body.questionTypes : ["open", "multiple_choice"],
        difficulty: body.difficulty || "mixed",
        materialId: id,
      });
  await deductTokensForGeneration(userId, materialContent, JSON.stringify(generated));

  const [set] = await db.insert(questionSetsTable).values({
    materialId: id,
    title: `${material.title} - Q&A`,
    language: body.language,
  }).returning();

  if (generated.length > 0) {
    await db.insert(questionsTable).values(
      generated.map(q => ({
        setId: set.id,
        questionType: q.questionType || "open",
        question: q.question,
        answer: q.answer,
        explanation: q.explanation || null,
        modelAnswer: q.modelAnswer || null,
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
    activityType: "questions",
    description: `Generated ${generated.length} questions for "${material.title}"`,
    materialTitle: material.title,
  });

  res.status(201).json(await getSetWithQuestions(set.id));
});

// Relearning-loop "rescue question": one targeted multiple_choice question
// for a concept the student has repeatedly failed. Never persisted to
// questionsTable -- it's not part of any question set, just an ephemeral
// item the frontend shows the student on the spot.
router.post("/materials/:id/targeted-question", generationRateLimiter, async (req, res) => {
  const userId = req.user!.userId;
  await requireAndDeductFeatureTokens(userId, FEATURE_TOKEN_COSTS.targetedQuestion);

  const { id } = GenerateTargetedQuestionParams.parse({ id: Number(req.params.id) });
  const body = GenerateTargetedQuestionBody.parse(req.body);

  const [material] = await db.select().from(materialsTable)
    .where(and(eq(materialsTable.id, id), eq(materialsTable.userId, userId)));
  if (!material) return res.status(404).json({ error: "Not found" });

  if (rejectIfTooShort(res, material.extractedText, body.language === "en" ? "en" : "he")) return;

  const materialContent = material.extractedText || "";

  await requireTokenBalance(userId);

  const question = await generateTargetedConceptQuestionAI({
    language: body.language as "he" | "en",
    materialContent,
    materialTitle: material.title,
    concept: body.concept,
    excludeQuestions: body.excludeQuestions,
    materialId: id,
  });
  await deductTokensForGeneration(userId, materialContent, JSON.stringify(question));

  if (!question) return res.status(502).json({ error: "generation_failed" });

  res.json(question);
});

router.get("/question-sets/:id", async (req, res) => {
  const userId = req.user!.userId;
  const { id } = GetQuestionSetParams.parse({ id: Number(req.params.id) });
  const set = await getSetWithQuestions(id);
  if (!set) return res.status(404).json({ error: "Not found" });
  if (!await assertMaterialOwner(set.materialId, userId)) return res.status(403).json({ error: "Forbidden" });
  res.json(set);
});

router.patch("/question-sets/:id", async (req, res) => {
  const userId = req.user!.userId;
  const { id } = UpdateQuestionSetStudiedParams.parse({ id: Number(req.params.id) });
  const body = UpdateQuestionSetStudiedBody.parse(req.body);

  const [set] = await db.select().from(questionSetsTable).where(eq(questionSetsTable.id, id));
  if (!set) return res.status(404).json({ error: "Not found" });
  if (!await assertMaterialOwner(set.materialId, userId)) return res.status(403).json({ error: "Forbidden" });

  await db.update(questionSetsTable)
    .set({ studied: body.studied, studiedAt: body.studied ? new Date() : null })
    .where(eq(questionSetsTable.id, id));

  res.json(await getSetWithQuestions(id));
});

router.delete("/question-sets/:id", async (req, res) => {
  const userId = req.user!.userId;
  const { id } = DeleteQuestionSetParams.parse({ id: Number(req.params.id) });
  const [set] = await db.select().from(questionSetsTable).where(eq(questionSetsTable.id, id));
  if (!set) return res.status(404).json({ error: "Not found" });
  if (!await assertMaterialOwner(set.materialId, userId)) return res.status(403).json({ error: "Forbidden" });
  await db.delete(questionSetsTable).where(eq(questionSetsTable.id, id));
  res.status(204).end();
});

// Mines existing exam results and flashcard SM-2 data to surface the
// concepts the student struggles with most. Zero new tables -- purely
// aggregates data that's already being written on every exam submission
// and every flashcard review.
router.get("/materials/:id/weak-concepts", async (req, res) => {
  const userId = req.user!.userId;
  const { id: materialId } = GetWeakConceptsParams.parse({ id: Number(req.params.id) });
  if (!await assertMaterialOwner(materialId, userId)) return res.status(404).json({ error: "Not found" });

  type ConceptStat = { quizCorrect: number; quizTotal: number; flashEfSum: number; flashCount: number };
  const conceptStats = new Map<string, ConceptStat>();

  // --- Exam-based signal ---
  const exams = await db.select({ id: examsTable.id })
    .from(examsTable).where(eq(examsTable.materialId, materialId));

  if (exams.length > 0) {
    const examIds = exams.map(e => e.id);
    const results = await db.select({ feedbackJson: examResultsTable.feedbackJson })
      .from(examResultsTable).where(inArray(examResultsTable.examId, examIds));

    const allFeedback: Array<{ questionId: number; correct: boolean }> = [];
    for (const r of results) {
      try {
        const parsed = JSON.parse(r.feedbackJson || "[]") as Array<{ questionId: number; correct: boolean }>;
        allFeedback.push(...parsed);
      } catch { /* malformed feedbackJson — skip */ }
    }

    if (allFeedback.length > 0) {
      const uniqueQIds = [...new Set(allFeedback.map(f => f.questionId))];
      const qs = await db.select({ id: questionsTable.id, concept: questionsTable.concept })
        .from(questionsTable).where(inArray(questionsTable.id, uniqueQIds));
      const qConceptMap = new Map(qs.map(q => [q.id, q.concept]));

      for (const { questionId, correct } of allFeedback) {
        const concept = qConceptMap.get(questionId);
        if (!concept) continue;
        const s = conceptStats.get(concept) ?? { quizCorrect: 0, quizTotal: 0, flashEfSum: 0, flashCount: 0 };
        s.quizTotal++;
        if (correct) s.quizCorrect++;
        conceptStats.set(concept, s);
      }
    }
  }

  // --- Flashcard SM-2 signal ---
  const decks = await db.select({ id: flashcardDecksTable.id })
    .from(flashcardDecksTable).where(eq(flashcardDecksTable.materialId, materialId));

  if (decks.length > 0) {
    const deckIds = decks.map(d => d.id);
    const cards = await db.select({ concept: flashcardsTable.concept, easeFactor: flashcardsTable.easeFactor })
      .from(flashcardsTable)
      .where(and(inArray(flashcardsTable.deckId, deckIds), isNotNull(flashcardsTable.concept)));

    for (const card of cards) {
      if (!card.concept) continue;
      const s = conceptStats.get(card.concept) ?? { quizCorrect: 0, quizTotal: 0, flashEfSum: 0, flashCount: 0 };
      s.flashEfSum += card.easeFactor;
      s.flashCount++;
      conceptStats.set(card.concept, s);
    }
  }

  // --- Aggregate and rank ---
  // easeFactor is stored as int×100: default 250 (EF 2.5), minimum 130 (EF 1.3).
  // Lower easeFactor means the student has been getting this card wrong repeatedly.
  const weakItems: Array<{ concept: string; score: number; quizAccuracy?: number; flashcardEaseFactor?: number; source: "quiz" | "flashcard" | "both" }> = [];

  for (const [concept, s] of conceptStats.entries()) {
    const hasQuiz = s.quizTotal > 0;
    const hasFlash = s.flashCount > 0;
    const quizAccuracy = hasQuiz ? (s.quizCorrect / s.quizTotal) * 100 : undefined;
    const avgEaseFactor = hasFlash ? Math.round(s.flashEfSum / s.flashCount) : undefined;

    // Only surface concepts where there's a genuine weakness signal.
    const quizWeak = hasQuiz && quizAccuracy! < 70;
    const flashWeak = hasFlash && avgEaseFactor! < 220;
    if (!quizWeak && !flashWeak) continue;

    // Score 0–100: higher = weaker
    let score: number;
    if (hasQuiz && hasFlash) {
      const qScore = (1 - quizAccuracy! / 100) * 100;
      const fScore = Math.max(0, Math.min(100, (250 - avgEaseFactor!) / 120 * 100));
      score = Math.round((qScore + fScore) / 2);
    } else if (hasQuiz) {
      score = Math.round((1 - quizAccuracy! / 100) * 100);
    } else {
      score = Math.round(Math.max(0, Math.min(100, (250 - avgEaseFactor!) / 120 * 100)));
    }

    weakItems.push({
      concept,
      score,
      quizAccuracy: hasQuiz ? Math.round(quizAccuracy!) : undefined,
      flashcardEaseFactor: hasFlash ? avgEaseFactor : undefined,
      source: hasQuiz && hasFlash ? "both" : hasQuiz ? "quiz" : "flashcard",
    });
  }

  weakItems.sort((a, b) => b.score - a.score);
  res.json(weakItems.slice(0, 5));
});

// Per-material readiness score: synthesises flashcard SM-2 mastery and
// exam accuracy into a single 0-100 readiness signal, plus a card-due count
// so the student knows whether they need to review before feeling confident.
router.get("/materials/:id/readiness", async (req, res) => {
  const userId = req.user!.userId;
  const { id: materialId } = GetMaterialReadinessParams.parse({ id: Number(req.params.id) });
  if (!await assertMaterialOwner(materialId, userId)) return res.status(404).json({ error: "Not found" });

  const now = new Date();

  // --- Flashcard stats ---
  const decks = await db.select({ id: flashcardDecksTable.id })
    .from(flashcardDecksTable).where(eq(flashcardDecksTable.materialId, materialId));
  const deckIds = decks.map(d => d.id);

  let totalCards = 0;
  let reviewedCards = 0;
  let avgEaseFactor: number | null = null;
  let cardsDue = 0;

  if (deckIds.length > 0) {
    const [flashStats] = await db.select({
      total: count(),
      reviewed: sql<number>`CAST(SUM(CASE WHEN ${flashcardsTable.reviewCount} > 0 THEN 1 ELSE 0 END) AS INTEGER)`,
      avgEf: sql<number>`AVG(CASE WHEN ${flashcardsTable.reviewCount} > 0 THEN ${flashcardsTable.easeFactor} ELSE NULL END)`,
      due: sql<number>`CAST(SUM(CASE WHEN ${flashcardsTable.nextReviewAt} IS NULL OR ${flashcardsTable.nextReviewAt} <= ${now.toISOString()} THEN 1 ELSE 0 END) AS INTEGER)`,
    }).from(flashcardsTable).where(inArray(flashcardsTable.deckId, deckIds));

    totalCards = Number(flashStats.total ?? 0);
    reviewedCards = Number(flashStats.reviewed ?? 0);
    avgEaseFactor = flashStats.avgEf ? Number(flashStats.avgEf) : null;
    cardsDue = Number(flashStats.due ?? 0);
  }

  // --- Exam/quiz stats ---
  const exams = await db.select({ id: examsTable.id })
    .from(examsTable).where(eq(examsTable.materialId, materialId));
  const examIds = exams.map(e => e.id);

  let quizAccuracy: number | null = null;
  let examsCompleted = 0;

  if (examIds.length > 0) {
    const [quizStats] = await db.select({
      avgScore: avg(examResultsTable.score),
      total: count(),
    }).from(examResultsTable).where(inArray(examResultsTable.examId, examIds));
    examsCompleted = Number(quizStats.total ?? 0);
    if (examsCompleted > 0 && quizStats.avgScore !== null) {
      quizAccuracy = Math.round(Number(quizStats.avgScore));
    }
  }

  // --- Flashcard mastery score (0-100) ---
  // Coverage * mastery: student must have BOTH reviewed many cards AND done well.
  // easeFactor 130=min(0), 250=default(1.0). We cap at 250 so a freshly-reviewed
  // card that hasn't gone above default doesn't score above 100.
  let flashcardMastery: number | null = null;
  if (totalCards > 0 && reviewedCards > 0) {
    const coverage = reviewedCards / totalCards;
    const mastery = avgEaseFactor
      ? Math.max(0, Math.min(1, (avgEaseFactor - 130) / 120))
      : 0;
    flashcardMastery = Math.round(coverage * mastery * 100);
  }

  // --- Overall readiness ---
  let score = 0;
  if (flashcardMastery !== null && quizAccuracy !== null) {
    score = Math.round(flashcardMastery * 0.5 + quizAccuracy * 0.5);
  } else if (flashcardMastery !== null) {
    score = flashcardMastery;
  } else if (quizAccuracy !== null) {
    score = quizAccuracy;
  }

  res.json({
    score,
    flashcardMastery,
    quizAccuracy,
    totalCards,
    reviewedCards,
    cardsDue,
    examsCompleted,
  });
});

router.patch("/questions/:id", async (req, res) => {
  const userId = req.user!.userId;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });

  const { question, answer, explanation, options } = req.body as {
    question?: string; answer?: string; explanation?: string; options?: string[];
  };
  if (!question?.trim() && !answer?.trim() && explanation === undefined && options === undefined) {
    return res.status(400).json({ error: "Nothing to update" });
  }

  const [q] = await db.select().from(questionsTable).where(eq(questionsTable.id, id));
  if (!q) return res.status(404).json({ error: "Not found" });

  // Resolve owner: question belongs to either a question-set or an exam
  let materialId: number | null = null;
  if (q.setId) {
    const [set] = await db.select({ materialId: questionSetsTable.materialId })
      .from(questionSetsTable).where(eq(questionSetsTable.id, q.setId));
    materialId = set?.materialId ?? null;
  } else if (q.examId) {
    const [exam] = await db.select({ materialId: examsTable.materialId })
      .from(examsTable).where(eq(examsTable.id, q.examId));
    materialId = exam?.materialId ?? null;
  }
  if (!materialId || !await assertMaterialOwner(materialId, userId)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const updates: Partial<typeof questionsTable.$inferInsert> = {};
  if (question?.trim()) updates.question = question.trim();
  if (answer?.trim()) updates.answer = answer.trim();
  if (explanation !== undefined) updates.explanation = explanation?.trim() || null;
  if (options !== undefined) updates.options = options.map(o => String(o));

  const [updated] = await db.update(questionsTable).set(updates).where(eq(questionsTable.id, id)).returning();
  res.json(updated);
});

export default router;
