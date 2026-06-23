import { Router } from "express";
import multer from "multer";
import { db, materialsTable, summariesTable, flashcardDecksTable, flashcardsTable, questionSetsTable, questionsTable, examsTable, activityTable } from "@workspace/db";
import { eq, count, and } from "drizzle-orm";
import { CreateMaterialBody, ListMaterialsQueryParams, GetMaterialParams, DeleteMaterialParams } from "@workspace/api-zod";
import { extractYouTube, extractPDF, transcribeAudio, extractFromUrl, extractOffice, extractImage } from "../lib/extractor";
import { isContentTooShort, getWordCount } from "../lib/validation";
import { getGenerationProgress, setGenerationProgress, clearGenerationProgress } from "../lib/progress";
import { generationRateLimiter } from "../lib/rate-limit";
import { sanitizeExtractedText } from "../lib/sanitize";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

async function getMaterialWithCounts(id: number, userId: number) {
  const [material] = await db.select().from(materialsTable)
    .where(and(eq(materialsTable.id, id), eq(materialsTable.userId, userId)));
  if (!material) return null;

  const [summaryCount] = await db.select({ value: count() }).from(summariesTable).where(eq(summariesTable.materialId, id));
  const [deckCount] = await db.select({ value: count() }).from(flashcardDecksTable).where(eq(flashcardDecksTable.materialId, id));
  const [qSetCount] = await db.select({ value: count() }).from(questionSetsTable).where(eq(questionSetsTable.materialId, id));
  const [examCount] = await db.select({ value: count() }).from(examsTable).where(eq(examsTable.materialId, id));

  const [flashcardCountRow] = await db.select({ value: count() }).from(flashcardsTable)
    .innerJoin(flashcardDecksTable, eq(flashcardsTable.deckId, flashcardDecksTable.id))
    .where(eq(flashcardDecksTable.materialId, id));

  const [questionCountRow] = await db.select({ value: count() }).from(questionsTable)
    .innerJoin(questionSetsTable, eq(questionsTable.setId, questionSetsTable.id))
    .where(eq(questionSetsTable.materialId, id));

  return {
    ...material,
    summaryCount: Number(summaryCount.value),
    flashcardCount: Number(flashcardCountRow?.value || 0),
    questionCount: Number(questionCountRow?.value || 0),
    examCount: Number(examCount.value),
    deckCount: Number(deckCount.value),
    qSetCount: Number(qSetCount.value),
    wordCount: getWordCount(material.extractedText),
    tooShortForGeneration: isContentTooShort(material.extractedText),
  };
}

router.get("/materials", async (req, res) => {
  const userId = req.user!.userId;
  const query = ListMaterialsQueryParams.parse({ courseId: req.query.courseId ? Number(req.query.courseId) : undefined });

  const rows = query.courseId
    ? await db.select().from(materialsTable)
        .where(and(eq(materialsTable.userId, userId), eq(materialsTable.courseId, query.courseId)))
        .orderBy(materialsTable.createdAt)
    : await db.select().from(materialsTable)
        .where(eq(materialsTable.userId, userId))
        .orderBy(materialsTable.createdAt);

  const withCounts = await Promise.all(rows.map(m => getMaterialWithCounts(m.id, userId)));
  res.json(withCounts.filter(Boolean));
});

