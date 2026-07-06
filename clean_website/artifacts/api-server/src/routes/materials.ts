import { Router } from "express";
import multer from "multer";
import { randomBytes } from "crypto";
import { db, materialsTable, summariesTable, flashcardDecksTable, flashcardsTable, questionSetsTable, questionsTable, examsTable, activityTable, glossaryTermsTable } from "@workspace/db";
import { eq, count, and, inArray, desc } from "drizzle-orm";
import { CreateMaterialBody, ListMaterialsQueryParams, GetMaterialParams, DeleteMaterialParams, BulkDeleteMaterialsBody, UpdateMaterialParams, UpdateMaterialBody, ShareMaterialParams, SaveSharedMaterialParams } from "@workspace/api-zod";
import { extractYouTube, extractPDF, transcribeAudio, extractFromUrl, extractOffice, extractImage, extensionFromMimeType, YouTubeVideoNotFoundError, YouTubeTooLongError } from "../lib/extractor";
import { probeDurationSeconds } from "../lib/audio-chunker";
import { isContentTooShort, getWordCount, isContentTooLong, contentTooLongMessage, MAX_RECORDING_SECONDS, insufficientTokensForAudioMessage } from "../lib/validation";
import { getGenerationProgress, setGenerationProgress, clearGenerationProgress } from "../lib/progress";
import { runExclusive } from "../lib/processing-queue";
import { generationRateLimiter } from "../lib/rate-limit";
import { sanitizeExtractedText } from "../lib/sanitize";
import { requireActionsRemaining, incrementActionsUsed, BetaActionLimitError, getAudioAffordability, isPayingCustomer, deductTokensForTranscription } from "../lib/tokens";
import { logger } from "../lib/logger";

const router = Router();

type MaterialRow = typeof materialsTable.$inferSelect;

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

// "file" = backward-compat single upload; "files" = multi-image (up to 5)
const uploadFields = upload.fields([
  { name: "file", maxCount: 1 },
  { name: "files", maxCount: 5 },
]);

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

