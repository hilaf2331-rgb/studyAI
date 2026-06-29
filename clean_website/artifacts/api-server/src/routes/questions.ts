import { Router } from "express";
import { db, questionSetsTable, questionsTable, materialsTable, activityTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  ListQuestionSetsParams, GenerateQuestionsParams, GenerateQuestionsBody,
  GetQuestionSetParams, DeleteQuestionSetParams,
  GenerateTargetedQuestionParams, GenerateTargetedQuestionBody,
  UpdateQuestionSetStudiedParams, UpdateQuestionSetStudiedBody
} from "@workspace/api-zod";
import { generateQuestionsAI, generateTargetedConceptQuestionAI } from "../lib/ai";
import { rejectIfTooShort, clampToContentLength } from "../lib/validation";
import { generationRateLimiter } from "../lib/rate-limit";
import { requireTokenBalance, deductTokensForGeneration, requireAndDeductFeatureTokens, FEATURE_TOKEN_COSTS } from "../lib/tokens";

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

  const generated = await generateQuestionsAI({
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

export default router;
