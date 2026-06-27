import { Router } from "express";
import multer from "multer";
import { randomBytes } from "crypto";
import { db, materialsTable, summariesTable, flashcardDecksTable, flashcardsTable, questionSetsTable, questionsTable, examsTable, activityTable } from "@workspace/db";
import { eq, count, and, inArray } from "drizzle-orm";
import { CreateMaterialBody, ListMaterialsQueryParams, GetMaterialParams, DeleteMaterialParams, BulkDeleteMaterialsBody, UpdateMaterialParams, UpdateMaterialBody, ShareMaterialParams } from "@workspace/api-zod";
import { extractYouTube, extractPDF, transcribeAudio, extractFromUrl, extractOffice, extractImage, YouTubeVideoNotFoundError, YouTubeTooLongError } from "../lib/extractor";
import { isContentTooShort, getWordCount, isContentTooLong, contentTooLongMessage } from "../lib/validation";
import { getGenerationProgress, setGenerationProgress, clearGenerationProgress } from "../lib/progress";
import { generationRateLimiter } from "../lib/rate-limit";
import { sanitizeExtractedText } from "../lib/sanitize";
import { requireActionsRemaining, incrementActionsUsed, BetaActionLimitError } from "../lib/tokens";

const router = Router();

// Render's free tier is the binding constraint for every beta-only cap in
// this file: a video upload (heaviest case) can be up to 50MB, so multer's
// global cap has to allow that -- the smaller per-content-type ceilings
// below are enforced manually in the route handler instead, since multer
// can only apply one fileSize limit across all content types.
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

const DOCUMENT_CONTENT_TYPES = new Set(["pdf", "docx", "pptx", "xlsx"]);

// Thrown after extraction succeeds but the resulting text is over the beta's
// per-upload cap -- mirrors YouTubeTooLongError's "reject outright, don't
// create a material that would just time out on generation anyway" logic,
// just decided from the extracted text length instead of a video's metadata.
class ContentTooLongError extends Error {
  readonly code = "CONTENT_TOO_LONG";
  constructor(language: "he" | "en") {
    super(contentTooLongMessage(language));
    this.name = "ContentTooLongError";
  }
}

// File-size ceilings are checked manually (not via multer) so each content
// type can have its own beta cap instead of one limit shared by everything.
const MAX_FILE_BYTES: Partial<Record<string, number>> = {
  pdf: 15 * 1024 * 1024,
  docx: 15 * 1024 * 1024,
  pptx: 15 * 1024 * 1024,
  xlsx: 15 * 1024 * 1024,
  image: 8 * 1024 * 1024,
  audio: 25 * 1024 * 1024,
  video: 50 * 1024 * 1024,
};

