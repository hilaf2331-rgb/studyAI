import { Router } from "express";
import { db, examsTable, questionsTable, examResultsTable, materialsTable, activityTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  ListExamsParams, GenerateExamParams, GenerateExamBody,
  GetExamParams, DeleteExamParams, SubmitExamParams, SubmitExamBody, GetExamResultParams
} from "@workspace/api-zod";
import { generateExamAI, gradeAnswer } from "../lib/ai";

const router = Router();

async function assertMaterialOwner(materialId: number, userId: number) {
  const [m] = await db.select({ id: materialsTable.id }).from(materialsTable)
    .where(and(eq(materialsTable.id, materialId), eq(materialsTable.userId, userId)));
  return !!m;
}

async function getExamWithQuestions(examId: number) {
  const [exam] = await db.select().from(examsTable).where(eq(examsTable.id, examId));
  if (!exam) return null;
  const questions = await db.select().from(questionsTable).where(eq(questionsTable.examId, examId));
  return { ...exam, questions };
}

router.get("/materials/:id/exams", async (req, res) => {
  const userId = req.user!.userId;
  const { id } = ListExamsParams.parse({ id: Number(req.params.id) });
  if (!await assertMaterialOwner(id, userId)) return res.status(404).json({ error: "Not found" });
  const exams = await db.select().from(examsTable).where(eq(examsTable.materialId, id));
  const withQ = await Promise.all(exams.map(e => getExamWithQuestions(e.id)));
  res.json(withQ.filter(Boolean));
});

router.post("/materials/:id/exams", async (req, res) => {
  const userId = req.user!.userId;
  const { id } = GenerateExamParams.parse({ id: Number(req.params.id) });
  const body = GenerateExamBody.parse(req.body);

  const [material] = await db.select().from(materialsTable)
    .where(and(eq(materialsTable.id, id), eq(materialsTable.userId, userId)));
  if (!material) return res.status(404).json({ error: "Not found" });

  const generated = await generateExamAI({
    language: body.language as "he" | "en",
    materialContent: material.extractedText || material.title,
    materialTitle: material.title,
    questionCount: body.questionCount || 10,
    examType: body.examType,
    difficulty: body.difficulty || "mixed",
    topics: body.topics,
  });

  const [exam] = await db.insert(examsTable).values({
    materialId: id,
    title: `${material.title} - ${body.examType} Exam`,
    language: body.language,
    examType: body.examType,
    questionCount: generated.length,
    timeLimitMinutes: body.timeLimitMinutes || null,
    difficulty: body.difficulty || "mixed",
  }).returning();

  if (generated.length > 0) {
    await db.insert(questionsTable).values(
      generated.map(q => ({
        examId: exam.id,
        questionType: q.questionType || "multiple_choice",
        question: q.question,
        answer: q.answer,
        explanation: q.explanation || null,
        modelAnswer: q.modelAnswer || null,
        options: q.options || [],
        difficulty: q.difficulty || "medium",
      }))
    );
  }

  await db.insert(activityTable).values({
    userId,
    activityType: "exam",
    description: `Generated ${body.examType} exam for "${material.title}"`,
    materialTitle: material.title,
  });

  res.status(201).json(await getExamWithQuestions(exam.id));
});

router.get("/exams/:id", async (req, res) => {
  const userId = req.user!.userId;
  const { id } = GetExamParams.parse({ id: Number(req.params.id) });
  const exam = await getExamWithQuestions(id);
  if (!exam) return res.status(404).json({ error: "Not found" });
  if (!await assertMaterialOwner(exam.materialId, userId)) return res.status(403).json({ error: "Forbidden" });
  res.json(exam);
});

router.delete("/exams/:id", async (req, res) => {
  const userId = req.user!.userId;
  const { id } = DeleteExamParams.parse({ id: Number(req.params.id) });
  const [exam] = await db.select().from(examsTable).where(eq(examsTable.id, id));
  if (!exam) return res.status(404).json({ error: "Not found" });
  if (!await assertMaterialOwner(exam.materialId, userId)) return res.status(403).json({ error: "Forbidden" });
  await db.delete(examsTable).where(eq(examsTable.id, id));
  res.status(204).end();
});

router.post("/exams/:id/submit", async (req, res) => {
  const userId = req.user!.userId;
  const { id } = SubmitExamParams.parse({ id: Number(req.params.id) });
  const body = SubmitExamBody.parse(req.body);

  const exam = await getExamWithQuestions(id);
  if (!exam) return res.status(404).json({ error: "Exam not found" });
  if (!await assertMaterialOwner(exam.materialId, userId)) return res.status(403).json({ error: "Forbidden" });

  const feedback = await Promise.all(
    body.answers.map(async (answer) => {
      const question = exam.questions.find(q => q.id === answer.questionId);
      if (!question) return null;
      const qType = question.questionType;
      let correct = false;
      let explanation = question.explanation || "";
      if (qType === "multiple_choice" || qType === "true_false") {
        correct = answer.answer.toLowerCase().trim() === question.answer.toLowerCase().trim();
      } else {
        const graded = await gradeAnswer(question.question, question.answer, answer.answer, exam.language as "he" | "en");
        correct = graded.correct;
        explanation = graded.explanation;
      }
      return {
        questionId: answer.questionId,
        correct,
        userAnswer: answer.answer,
        correctAnswer: question.answer,
        explanation,
        // Only meaningful for open questions; omitted (undefined) otherwise
        // so JSON.stringify drops the key for MC/true-false entries.
        modelAnswer: qType === "open" ? (question.modelAnswer || undefined) : undefined,
      };
    })
  );

  const valid = feedback.filter(Boolean) as Array<{ questionId: number; correct: boolean; userAnswer: string; correctAnswer: string; explanation: string; modelAnswer?: string }>;
  const correctCount = valid.filter(f => f.correct).length;
  const score = exam.questions.length > 0 ? Math.round((correctCount / exam.questions.length) * 100) : 0;

  const [result] = await db.insert(examResultsTable).values({
    examId: id,
    score,
    totalQuestions: exam.questions.length,
    correctCount,
    timeSpentSeconds: body.timeSpentSeconds || null,
    feedbackJson: JSON.stringify(valid),
  }).returning();

  await db.insert(activityTable).values({
    userId,
    activityType: "exam",
    description: `Completed exam with score ${score}%`,
    materialTitle: null,
    score,
  });

  res.json({ ...result, feedback: valid });
});

router.get("/exam-results/:id", async (req, res) => {
  const userId = req.user!.userId;
  const { id } = GetExamResultParams.parse({ id: Number(req.params.id) });
  const [result] = await db.select().from(examResultsTable).where(eq(examResultsTable.id, id));
  if (!result) return res.status(404).json({ error: "Not found" });

  const exam = await getExamWithQuestions(result.examId);
  if (!exam || !await assertMaterialOwner(exam.materialId, userId)) return res.status(403).json({ error: "Forbidden" });

  res.json({ ...result, feedback: JSON.parse(result.feedbackJson || "[]") });
});

export default router;