router.post("/materials", generationRateLimiter, upload.single("file"), async (req, res) => {
  const userId = req.user!.userId;

  let body: any;
  if (req.file) {
    body = req.body;
  } else {
    try {
      body = CreateMaterialBody.parse(req.body);
    } catch {
      return res.status(400).json({ error: "Invalid request body" });
    }
  }

  const title = sanitizeExtractedText(body.title || "Untitled Material");
  const contentType = body.contentType || "text";
  const language = body.language || "he";
  const courseId = body.courseId ? Number(body.courseId) : undefined;
  const sourceUrl = body.sourceUrl || undefined;
  const uploadId = body.uploadId || undefined;

  const reportProgress = uploadId
    ? (percentage: number) => setGenerationProgress(uploadId, {
        currentChunk: 0,
        totalChunks: 0,
        percentage,
        stage: "extracting",
      })
    : undefined;

  let extractedText = body.text ? sanitizeExtractedText(body.text) : "";
  let duration: number | undefined;
  let processingError: string | undefined;

  try {
    if (contentType === "youtube" && sourceUrl) {
      const result = await extractYouTube(sourceUrl, reportProgress);
      extractedText = result.text;
      duration = result.duration;
    } else if (contentType === "url" && sourceUrl) {
      const result = await extractFromUrl(sourceUrl, reportProgress);
      extractedText = result.text;
    } else if (contentType === "pdf" && req.file) {
      const result = await extractPDF(req.file.buffer);
      extractedText = result.text;
    } else if ((contentType === "docx" || contentType === "pptx" || contentType === "xlsx") && req.file) {
      const result = await extractOffice(req.file.buffer, contentType, reportProgress);
      extractedText = result.text;
    } else if (contentType === "image" && req.file) {
      const result = await extractImage(req.file.buffer, req.file.mimetype, reportProgress);
      extractedText = result.text;
    } else if ((contentType === "audio" || contentType === "video") && req.file) {
      const result = await transcribeAudio(
        req.file.buffer,
        req.file.mimetype,
        req.file.originalname,
        reportProgress
      );
      extractedText = result.text;
      duration = result.duration;
    } else if (!extractedText && sourceUrl) {
      extractedText = sourceUrl;
    } else {
      reportProgress?.(100);
    }
  } catch (err: any) {
    req.log.error({ err }, "Content extraction failed");
    processingError = err.message || "Extraction failed";
    extractedText = sourceUrl || body.text || `[Extraction failed: ${processingError}]`;
    if (uploadId) {
      setGenerationProgress(uploadId, { currentChunk: 0, totalChunks: 0, percentage: 100, stage: "error" });
    }
  }

  if (uploadId && !processingError) {
    clearGenerationProgress(uploadId);
  }

  const status = processingError ? "error" : "ready";

  const [material] = await db.insert(materialsTable).values({
    title,
    contentType,
    language,
    courseId,
    sourceUrl,
    userId,
    status,
    extractedText,
    ...(duration ? { duration } : {}),
  }).returning();

  await db.insert(activityTable).values({
    userId,
    activityType: "upload",
    description: `Uploaded "${material.title}"`,
    materialTitle: material.title,
  });

  if (processingError) {
    return res.status(201).json({
      ...await getMaterialWithCounts(material.id, userId),
      extractionWarning: processingError,
    });
  }

  res.status(201).json(await getMaterialWithCounts(material.id, userId));
});

router.get("/materials/:id", async (req, res) => {
  const userId = req.user!.userId;
  const { id } = GetMaterialParams.parse({ id: Number(req.params.id) });
  const material = await getMaterialWithCounts(id, userId);
  if (!material) return res.status(404).json({ error: "Not found" });
  res.json(material);
});

router.get("/materials/upload-progress/:uploadId", async (req, res) => {
  const progress = getGenerationProgress(req.params.uploadId);
  res.json(progress ?? { currentChunk: 0, totalChunks: 0, percentage: 0, stage: "idle" });
});

router.get("/materials/:id/progress", async (req, res) => {
  const { id } = GetMaterialParams.parse({ id: Number(req.params.id) });
  const progress = getGenerationProgress(id);
  res.json(progress ?? { currentChunk: 0, totalChunks: 0, percentage: 0, stage: "idle" });
});

router.delete("/materials/:id", async (req, res) => {
  const userId = req.user!.userId;
  const { id } = DeleteMaterialParams.parse({ id: Number(req.params.id) });
  const [deleted] = await db.delete(materialsTable)
    .where(and(eq(materialsTable.id, id), eq(materialsTable.userId, userId)))
    .returning({ id: materialsTable.id });
  if (!deleted) return res.status(404).json({ error: "Not found" });
  res.status(204).end();
});

export default router;
