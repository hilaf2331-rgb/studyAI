import { Router } from "express";
import { db, examsTable, questionsTable, examResultsTable, materialsTable, activityTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  ListExamsParams, GenerateExamParams, GenerateExamBody,
  GetExamParams, DeleteExamParams, SubmitExamParams, SubmitExamBody, GetExamResultParams,
  UpdateExamStudiedParams, UpdateExamStudiedBody
} from "@workspace/api-zod";
import { generateExamAI, gradeAnswer, generateVocabFillInBlanksAI } from "../lib/ai";
import { rejectIfTooShort, clampToContentLength } from "../lib/validation";
import { generationRateLimiter } from "../lib/rate-limit";
import { requireTokenBalance, deductTokensForGeneration, InsufficientTokensError } from "../lib/tokens";
import { getExistingQuestionTexts } from "../lib/question-history";
import { setGenerationProgress } from "../lib/progress";
import { logger } from "../lib/logger";
import { recordStudyActivity } from "../lib/streaks";
import { parseVocabEntries, generateVocabQuiz, VocabEntry } from "../lib/prompts/vocab";

// Mirrors generate-all.ts's PRACTICE_QUESTION_COUNT: a single exam run is
// meant to feel like one real quiz/exam rather than an attempt to exhaust
// every possible question from the material -- students re-run generation
// (now steered away from repeating prior questions) for a fresh set.
const MAX_EXAM_QUESTION_COUNT = 10;

// Same ceiling generate-all.ts uses for its own background stages -- this
// route used to await generateExamAI synchronously inside the request
// handler, so a large/chunked exam routinely outlived Render's proxy
// timeout and got killed mid-generation (the "first attempt throws an
// error" half of the bug report). Converting to the same fire-and-forget
// 202 + background job + progress-poll pattern generate-all.ts already
// uses removes that ceiling entirely; this timeout is just a safety net.
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

// Vocab exam: pure 50/50 MCQ — half "English word → 4 Hebrew options",
// half "Hebrew definition → 4 English options". Fully deterministic, no AI,
// no cost. generateVocabQuiz already alternates forward/backward so calling
// it with the full count gives the correct 50/50 split automatically.
function generateVocabExamQuestions(
  entries: VocabEntry[],
  questionCount: number,
): Array<{ questionType: string; question: string; answer: string; explanation?: string; options: string[]; difficulty: string; concept?: string }> {
  return generateVocabQuiz(entries, questionCount);
}

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

type MaterialRow = typeof materialsTable.$inferSelect;
type GenerateExamBodyType = ReturnType<typeof GenerateExamBody.parse>;

// The actual Gemini + DB-insert pipeline, run after the 202 has already gone
// out -- mirrors generate-all.ts's runGenerateAll. Writes a terminal
// "done"/"error" progress entry on every exit path, since that (via GET
// /materials/:id/progress) is the only way the frontend learns the exam
// actually finished; previously this route never wrote one at all, which is
// what left a retried generation stuck at "100%" forever (the chunked
// branch only ever wrote intermediate stage:"chunking" entries).
async function runGenerateExam(material: MaterialRow, userId: number, body: GenerateExamBodyType, questionCount: number): Promise<void> {
  const materialId = material.id;
  // No fallback to the title or any other metadata -- the caller's
  // rejectIfTooShort check already guarantees extractedText clears the
  // minimum before this background job is ever started.
  const materialContent = material.extractedText || "";

  try {
    const excludeQuestions = await getExistingQuestionTexts(materialId);

    // Exhaustion check: estimate how many unique questions this material can
    // realistically produce (~15 per chunk of content). Once the student has
    // seen that many, new runs will inevitably start repeating — flag it so
    // the frontend can show a friendly "you've covered everything" message.
    const estimatedChunks = Math.max(1, Math.ceil(materialContent.length / 15000));
    const estimatedCapacity = Math.max(20, estimatedChunks * 15);
    const isExhausted = excludeQuestions.length >= estimatedCapacity;

    const isVocab = material.subjectType === "vocabulary";
    const vocabEntries = isVocab ? parseVocabEntries(materialContent) : [];
    const generated = isVocab && vocabEntries.length > 0
      ? generateVocabExamQuestions(vocabEntries, questionCount)
      : await withTimeout(
          generateExamAI({
            language: body.language as "he" | "en",
            materialContent,
            materialTitle: material.title,
            questionCount,
            examType: body.examType,
            difficulty: body.difficulty || "mixed",
            topics: body.topics,
            materialId,
            excludeQuestions,
          }),
          AI_TASK_TIMEOUT_MS,
          "generateExamAI",
        );

    // Coerce/sanitize every row right at the DB boundary -- ai.ts already
    // filters out structurally invalid questions, but this is the last line
    // of defense against a stray non-string options element or wrong-typed
    // field reaching the questions.options text[] column and blowing up the
    // whole bulk insert (and with it, every otherwise-good question in the
    // batch) with a DrizzleQueryError. Computed before the exam row itself
    // so questionCount reflects what actually gets inserted.
    const rows = (generated as Array<Record<string, unknown>>)
      .filter(q => typeof q.question === "string" && (q.question as string).trim().length > 0 && typeof q.answer === "string" && (q.answer as string).trim().length > 0)
      .map(q => ({
        questionType: typeof q.questionType === "string" ? q.questionType : "multiple_choice",
        question: q.question as string,
        answer: q.answer as string,
        explanation: typeof q.explanation === "string" ? q.explanation : null,
        modelAnswer: typeof q.modelAnswer === "string" ? q.modelAnswer : null,
        options: Array.isArray(q.options) ? (q.options as unknown[]).filter((o): o is string => typeof o === "string") : [],
        difficulty: typeof q.difficulty === "string" ? q.difficulty : "medium",
        concept: typeof q.concept === "string" ? q.concept : null,
        optionExplanations: Array.isArray(q.optionExplanations)
          ? (q.optionExplanations as unknown[]).map((e) => (typeof e === "string" ? e : null))
          : null,
      }));

    const [exam] = await db.insert(examsTable).values({
      materialId,
      title: `${material.title} - ${body.examType} Exam`,
      language: body.language,
      examType: body.examType,
      questionCount: rows.length,
      timeLimitMinutes: body.timeLimitMinutes || null,
      difficulty: body.difficulty || "mixed",
    }).returning();

    if (!exam?.id) {
      logger.error({ materialId }, "exams: exam insert failed, aborting");
      setGenerationProgress(materialId, {
        currentChunk: 0, totalChunks: 0, percentage: 0, stage: "error",
        error: "Generated content was incomplete. Please try again.",
      });
      return;
    }

    if (rows.length > 0) {
      await db.insert(questionsTable).values(rows.map(r => ({ ...r, examId: exam.id })));
    }

    await db.insert(activityTable).values({
      userId,
      activityType: "exam",
      description: `Generated ${body.examType} exam for "${material.title}"`,
      materialTitle: material.title,
    });

    await deductTokensForGeneration(userId, materialContent, JSON.stringify(generated));

    setGenerationProgress(materialId, {
      currentChunk: 0,
      totalChunks: 0,
      percentage: 100,
      stage: "done",
      result: { exam: { id: exam.id, questionCount: rows.length }, exhaustedWarning: isExhausted },
    });
  } catch (err) {
    logger.error({ err, materialId }, "exams: unhandled background failure");
    const message = err instanceof InsufficientTokensError
      ? err.message
      : "Something went wrong while generating your exam. Please try again.";
    setGenerationProgress(materialId, { currentChunk: 0, totalChunks: 0, percentage: 0, stage: "error", error: message });
  }
}