function fileTooLargeMessage(contentType: string, language: "he" | "en"): string {
  if (DOCUMENT_CONTENT_TYPES.has(contentType)) return contentTooLongMessage(language);
  if (contentType === "image") {
    return language === "he"
      ? "התמונה כבדה מדי! בשלב הבטא ניתן להעלות תמונות עד גודל של 8MB."
      : "This image is too large! During the beta we only support images up to 8MB.";
  }
  // audio + video share one message per the beta's combined media cap.
  return language === "he"
    ? "קובץ המדיה ארוך או כבד מדי! בשלב הבטא אנו תומכים בהקלטות של עד 20 דקות ווידאו ישיר של עד 5 דקות."
    : "This media file is too long or too large! During the beta we only support recordings up to 20 minutes and direct video up to 5 minutes.";
}

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

  // Reject oversized files outright before any parsing/transcription starts
  // -- there's no point spending CPU or Whisper/Gemini budget on a file that
  // would just get capped or time out anyway on Render's free tier.
  const maxBytes = MAX_FILE_BYTES[contentType];
  if (req.file && maxBytes && req.file.size > maxBytes) {
    if (uploadId) clearGenerationProgress(uploadId);
    return res.status(413).json({ error: fileTooLargeMessage(contentType, language), code: "FILE_TOO_LARGE" });
  }

  // Beta-only hard cap on total processing actions -- checked before any
  // extraction work starts, same fail-fast spot as the file-size check above.
  try {
    await requireActionsRemaining(userId);
  } catch (err: any) {
    if (uploadId) clearGenerationProgress(uploadId);
    if (err instanceof BetaActionLimitError) {
      return res.status(403).json({ error: err.message, code: err.code });
    }
    throw err;
  }

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
      const result = await extractYouTube(sourceUrl, reportProgress, language);
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

    // Documents/URLs aren't capped by file size alone (a 2MB PDF can still
    // unpack into far more text than Render's free tier can summarize in
    // one Gemini call) -- so the actual extracted word count is the real
    // gate, checked only after extraction since that's the earliest point
    // the text length is known.
    if ((DOCUMENT_CONTENT_TYPES.has(contentType) || contentType === "url") && isContentTooLong(extractedText)) {
      throw new ContentTooLongError(language);
    }
  } catch (err: any) {
    // A confirmed-nonexistent/private video is a user input error, not a
    // processing failure -- reject it outright with a clean 404 instead of
    // creating a material record (with a placeholder/guessed summary) for a
    // link that was never valid to begin with.
    if (err instanceof YouTubeVideoNotFoundError) {
      if (uploadId) clearGenerationProgress(uploadId);
      return res.status(404).json({ error: err.message, code: err.code });
    }
    // Same logic as above -- a video over the beta's length cap is a user
    // input issue, not a processing failure, so it's rejected outright
    // instead of creating a material that would just time out anyway.
    if (err instanceof YouTubeTooLongError) {
      if (uploadId) clearGenerationProgress(uploadId);
      return res.status(413).json({ error: err.message, code: err.code });
    }
    // A document/URL that extracted to more text than the beta's per-upload
    // cap is a user input issue, not a processing failure -- same reasoning
    // as the two YouTube cases above, reject outright instead of creating a
    // material whose later generation calls would just time out.
    if (err instanceof ContentTooLongError) {
      if (uploadId) clearGenerationProgress(uploadId);
      return res.status(413).json({ error: err.message, code: err.code });
    }
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
  await incrementActionsUsed(userId);

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

router.patch("/materials/:id", async (req, res) => {
  const userId = req.user!.userId;
  const { id } = UpdateMaterialParams.parse({ id: Number(req.params.id) });
  const body = UpdateMaterialBody.parse(req.body);

  const [updated] = await db.update(materialsTable)
    .set({
      ...(body.cramMode !== undefined ? { cramMode: body.cramMode } : {}),
      ...(body.examDate !== undefined ? { examDate: body.examDate } : {}),
    })
    .where(and(eq(materialsTable.id, id), eq(materialsTable.userId, userId)))
    .returning({ id: materialsTable.id });
  if (!updated) return res.status(404).json({ error: "Not found" });

  res.json(await getMaterialWithCounts(id, userId));
});

// Idempotent: a material that's already been shared keeps its existing
// shareId forever (re-clicking "Share with Class" must never invalidate a
// link a student already sent into a WhatsApp group), so this only ever
// generates a fresh token on the first call.
router.post("/materials/:id/share", async (req, res) => {
  const userId = req.user!.userId;
  const { id } = ShareMaterialParams.parse({ id: Number(req.params.id) });

  const [material] = await db.select().from(materialsTable)
    .where(and(eq(materialsTable.id, id), eq(materialsTable.userId, userId)));
  if (!material) return res.status(404).json({ error: "Not found" });

  if (!material.shareId) {
    const shareId = randomBytes(9).toString("base64url");
    await db.update(materialsTable).set({ shareId }).where(eq(materialsTable.id, id));
  }

  res.json(await getMaterialWithCounts(id, userId));
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

// One DELETE statement scoped to (id IN ids) AND userId, instead of N
// separate requests/round-trips from the frontend's multi-select -- the
// related rows (summaries, decks, question sets, exams, etc.) all cascade
// via their FK's onDelete: "cascade", so this single statement is enough to
// clean up everything regardless of how many materials are in the batch.
// The userId scope means ids belonging to other users are silently ignored
// rather than erroring, same as the single-delete route's 404-only-if-yours
// behavior, just without a per-id 404 to report back.
router.post("/materials/bulk-delete", async (req, res) => {
  const userId = req.user!.userId;
  const { ids } = BulkDeleteMaterialsBody.parse(req.body);
  const deleted = await db.delete(materialsTable)
    .where(and(inArray(materialsTable.id, ids), eq(materialsTable.userId, userId)))
    .returning({ id: materialsTable.id });
  res.json({ deletedCount: deleted.length });
});

export default router;
