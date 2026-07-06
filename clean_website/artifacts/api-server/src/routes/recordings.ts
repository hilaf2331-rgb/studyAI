import { Router } from "express";
import multer from "multer";
import { db, recordingsTable, materialsTable, summariesTable, flashcardDecksTable, questionSetsTable, activityTable, flashcardsTable, questionsTable, glossaryTermsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { transcribeAudio } from "../lib/extractor";
import { generateSummary, generateFlashcardsAI, generateQuestionsAI } from "../lib/ai";
import { requireTokenBalance, deductTokensForGeneration, deductTokensForSummary, deductTokensForTranscription, requireActionsRemaining, incrementActionsUsed, BetaActionLimitError, getAudioAffordability, isPayingCustomer } from "../lib/tokens";
import { mediaTooLargeMessage, MIN_AUDIO_TRANSCRIPT_LENGTH, insufficientAudioContentMessage, insufficientTokensForAudioMessage, MAX_RECORDING_SECONDS } from "../lib/validation";
import { runExclusive } from "../lib/processing-queue";
import { getGenerationProgress, setGenerationProgress } from "../lib/progress";
import { logger } from "../lib/logger";

const router = Router();

// recorder.tsx now records at a fixed 32kbps (see its MediaRecorder call),
// so a full MAX_RECORDING_SECONDS (3h) recording is at most ~43MB
// (32,000 bits/s * 10,800s / 8 = 43.2MB) -- this ceiling just needs enough
// headroom above that worst case for muxing overhead. Raised from the old
// 25MB (a leftover from when recordings were capped at 20 minutes) since
// that would otherwise reject a long recording's raw upload before any of
// the new duration/chunking logic below ever runs.
const MAX_RECORDING_BYTES = 60 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_RECORDING_BYTES } });

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

type RecordingRow = typeof recordingsTable.$inferSelect;
type MaterialRow = typeof materialsTable.$inferSelect;

