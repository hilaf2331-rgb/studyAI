import { Router } from "express";
import multer from "multer";
import { db, recordingsTable, materialsTable, summariesTable, flashcardDecksTable, questionSetsTable, activityTable, flashcardsTable, questionsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { transcribeAudio } from "../lib/extractor";
import { generateSummary, generateFlashcardsAI, generateQuestionsAI } from "../lib/ai";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

router.get("/recordings", async (req, res) => {
  const userId = req.user!.userId;
  const rows = await db.select({
    id: recordingsTable.id,
    title: recordingsTable.title,
    recordedAt: recordingsTable.recordedAt,
    durationSeconds: recordingsTable.durationSeconds,
    mimeType: recordingsTable.mimeType,
    materialId: recordingsTable.materialId,
    summaryId: recordingsTable.summaryId,
    deckId: recordingsTable.deckId,
    questionSetId: recordingsTable.questionSetId,
    createdAt: recordingsTable.createdAt,
  }).from(recordingsTable)
    .where(eq(recordingsTable.userId, userId))
    .orderBy(desc(recordingsTable.recordedAt));
  res.json(rows);
});

router.get("/recordings/:id/audio", async (req, res) => {
  const userId = req.user!.userId;
  const id = Number(req.params.id);
  const [rec] = await db.select().from(recordingsTable)
    .where(and(eq(recordingsTable.id, id), eq(recordingsTable.userId, userId)));
  if (!rec || !rec.audioData) return res.status(404).json({ error: "Not found" });

  const buf = Buffer.from(rec.audioData, "base64");
  res.set("Content-Type", rec.mimeType);
  res.set("Content-Length", String(buf.length));
  res.set("Cache-Control", "private, max-age=3600");
  res.end(buf);
});

router.post("/recordings", upload.single("audio"), async (req, res) => {
  const userId = req.user!.userId;
  if (!req.file) return res.status(400).json({ error: "Audio file is required" });

  const title = (req.body.title as string) || `הקלטה ${new Date().toLocaleDateString("he-IL")}`;
  const recordedAt = req.body.recordedAt ? new Date(req.body.recordedAt) : new Date();
  const durationSeconds = req.body.durationSeconds ? Number(req.body.durationSeconds) : undefined;
  const mimeType = req.file.mimetype || "audio/webm";
  const audioData = req.file.buffer.toString("base64");

  let extractedText = "";
  let transcriptionError: string | undefined;
  try {
    const result = await transcribeAudio(req.file.buffer, mimeType, `recording.webm`);
    extractedText = result.text;
  } catch (err: any) {
    req.log.error({ err }, "Transcription failed");
    transcriptionError = err.message;
    extractedText = `[Transcription failed: ${err.message}]`;
  }

  const [material] = await db.insert(materialsTable).values({
    userId,
    title,
    contentType: "audio",
    language: "he",
    status: transcriptionError ? "error" : "ready",
    extractedText,
    duration: durationSeconds,
  }).returning();

  // Save recording row immediately so we can return something useful
  const [recording] = await db.insert(recordingsTable).values({
    userId,
    materialId: material.id,
    title,
    recordedAt,
    durationSeconds,
    mimeType,
    audioData,
  }).returning();

  if (transcriptionError) {
    return res.status(201).json({ recording, kit: null, transcriptionError });
  }

  // Parallel AI generation
  const content = extractedText;
  const language = "he" as const;
  try {
    const [summaryResult, flashResult, questionResult] = await Promise.all([
      generateSummary({ language, materialContent: content, materialTitle: title, summaryType: "detailed" }),
      generateFlashcardsAI({ language, materialContent: content, materialTitle: title, cardCount: 15, cardTypes: ["definition", "qa", "formula", "concept"] }),
      generateQuestionsAI({ language, materialContent: content, materialTitle: title, questionCount: 10, questionTypes: ["multiple_choice", "true_false"], difficulty: "mixed" }),
    ]);

    const [[summary], [deck], [qSet]] = await Promise.all([
      db.insert(summariesTable).values({ materialId: material.id, summaryType: "detailed", language, content: summaryResult.content, keyPoints: summaryResult.keyPoints }).returning(),
      db.insert(flashcardDecksTable).values({ materialId: material.id, title: `${title} — כרטיסיות`, language }).returning(),
      db.insert(questionSetsTable).values({ materialId: material.id, title: `${title} — חידון`, language }).returning(),
    ]);

    await Promise.all([
      flashResult.length > 0 ? db.insert(flashcardsTable).values(flashResult.map(c => ({ deckId: deck.id, front: c.front, back: c.back, difficulty: c.difficulty || "medium", cardType: c.cardType || "qa" }))) : Promise.resolve(),
      questionResult.length > 0 ? db.insert(questionsTable).values(questionResult.map(q => ({ setId: qSet.id, questionType: q.questionType || "multiple_choice", question: q.question, answer: q.answer, explanation: q.explanation || null, options: q.options || [], difficulty: q.difficulty || "medium" }))) : Promise.resolve(),
      db.update(recordingsTable).set({ summaryId: summary.id, deckId: deck.id, questionSetId: qSet.id }).where(eq(recordingsTable.id, recording.id)),
      db.insert(activityTable).values({ userId, activityType: "summary", description: `הקלטה ועיבוד: "${title}"`, materialTitle: title }),
    ]);

    const kit = { summary: { id: summary.id, keyPointCount: summaryResult.keyPoints.length }, deck: { id: deck.id, cardCount: flashResult.length }, questionSet: { id: qSet.id, questionCount: questionResult.length } };
    return res.status(201).json({ recording: { ...recording, summaryId: summary.id, deckId: deck.id, questionSetId: qSet.id }, kit });
  } catch (err: any) {
    req.log.error({ err }, "Kit generation failed after transcription");
    return res.status(201).json({ recording, kit: null, generationError: err.message });
  }
});

router.delete("/recordings/:id", async (req, res) => {
  const userId = req.user!.userId;
  const id = Number(req.params.id);
  const [deleted] = await db.delete(recordingsTable)
    .where(and(eq(recordingsTable.id, id), eq(recordingsTable.userId, userId)))
    .returning({ id: recordingsTable.id });
  if (!deleted) return res.status(404).json({ error: "Not found" });
  res.status(204).end();
});

export default router;
