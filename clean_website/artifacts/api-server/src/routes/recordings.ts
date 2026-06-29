import { Router } from "express";
import multer from "multer";
import { db, recordingsTable, materialsTable, summariesTable, flashcardDecksTable, questionSetsTable, activityTable, flashcardsTable, questionsTable, glossaryTermsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { transcribeAudio, AudioDurationLimitError } from "../lib/extractor";
import { generateSummary, generateFlashcardsAI, generateQuestionsAI } from "../lib/ai";
import { requireTokenBalance, deductTokensForGeneration, deductTokensForSummary, deductTokensForTranscription, requireActionsRemaining, incrementActionsUsed, BetaActionLimitError, getFreeTierAudioCapSeconds, isPayingCustomer } from "../lib/tokens";
import { mediaTooLargeMessage, MIN_AUDIO_TRANSCRIPT_LENGTH, insufficientAudioContentMessage, freeTierAudioLimitMessage } from "../lib/validation";
import { runExclusive } from "../lib/processing-queue";
import { getGenerationProgress, setGenerationProgress, clearGenerationProgress } from "../lib/progress";

const router = Router();

// Same beta cap as the audio file-upload path in materials.ts -- a live
// browser recording is just another audio upload from Render's perspective,
// so it gets the same 25MB ceiling to stay clear of the free-tier HTTP
// timeout. The 20-minute duration cap is enforced client-side (auto-stop) in
// recorder.tsx; this is the server-side backstop in case that client check
// is bypassed.
const MAX_RECORDING_BYTES = 25 * 1024 * 1024;
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

const MAX_RECORDING_SECONDS = 20 * 60;

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

  // Free-tier students are capped at 20 minutes per recording; the cap is
  // lifted entirely (null) for admins and anyone who has ever bought a
  // token package. Checked here against the client-supplied duration before
  // any Whisper cost is spent, and again authoritatively inside
  // transcribeAudio() against the actual measured duration below.
  const audioCapSeconds = await getFreeTierAudioCapSeconds(userId);
  if (audioCapSeconds != null && durationSeconds && durationSeconds > audioCapSeconds) {
    return res.status(413).json({ error: freeTierAudioLimitMessage("he"), code: "FREE_TIER_AUDIO_LIMIT" });
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

  // The actual heavy work -- Whisper transcription plus three parallel
  // Gemini calls -- runs through the shared processing queue (see
  // lib/processing-queue.ts) so at most MAX_CONCURRENT_PROCESSING of these
  // run at once across the whole process, regardless of how many students
  // hit "stop recording" in the same few seconds.
  await runExclusive(
    (queuePosition) => {
      if (uploadId) setGenerationProgress(uploadId, { currentChunk: 0, totalChunks: 0, percentage: 0, stage: "queued", queuePosition });
    },
    async () => {
      if (uploadId) setGenerationProgress(uploadId, { currentChunk: 0, totalChunks: 0, percentage: 10, stage: "extracting" });

      let extractedText = "";
      let transcribedDurationSeconds: number | undefined;
      let transcriptionError: string | undefined;
      try {
        const result = await transcribeAudio(req.file!.buffer, mimeType, `recording.webm`, undefined, {
          maxDurationSeconds: audioCapSeconds ?? undefined,
          glossaryHint,
        });
        extractedText = result.text;
        transcribedDurationSeconds = result.duration;
      } catch (err: any) {
        if (err instanceof AudioDurationLimitError) {
          if (uploadId) clearGenerationProgress(uploadId);
          return res.status(413).json({ error: err.message, code: err.code });
        }
        req.log.error({ err }, "Transcription failed");
        transcriptionError = err.message;
        extractedText = `[Transcription failed: ${err.message}]`;
      }

      // Hard block: a silent/near-empty recording transcribes successfully
      // but to an empty or near-empty string. There is no fallback to the
      // title (or any other metadata) here -- if the actual transcript
      // doesn't clear the threshold, the request is rejected outright before
      // anything is persisted, before incrementActionsUsed, and before any
      // of the three Gemini calls below ever fire.
      if (!transcriptionError && extractedText.trim().length < MIN_AUDIO_TRANSCRIPT_LENGTH) {
        if (uploadId) clearGenerationProgress(uploadId);
        return res.status(400).json({
          error: "insufficient_content",
          message: insufficientAudioContentMessage("he"),
          code: "EMPTY_RECORDING",
          minLength: MIN_AUDIO_TRANSCRIPT_LENGTH,
          receivedLength: extractedText.trim().length,
        });
      }

      // Standardized rate: 1 Token per 10 minutes of audio (see
      // lib/tokens.ts's deductTokensForTranscription), billed against
      // Whisper's own measured duration -- never the client-supplied
      // durationSeconds -- and only once a usable transcript exists (a
      // rejected silent/near-empty recording above never reaches here).
      if (!transcriptionError && transcribedDurationSeconds) {
        await deductTokensForTranscription(userId, transcribedDurationSeconds);
      }

      const [material] = await db.insert(materialsTable).values({
        userId,
        courseId,
        title,
        contentType: "audio",
        language: "he",
        status: transcriptionError ? "error" : "ready",
        extractedText,
        duration: durationSeconds,
      }).returning();
      await incrementActionsUsed(userId);

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
        if (uploadId) clearGenerationProgress(uploadId);
        return res.status(201).json({ recording, kit: null, transcriptionError });
      }

      // Parallel AI generation
      const content = extractedText;
      const language = "he" as const;
      if (uploadId) setGenerationProgress(uploadId, { currentChunk: 0, totalChunks: 0, percentage: 50, stage: "running" });
      try {
        await requireTokenBalance(userId);

        // glossaryTerms is already fetched above (before transcription) so
        // Whisper's prompt hint and this summary call ground against the
        // exact same course-specific terminology, queried only once.
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
        ]);

        const kit = { summary: { id: summary.id, keyPointCount: summaryResult.keyPoints.length }, deck: { id: deck.id, cardCount: flashResult.length }, questionSet: { id: qSet.id, questionCount: questionResult.length } };
        if (uploadId) clearGenerationProgress(uploadId);
        return res.status(201).json({ recording: { ...recording, summaryId: summary.id, deckId: deck.id, questionSetId: qSet.id }, kit });
      } catch (err: any) {
        req.log.error({ err }, "Kit generation failed after transcription");
        if (uploadId) clearGenerationProgress(uploadId);
        return res.status(201).json({ recording, kit: null, generationError: err.message });
      }
    },
    { isPriority },
  );
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