// The actual Whisper transcription + three parallel Gemini calls, run after
// the 202 has already gone out to the client -- same "fire-and-forget
// background job, report progress via the polled uploadId key" pattern as
// generate-all.ts's runGenerateAll, just covering transcription too (which
// that route never had to, since it starts from already-extracted text).
// Nothing in here can hold an HTTP response open, so it never has a `res` to
// write to -- every exit path (success or failure) instead updates the
// already-created material/recording rows and writes a terminal "done"/
// "error" progress entry, since that's the only signal the polling frontend
// ever gets.
async function runRecordingPipeline(params: {
  recording: RecordingRow;
  material: MaterialRow;
  userId: number;
  buffer: Buffer;
  mimeType: string;
  title: string;
  effectiveMaxSeconds: number | undefined;
  glossaryHint: string | undefined;
  bookmarkTimestamps: number[];
  durationSeconds: number | undefined;
  uploadId: string | undefined;
  isPriority: boolean;
}): Promise<void> {
  const { recording, material, userId, buffer, mimeType, title, effectiveMaxSeconds, glossaryHint, bookmarkTimestamps, durationSeconds, uploadId, isPriority } = params;

  await runExclusive(
    (queuePosition) => {
      if (uploadId) setGenerationProgress(uploadId, { currentChunk: 0, totalChunks: 0, percentage: 0, stage: "queued", queuePosition });
    },
    async () => {
      if (uploadId) setGenerationProgress(uploadId, { currentChunk: 0, totalChunks: 0, percentage: 10, stage: "extracting" });

      let extractedText = "";
      let transcribedDurationSeconds: number | undefined;
      let truncated = false;
      let transcriptionError: string | undefined;
      try {
        const result = await transcribeAudio(buffer, mimeType, "recording.webm", (percentage) => {
          if (uploadId) setGenerationProgress(uploadId, { currentChunk: 0, totalChunks: 0, percentage: 10 + Math.round(percentage * 0.4), stage: "extracting" });
        }, {
          maxDurationSeconds: effectiveMaxSeconds,
          glossaryHint,
        });
        extractedText = result.text;
        transcribedDurationSeconds = result.duration;
        truncated = result.truncated ?? false;
      } catch (err: any) {
        logger.error({ err }, "Transcription failed");
        transcriptionError = err.message;
      }

      // Hard block: a silent/near-empty recording transcribes successfully
      // but to an empty or near-empty string. There is no fallback to the
      // title (or any other metadata) here -- if the actual transcript
      // doesn't clear the threshold, the job is aborted before any of the
      // three Gemini calls below ever fire. The material/recording rows
      // already exist (created before this background function ran), so
      // this updates them to an error state instead of the old inline
      // handler's res.status(400) -- there's no HTTP response to write to
      // from here.
      if (!transcriptionError && extractedText.trim().length < MIN_AUDIO_TRANSCRIPT_LENGTH) {
        await db.update(materialsTable).set({ status: "error" }).where(eq(materialsTable.id, material.id));
        if (uploadId) setGenerationProgress(uploadId, {
          currentChunk: 0, totalChunks: 0, percentage: 0, stage: "error",
          error: insufficientAudioContentMessage("he"),
        });
        return;
      }

      // Standardized rate: 1 Token per 10 minutes of audio (see
      // lib/tokens.ts's deductTokensForTranscription), billed against
      // Whisper's own measured duration -- never the client-supplied
      // durationSeconds -- and only once a usable transcript exists (a
      // rejected silent/near-empty recording above never reaches here).
      if (!transcriptionError && transcribedDurationSeconds) {
        await deductTokensForTranscription(userId, transcribedDurationSeconds);
      }

      if (transcriptionError) {
        await db.update(materialsTable).set({ status: "error" }).where(eq(materialsTable.id, material.id));
        if (uploadId) setGenerationProgress(uploadId, {
          currentChunk: 0, totalChunks: 0, percentage: 0, stage: "error",
          error: transcriptionError,
        });
        return;
      }

      // Parallel AI generation
      const content = extractedText;
      const language = "he" as const;
      if (uploadId) setGenerationProgress(uploadId, { currentChunk: 0, totalChunks: 0, percentage: 50, stage: "running" });
      try {
        await requireTokenBalance(userId);

        // glossaryTerms is already fetched by the caller (before transcription)
        // so Whisper's prompt hint and this summary call ground against the
        // exact same course-specific terminology, queried only once.
        const glossaryTerms = material.courseId
          ? await db.select({ term: glossaryTermsTable.term, definition: glossaryTermsTable.definition })
              .from(glossaryTermsTable)
              .where(eq(glossaryTermsTable.courseId, material.courseId))
          : [];

        const [summaryResult, flashResult, questionResult] = await Promise.all([
          generateSummary({ language, materialContent: content, materialTitle: title, summaryType: "detailed", bookmarkTimestamps, audioDurationSeconds: durationSeconds, glossaryTerms }),
          generateFlashcardsAI({ language, materialContent: content, materialTitle: title, cardCount: 15, cardTypes: ["definition", "qa", "formula", "concept"] }),
          generateQuestionsAI({ language, materialContent: content, materialTitle: title, questionCount: 10, questionTypes: ["multiple_choice", "true_false"], difficulty: "mixed" }),
        ]);

        // Summary stage billed at the standardized page-based rate (1 Token
        // per 5 "standard pages" of source material -- here, the Whisper
        // transcript -- see lib/tokens.ts), which already covers the
        // transcript text itself; flashcards/questions below only charge
        // for their own generated output.
        await deductTokensForSummary(userId, content);
        await deductTokensForGeneration(
          userId,
          "",
          JSON.stringify(flashResult) + JSON.stringify(questionResult),
        );

        const [[summary], [deck], [qSet]] = await Promise.all([
          db.insert(summariesTable).values({ materialId: material.id, summaryType: "detailed", language, content: summaryResult.content, keyPoints: summaryResult.keyPoints }).returning(),
          db.insert(flashcardDecksTable).values({ materialId: material.id, title: `${title} — כרטיסיות`, language }).returning(),
          db.insert(questionSetsTable).values({ materialId: material.id, title: `${title} — חידון`, language }).returning(),
        ]);

        await Promise.all([
          flashResult.length > 0 ? db.insert(flashcardsTable).values(flashResult.map(c => ({ deckId: deck.id, front: c.front, back: c.back, difficulty: c.difficulty || "medium", cardType: c.cardType || "qa", concept: c.concept || null }))) : Promise.resolve(),
          questionResult.length > 0 ? db.insert(questionsTable).values(questionResult.map(q => ({ setId: qSet.id, questionType: q.questionType || "multiple_choice", question: q.question, answer: q.answer, explanation: q.explanation || null, options: q.options || [], difficulty: q.difficulty || "medium", concept: q.concept || null, optionExplanations: Array.isArray(q.optionExplanations) ? q.optionExplanations.map((e) => (typeof e === "string" ? e : null)) : null }))) : Promise.resolve(),
          db.update(recordingsTable).set({ summaryId: summary.id, deckId: deck.id, questionSetId: qSet.id }).where(eq(recordingsTable.id, recording.id)),
          db.insert(activityTable).values({ userId, activityType: "summary", description: `הקלטה ועיבוד: "${title}"`, materialTitle: title }),
          db.update(materialsTable).set({ status: "ready", extractedText: content }).where(eq(materialsTable.id, material.id)),
        ]);

        const kit = { summary: { id: summary.id, keyPointCount: summaryResult.keyPoints.length }, deck: { id: deck.id, cardCount: flashResult.length }, questionSet: { id: qSet.id, questionCount: questionResult.length } };
        if (uploadId) setGenerationProgress(uploadId, {
          currentChunk: 0, totalChunks: 0, percentage: 100, stage: "done",
          result: { kit, recordingId: recording.id, truncated },
        });
      } catch (err: any) {
        logger.error({ err }, "Kit generation failed after transcription");
        // Transcription itself succeeded -- persist the transcript even
        // though kit generation failed, so the material isn't stuck at
        // "processing" forever and the student can retry generation later
        // from the material page.
        await db.update(materialsTable).set({ status: "ready", extractedText: content }).where(eq(materialsTable.id, material.id));
        if (uploadId) setGenerationProgress(uploadId, {
          currentChunk: 0, totalChunks: 0, percentage: 0, stage: "error",
          error: err.message,
        });
      }
    },
    { isPriority },
  );
}