// Fire-and-forget by design, same rationale as generate-all.ts: a
// chunked exam's Gemini calls routinely outlive Render's proxy timeout, so
// only the fast synchronous checks happen before responding -- the actual
// generation runs after the 202, and the frontend polls GET
// /materials/:id/progress to find out how it went.
router.post("/materials/:id/exams", generationRateLimiter, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const { id } = GenerateExamParams.parse({ id: Number(req.params.id) });
    const body = GenerateExamBody.parse(req.body);

    const [material] = await db.select().from(materialsTable)
      .where(and(eq(materialsTable.id, id), eq(materialsTable.userId, userId)));
    if (!material) return res.status(404).json({ error: "Not found" });

    if (rejectIfTooShort(res, material.extractedText, body.language === "en" ? "en" : "he")) return;

    // No fallback to the title or any other metadata -- rejectIfTooShort
    // above already guarantees extractedText clears the minimum.
    const materialContent = material.extractedText || "";
    const contentLength = materialContent.trim().length;
    const questionCount = Math.min(
      clampToContentLength(body.questionCount || 10, contentLength, "questions"),
      MAX_EXAM_QUESTION_COUNT,
    );

    await requireTokenBalance(userId);

    setGenerationProgress(id, { currentChunk: 0, totalChunks: 0, percentage: 0, stage: "running" });
    res.status(202).json({ materialId: id, status: "running" });

    void runGenerateExam(material, userId, body, questionCount);
  } catch (err) {
    logger.error({ err, materialId: req.params.id }, "exams: failed before dispatch");
    if (!res.headersSent) {
      if (err instanceof InsufficientTokensError) {
        res.status(402).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: "Something went wrong while generating your exam. Please try again." });
    }
  }
});

router.get("/exams/:id", async (req, res) => {
  const userId = req.user!.userId;
  const { id } = GetExamParams.parse({ id: Number(req.params.id) });
  const exam = await getExamWithQuestions(id);
  if (!exam) return res.status(404).json({ error: "Not found" });
  if (!await assertMaterialOwner(exam.materialId, userId)) return res.status(403).json({ error: "Forbidden" });
  res.json(exam);
});

router.patch("/exams/:id", async (req, res) => {
  const userId = req.user!.userId;
  const { id } = UpdateExamStudiedParams.parse({ id: Number(req.params.id) });
  const body = UpdateExamStudiedBody.parse(req.body);

  const [exam] = await db.select().from(examsTable).where(eq(examsTable.id, id));
  if (!exam) return res.status(404).json({ error: "Not found" });
  if (!await assertMaterialOwner(exam.materialId, userId)) return res.status(403).json({ error: "Forbidden" });

  await db.update(examsTable)
    .set({ studied: body.studied, studiedAt: body.studied ? new Date() : null })
    .where(eq(examsTable.id, id));

  res.json(await getExamWithQuestions(id));
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

router.post("/exams/:id/submit", generationRateLimiter, async (req, res) => {
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
      if (qType === "multiple_choice" || qType === "true_false" || qType === "fill_blank") {
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

  await recordStudyActivity(userId);

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