// Thrown when an uploaded audio/video file's ffprobe-measured duration
// exceeds the absolute MAX_RECORDING_SECONDS ceiling (3 hours) -- same
// "reject outright before any material row is created" logic as
// ContentTooLongError/YouTubeTooLongError above, just decided from ffprobe's
// duration instead of extracted text length or YouTube metadata.
class RecordingTooLongError extends Error {
  readonly code = "RECORDING_TOO_LONG";
  constructor(message: string) {
    super(message);
    this.name = "RecordingTooLongError";
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
  // Raised from the old 25MB (a leftover from the 20-minute cap) to match
  // multer's own global ceiling for this route (MAX_UPLOAD_BYTES) -- an
  // uploaded audio file's bitrate isn't under our control the way
  // recorder.tsx's live-mic recording is (see its fixed 32kbps
  // audioBitsPerSecond), so a real 3-hour lecture file above ~50MB will
  // still be rejected here even though its duration alone would be allowed.
  // Supporting arbitrarily large uploaded files would need streaming the
  // upload to disk/object storage instead of multer's in-memory buffer,
  // which is out of scope for this change.
  audio: MAX_UPLOAD_BYTES,
  video: 50 * 1024 * 1024,
};

function fileTooLargeMessage(contentType: string, language: "he" | "en"): string {
  if (DOCUMENT_CONTENT_TYPES.has(contentType)) return contentTooLongMessage(language);
  if (contentType === "image") {
    return language === "he"
      ? "התמונה כבדה מדי! בשלב הבטא ניתן להעלות תמונות עד גודל של 8MB."
      : "This image is too large! During the beta we only support images up to 8MB.";
  }
  // audio + video share one message per the combined media cap.
  return language === "he"
    ? "קובץ המדיה ארוך או כבד מדי! אנו תומכים בהקלטות של עד 3 שעות ווידאו ישיר של עד 5 דקות."
    : "This media file is too long or too large! We support recordings up to 3 hours and direct video up to 5 minutes.";
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

// Backgrounded transcription for the audio/video file-upload branch of
// POST /materials, run after the 202 has already gone out -- mirrors
// routes/recordings.ts's runRecordingPipeline, but only covers extraction
// (no summary/flashcards/questions here: that stays a separate follow-up
// POST /materials/:id/generate-all call the frontend already makes today,
// same as every other content type in this route). Nothing in here can hold
// an HTTP response open, so every exit path updates the already-created
// material row and writes a terminal "done"/"error" progress entry instead.
async function runMaterialAudioExtraction(params: {
  material: MaterialRow;
  userId: number;
  buffer: Buffer;
  mimeType: string;
  filename: string;
  effectiveMaxSeconds: number | undefined;
  glossaryHint: string | undefined;
  uploadId: string | undefined;
  isPriority: boolean;
}): Promise<void> {
  const { material, userId, buffer, mimeType, filename, effectiveMaxSeconds, glossaryHint, uploadId, isPriority } = params;

  await runExclusive(
    (queuePosition) => {
      if (uploadId) setGenerationProgress(uploadId, { currentChunk: 0, totalChunks: 0, percentage: 0, stage: "queued", queuePosition });
    },
    async () => {
      try {
        const result = await transcribeAudio(
          buffer,
          mimeType,
          filename,
          (percentage) => {
            if (uploadId) setGenerationProgress(uploadId, { currentChunk: 0, totalChunks: 0, percentage, stage: "extracting" });
          },
          { maxDurationSeconds: effectiveMaxSeconds, glossaryHint },
        );

        // Standardized rate: 1 Token per 10 minutes of audio (see
        // lib/tokens.ts's deductTokensForTranscription), billed against
        // Whisper's own measured duration.
        if (result.duration) await deductTokensForTranscription(userId, result.duration);

        await db.update(materialsTable)
          .set({ status: "ready", extractedText: result.text, duration: result.duration })
          .where(eq(materialsTable.id, material.id));

        if (uploadId) setGenerationProgress(uploadId, {
          currentChunk: 0, totalChunks: 0, percentage: 100, stage: "done",
          result: { materialId: material.id, truncated: result.truncated ?? false },
        });
      } catch (err: any) {
        logger.error({ err, materialId: material.id }, "materials: audio/video background extraction failed");
        await db.update(materialsTable).set({ status: "error" }).where(eq(materialsTable.id, material.id));
        if (uploadId) setGenerationProgress(uploadId, {
          currentChunk: 0, totalChunks: 0, percentage: 0, stage: "error",
          error: err.message || "Extraction failed",
        });
      }
    },
    { isPriority },
  );
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

router.post("/materials", generationRateLimiter, uploadFields, async (req, res) => {
  const userId = req.user!.userId;

  // Normalise the two upload paths into one variable each.
  // "file" field = backward-compat single upload (all types).
  // "files" field = multi-image upload (up to 5 images).
  const filesMap = req.files as Record<string, Express.Multer.File[]> | undefined;
  const reqFile = filesMap?.file?.[0];
  const reqImages = filesMap?.files ?? [];

  let body: any;
  if (reqFile || reqImages.length > 0) {
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
  const subjectType = body.subjectType || "other";

  // ZIP files are an unsupported container format -- reject before any work.
  const allUploaded = reqImages.length > 0 ? reqImages : (reqFile ? [reqFile] : []);
  for (const uf of allUploaded) {
    const fname = uf.originalname.toLowerCase();
    const mime = uf.mimetype.toLowerCase();
    if (fname.endsWith(".zip") || mime === "application/zip" || mime.includes("x-zip")) {
      if (uploadId) clearGenerationProgress(uploadId);
      return res.status(400).json({
        error: language === "he"
          ? "קבצי ZIP אינם נתמכים. אנא חלצו את הקבצים ממנו תחילה."
          : "ZIP files are not supported. Please extract the files first.",
        code: "UNSUPPORTED_FILE_TYPE",
      });
    }
  }

  // Reject oversized files outright before any parsing/transcription starts
  // -- there's no point spending CPU or Whisper/Gemini budget on a file that
  // would just get capped or time out anyway on Render's free tier.
  const maxBytes = MAX_FILE_BYTES[contentType];
  if (reqFile && maxBytes && reqFile.size > maxBytes) {
    if (uploadId) clearGenerationProgress(uploadId);
    return res.status(413).json({ error: fileTooLargeMessage(contentType, language), code: "FILE_TOO_LARGE" });
  }
  // For multi-image: reject if any single image exceeds the image cap.
  const imgMaxBytes = MAX_FILE_BYTES.image;
  if (reqImages.length > 0 && imgMaxBytes) {
    const oversized = reqImages.find(f => f.size > imgMaxBytes);
    if (oversized) {
      if (uploadId) clearGenerationProgress(uploadId);
      return res.status(413).json({ error: fileTooLargeMessage("image", language), code: "FILE_TOO_LARGE" });
    }
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

  // Audio/video file uploads get their own backgrounded path: Whisper
  // transcription (now possibly chunked across many ffmpeg-segmented pieces,
  // see lib/audio-chunker.ts) can take far longer than Render's free-tier
  // proxy allows a single HTTP request to stay open, so this branch responds
  // 202 immediately and finishes transcription in runMaterialAudioExtraction
  // after the response has gone out -- exactly like routes/recordings.ts's
  // live-recording flow. Every other content type below (pdf/docx/text/url/
  // image/youtube) is unaffected and keeps responding 201 synchronously.
  if ((contentType === "audio" || contentType === "video") && reqFile) {
    try {
      // Unlike the live-recording flow (recordings.ts), there's no client-
      // supplied duration for an uploaded file -- ffprobe is the only source
      // of truth here, and it's cheap enough to run before committing to
      // anything (no Whisper cost spent yet).
      const extension = extensionFromMimeType(reqFile.mimetype);
      const probedSeconds = await probeDurationSeconds(reqFile.buffer, extension);

      if (probedSeconds != null && probedSeconds > MAX_RECORDING_SECONDS) {
        throw new RecordingTooLongError(fileTooLargeMessage(contentType, language));
      }

      // Token-affordability negotiation, same shape/logic as recordings.ts --
      // run BEFORE clearGenerationProgress/material-row creation so a
      // rejected negotiation never leaves partial state behind. If ffprobe
      // couldn't read the duration at all, this pre-check is skipped
      // entirely (best-effort, matching fetchYouTubeDurationSeconds's
      // fallback philosophy elsewhere in this codebase) and
      // MAX_RECORDING_SECONDS is passed straight through as the ffmpeg trim
      // bound so worst-case cost still has a ceiling even without a
      // pre-negotiated agreement -- deductTokensForTranscription's floor-at-
      // zero balance handling is the backstop for that case, same as today.
      const confirmedProcessSeconds = req.body.confirmedProcessSeconds ? Number(req.body.confirmedProcessSeconds) : undefined;
      let effectiveMaxSeconds: number | undefined = probedSeconds == null ? MAX_RECORDING_SECONDS : undefined;
      if (probedSeconds != null) {
        const affordability = await getAudioAffordability(userId, probedSeconds);
        if (!affordability.canAffordFull) {
          if (confirmedProcessSeconds == null) {
            if (uploadId) clearGenerationProgress(uploadId);
            return res.status(402).json({
              error: insufficientTokensForAudioMessage(Math.floor(affordability.affordableSeconds / 60), language),
              code: "INSUFFICIENT_TOKENS_FOR_AUDIO",
              requestedSeconds: probedSeconds,
              affordableSeconds: affordability.affordableSeconds,
              tokensNeeded: affordability.tokensNeeded,
              tokensAvailable: affordability.tokensAvailable,
            });
          }
          effectiveMaxSeconds = Math.max(0, Math.min(confirmedProcessSeconds, affordability.affordableSeconds));
        }
      }

      // Paying users (and admins) cut ahead of any free-tier jobs already
      // waiting -- see lib/processing-queue.ts's priority insertion logic.
      const isPriority = await isPayingCustomer(userId);
      // The glossary is the "Supreme Source of Truth" for this material's
      // whole pipeline -- fetched up front, before transcription even starts,
      // so Whisper itself gets a chance to recognize the course's own
      // acronyms/jargon correctly (via the prompt hint below), instead of
      // only being corrected after the fact in the Gemini summary stage.
      const glossaryTerms = courseId
        ? await db.select({ term: glossaryTermsTable.term, definition: glossaryTermsTable.definition })
            .from(glossaryTermsTable)
            .where(eq(glossaryTermsTable.courseId, courseId))
        : [];
      const glossaryHint = glossaryTerms.length ? glossaryTerms.map((t) => t.term).join(", ") : undefined;

      const [material] = await db.insert(materialsTable).values({
        title,
        contentType,
        language,
        courseId,
        userId,
        status: "processing",
        extractedText: "",
        subjectType,
      }).returning();

      await db.insert(activityTable).values({
        userId,
        activityType: "upload",
        description: `Uploaded "${material.title}"`,
        materialTitle: material.title,
      });
      await incrementActionsUsed(userId);

      res.status(202).json({ material, status: "processing", uploadId });

      void runMaterialAudioExtraction({
        material,
        userId,
        buffer: reqFile.buffer,
        mimeType: reqFile.mimetype,
        filename: reqFile.originalname,
        effectiveMaxSeconds,
        glossaryHint,
        uploadId,
        isPriority,
      }).catch((err) => {
        logger.error({ err }, "materials: unhandled background audio/video extraction failure");
        if (uploadId) setGenerationProgress(uploadId, { currentChunk: 0, totalChunks: 0, percentage: 0, stage: "error", error: "Something went wrong while processing this file. Please try again." });
      });
      return;
    } catch (err: any) {
      if (err instanceof RecordingTooLongError) {
        if (uploadId) clearGenerationProgress(uploadId);
        return res.status(413).json({ error: err.message, code: err.code });
      }
      req.log.error({ err }, "Audio/video upload failed before dispatch");
      if (uploadId) clearGenerationProgress(uploadId);
      return res.status(500).json({ error: err.message || "Something went wrong. Please try again." });
    }
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
    } else if (contentType === "pdf" && reqFile) {
      const result = await extractPDF(reqFile.buffer);
      extractedText = result.text;
    } else if ((contentType === "docx" || contentType === "pptx" || contentType === "xlsx") && reqFile) {
      const result = await extractOffice(reqFile.buffer, contentType, reportProgress);
      extractedText = result.text;
    } else if (contentType === "image" && (reqFile || reqImages.length > 0)) {
      // Single image (legacy "file" field) or up to 5 images ("files" field).
      const imageList = reqImages.length > 0 ? reqImages : [reqFile!];
      const results = await Promise.all(
        imageList.map((img, i) => extractImage(img.buffer, img.mimetype, i === 0 ? reportProgress : undefined))
      );
      extractedText = results.map(r => r.text).filter(Boolean).join("\n\n---\n\n");
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
    subjectType,
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

// Clones a shared study kit into the caller's own materials -- the source
// material is single-owner (materialsTable.userId), so "saving" someone
// else's shared deck can't be a join/link onto the original row; instead
// this copies the summary + flashcard deck/cards into a brand-new material
// owned by the caller, who can then study/review it on their own SRS
// schedule independent of the original.
router.post("/shared/:shareId/save", async (req, res) => {
  const userId = req.user!.userId;
  const { shareId } = SaveSharedMaterialParams.parse({ shareId: req.params.shareId });

  const [source] = await db.select().from(materialsTable).where(eq(materialsTable.shareId, shareId));
  if (!source) return res.status(404).json({ error: "Not found" });

  const [material] = await db.insert(materialsTable).values({
    userId,
    title: source.title,
    contentType: source.contentType,
    language: source.language,
    status: "ready",
    extractedText: source.extractedText,
    subjectType: source.subjectType,
  }).returning();

  const [summary] = await db.select().from(summariesTable)
    .where(eq(summariesTable.materialId, source.id))
    .orderBy(desc(summariesTable.createdAt))
    .limit(1);
  if (summary) {
    await db.insert(summariesTable).values({
      materialId: material.id,
      summaryType: summary.summaryType,
      language: summary.language,
      content: summary.content,
      keyPoints: summary.keyPoints,
    });
  }

  const [deck] = await db.select().from(flashcardDecksTable).where(eq(flashcardDecksTable.materialId, source.id));
  if (deck) {
    const [newDeck] = await db.insert(flashcardDecksTable).values({
      materialId: material.id,
      title: deck.title,
      language: deck.language,
    }).returning();

    const cards = await db.select().from(flashcardsTable).where(eq(flashcardsTable.deckId, deck.id));
    if (cards.length) {
      await db.insert(flashcardsTable).values(cards.map(c => ({
        deckId: newDeck.id,
        front: c.front,
        back: c.back,
        difficulty: c.difficulty,
        cardType: c.cardType,
        concept: c.concept,
      })));
    }
  }

  await db.insert(activityTable).values({
    userId,
    activityType: "upload",
    description: `Saved "${material.title}" from a shared link`,
    materialTitle: material.title,
  });

  res.json({ ok: true, materialId: material.id });
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