router.post("/recordings", upload.single("audio"), async (req, res) => {
  const userId = req.user!.userId;
  if (!req.file) return res.status(400).json({ error: "Audio file is required" });

  // Hard block on a literally-empty payload before any transcription/AI
  // cost is incurred -- this is the backstop for the frontend's own
  // zero-byte check in case that's ever bypassed.
  if (req.file.size === 0) {
    return res.status(400).json({
      error: "insufficient_content",
      message: insufficientAudioContentMessage("he"),
      code: "EMPTY_RECORDING",
    });
  }

  const title = (req.body.title as string) || `הקלטה ${new Date().toLocaleDateString("he-IL")}`;
  const recordedAt = req.body.recordedAt ? new Date(req.body.recordedAt) : new Date();
  const durationSeconds = req.body.durationSeconds ? Number(req.body.durationSeconds) : undefined;
  const courseId = req.body.courseId ? Number(req.body.courseId) : undefined;
  const mimeType = req.file.mimetype || "audio/webm";

  // Real-time bookmarks the student tapped during the live recording
  // ("סמן רגע חשוב 📌"), sent as a JSON-stringified array of elapsed
  // seconds -- best-effort parse, since a malformed/missing field should
  // never block the upload itself, only skip the bookmark-aware prompting.
  let bookmarkTimestamps: number[] = [];
  if (typeof req.body.bookmarks === "string") {
    try {
      const parsed = JSON.parse(req.body.bookmarks);
      if (Array.isArray(parsed)) {
        bookmarkTimestamps = parsed.filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0);
      }
    } catch {}
  }

  if (durationSeconds && durationSeconds > MAX_RECORDING_SECONDS) {
    return res.status(413).json({ error: mediaTooLargeMessage("he"), code: "RECORDING_TOO_LONG" });
  }

  // Token-affordability negotiation: if the user's balance can't cover the
  // full requested duration, tell the frontend exactly how many minutes ARE
  // affordable instead of just rejecting outright. confirmedProcessSeconds
  // is only sent on the retry after the frontend has shown the user this
  // choice and they picked "continue with the affordable prefix" -- its
  // presence means the client has already seen and accepted the negotiated
  // duration.
  const confirmedProcessSeconds = req.body.confirmedProcessSeconds ? Number(req.body.confirmedProcessSeconds) : undefined;
  let effectiveMaxSeconds: number | undefined; // undefined = no truncation needed, full duration is affordable
  if (durationSeconds) {
    const affordability = await getAudioAffordability(userId, durationSeconds);
    if (!affordability.canAffordFull) {
      if (confirmedProcessSeconds == null) {
        return res.status(402).json({
          error: insufficientTokensForAudioMessage(Math.floor(affordability.affordableSeconds / 60), "he"),
          code: "INSUFFICIENT_TOKENS_FOR_AUDIO",
          requestedSeconds: durationSeconds,
          affordableSeconds: affordability.affordableSeconds,
          tokensNeeded: affordability.tokensNeeded,
          tokensAvailable: affordability.tokensAvailable,
        });
      }
      // Frontend confirmed proceeding with a truncated prefix -- clamp
      // defensively in case the balance changed between the 402 and this
      // retry.
      effectiveMaxSeconds = Math.max(0, Math.min(confirmedProcessSeconds, affordability.affordableSeconds));
    }
  }

  // Beta-only hard cap on total processing actions -- a live recording is a
  // processing action just like a material upload, checked before
  // transcription starts.
  try {
    await requireActionsRemaining(userId);
  } catch (err: any) {
    if (err instanceof BetaActionLimitError) {
      return res.status(403).json({ error: err.message, code: err.code });
    }
    throw err;
  }

  const audioData = req.file.buffer.toString("base64");

  // Optional: a client-generated id (see material-new.tsx's identical
  // pattern) so the frontend can poll /recordings/upload-progress/:uploadId
  // below and show "X uploads ahead of you" while this request waits behind
  // the concurrency limit, instead of looking stalled during exam-period
  // traffic spikes.
  const uploadId = typeof req.body.uploadId === "string" ? req.body.uploadId : undefined;

  // Paying users (and admins) cut ahead of any free-tier jobs already
  // waiting -- see lib/processing-queue.ts's priority insertion logic.
  const isPriority = await isPayingCustomer(userId);

  // The glossary is the "Supreme Source of Truth" for this material's whole
  // pipeline -- fetched once, up front, BEFORE transcription even starts (not
  // just before the summary call below), so Whisper itself gets a chance to
  // recognize the course's own acronyms/jargon correctly (via the prompt
  // hint passed into transcribeAudio), instead of only being corrected after
  // the fact in the Gemini summary stage.
  const glossaryTerms = courseId
    ? await db.select({ term: glossaryTermsTable.term, definition: glossaryTermsTable.definition })
        .from(glossaryTermsTable)
        .where(eq(glossaryTermsTable.courseId, courseId))
    : [];
  const glossaryHint = glossaryTerms.length ? glossaryTerms.map((t) => t.term).join(", ") : undefined;

  // Insert the material/recording rows immediately (status: "processing") so
  // the response can go out right away -- Render's free-tier proxy kills a
  // request held open past ~100-120s, and a multi-hour recording's
  // transcription + three Gemini calls can take far longer than that. The
  // frontend finds out how it went by polling
  // GET /recordings/upload-progress/:uploadId instead.
  const [material] = await db.insert(materialsTable).values({
    userId,
    courseId,
    title,
    contentType: "audio",
    language: "he",
    status: "processing",
    extractedText: "",
    duration: durationSeconds,
  }).returning();
  await incrementActionsUsed(userId);

  const [recording] = await db.insert(recordingsTable).values({
    userId,
    materialId: material.id,
    title,
    recordedAt,
    durationSeconds,
    mimeType,
    audioData,
  }).returning();

  res.status(202).json({ recording, material, status: "processing", uploadId });

  void runRecordingPipeline({
    recording,
    material,
    userId,
    buffer: req.file.buffer,
    mimeType,
    title,
    effectiveMaxSeconds,
    glossaryHint,
    bookmarkTimestamps,
    durationSeconds,
    uploadId,
    isPriority,
  }).catch((err) => {
    logger.error({ err }, "recordings: unhandled background pipeline failure");
    if (uploadId) setGenerationProgress(uploadId, { currentChunk: 0, totalChunks: 0, percentage: 0, stage: "error", error: "Something went wrong while processing your recording. Please try again." });
  });
});

router.get("/recordings/upload-progress/:uploadId", async (req, res) => {
  const progress = getGenerationProgress(req.params.uploadId);
  res.json(progress ?? { currentChunk: 0, totalChunks: 0, percentage: 0, stage: "idle" });
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
