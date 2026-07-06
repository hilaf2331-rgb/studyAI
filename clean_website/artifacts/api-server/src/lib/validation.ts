import type { Response } from "express";

// Below this many trimmed characters, the source material doesn't have
// enough substance to generate non-repetitive flashcards/questions/exams
// from — generation is blocked entirely (enforced on upload + every
// generation route, so the rule is consistent everywhere in the app).
export const MIN_CONTENT_LENGTH = 500;

// Between MIN_CONTENT_LENGTH and this many characters, the material is
// valid but thin: requested card/question counts get scaled down so Groq
// doesn't duplicate, pad with filler, or come back empty.
export const SHORT_CONTENT_THRESHOLD = 800;

export function insufficientContentMessage(language: "he" | "en" = "he"): string {
  return language === "he"
    ? "הטקסט קצר מדי בשביל לייצר מבחן, חידון או כרטיסיות לימוד. אנא הוסיפו עוד תוכן."
    : "This text is too short to generate an exam, quiz, or flashcards from. Please add more content.";
}

export function getTrimmedLength(text: string | null | undefined): number {
  return (text || "").trim().length;
}

// A vocabulary/glossary upload ("word - definition", "word: definition", or
// tab/multi-space-separated columns, one pair per line) packs real, useful
// content into very few characters per entry -- a 20-word list is easily
// under MIN_CONTENT_LENGTH even though it's exactly the kind of source
// material flashcards/exams are best at. Matched per-line rather than as one
// regex over the whole text so a list interspersed with blank lines or a
// header row still qualifies. Hebrew and English both flow through this
// (Unicode-aware `.` matches Hebrew letters fine) -- no separate per-language
// pattern is needed.
const VOCAB_LINE_PATTERN = /^[^\n]{1,60}?[ \t]*[-:–—\t][ \t]*[^\n]{1,200}$/;

// Requires a minimum number of matching lines (not just a high ratio) so a
// single stray "Q: A" line in an otherwise-prose document can't flip the
// whole upload into bypassing the floor.
const MIN_VOCAB_LINES = 5;
const MIN_VOCAB_LINE_RATIO = 0.6;

export function looksLikeVocabularyList(text: string | null | undefined): boolean {
  const lines = (text || "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < MIN_VOCAB_LINES) return false;
  const matching = lines.filter((l) => VOCAB_LINE_PATTERN.test(l)).length;
  return matching >= MIN_VOCAB_LINES && matching / lines.length >= MIN_VOCAB_LINE_RATIO;
}

export function isContentTooShort(text: string | null | undefined): boolean {
  if (looksLikeVocabularyList(text)) return false;
  return getTrimmedLength(text) < MIN_CONTENT_LENGTH;
}

export function getWordCount(text: string | null | undefined): number {
  const trimmed = (text || "").trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

// The old 15,000-word (~40 page) cap existed because generation used to run
// synchronously and both the extraction call AND the Gemini summarization
// had to fit inside Render's ~100s free-tier HTTP timeout. Extraction itself
// (parsing a PDF/DOCX) is local CPU work that finishes in seconds regardless
// of page count, and generation (POST /materials/:id/generate-all, see
// routes/generate-all.ts) has been backgrounded for a while now -- it
// chunks arbitrarily long text with its own per-chunk Gemini cooldown,
// untethered from any HTTP timeout. So this is now just a sane upper bound
// against pathological input (a corrupted file that "extracts" megabytes of
// garbage) rather than a load-bearing timeout workaround -- real cost is
// gated by the student's token balance (deductTokensForSummary/
// requireTokenBalance in lib/tokens.ts), not this word count.
export const MAX_CONTENT_WORDS = 100_000;

export function isContentTooLong(text: string | null | undefined): boolean {
  return getWordCount(text) > MAX_CONTENT_WORDS;
}

export function contentTooLongMessage(language: "he" | "en" = "he"): string {
  return language === "he"
    ? "הקובץ או האתר מכילים יותר מדי טקסט לעיבוד במכה אחת (מעל כ-300 עמודים)."
    : "This file or website contains too much text to process at once (over roughly 300 pages).";
}

// Used by the direct browser-recording upload route (recordings.ts), which
// enforces its own byte-size ceiling (MAX_RECORDING_BYTES) -- materials.ts's
// audio/video file-upload path has its own near-identical fileTooLargeMessage
// instead, since it covers video too.
export function mediaTooLargeMessage(language: "he" | "en" = "he"): string {
  return language === "he"
    ? "ההקלטה ארוכה או כבדה מדי! אנו תומכים בהקלטות של עד 3 שעות."
    : "This recording is too long or too large! We support recordings up to 3 hours.";
}

// Recordings.ts's server-side backstop: a zero-byte upload or a transcript
// this short (after Whisper has already run) means there's no real speech
// to build a study kit from -- caught here, by character count of the
// actual transcript, never by falling back to the recording's title.
export const MIN_AUDIO_TRANSCRIPT_LENGTH = 50;

export function insufficientAudioContentMessage(language: "he" | "en" = "he"): string {
  return language === "he"
    ? "לא נקלט תוכן בהקלטה (אולי הייתה שקטה או קצרה מדי). אנא בדוק את ההקלטה ונסה שוב."
    : "No content was detected in the recording (it may have been silent or too short). Please check the recording and try again.";
}

// Absolute ceiling on a single recording's length, applying to literally
// everyone including admins -- this replaced the old 20-minute cap that
// existed only because the whole transcription+generation pipeline used to
// run synchronously inside one HTTP request, and Render's free-tier proxy
// kills requests after ~100-120s. Now that transcription is backgrounded
// (see routes/recordings.ts's runRecordingPipeline) and chunked before ever
// reaching Whisper (lib/audio-chunker.ts), there's no HTTP-timeout reason to
// cap duration tightly -- this is now just a sane technical bound on a single
// upload, not a monetization gate. The real per-user gate is token balance
// (see getAudioAffordability in lib/tokens.ts), checked separately.
export const MAX_RECORDING_SECONDS = 3 * 60 * 60;

// Shown when the user's token balance can't cover the full requested
// recording length -- pairs with getAudioAffordability (lib/tokens.ts),
// which computes affordableMinutes so the frontend can offer "buy tokens" /
// "process just the first N minutes" / "cancel" instead of a flat rejection.
export function insufficientTokensForAudioMessage(affordableMinutes: number, language: "he" | "en" = "he"): string {
  return language === "he"
    ? `אין לך מספיק טוקנים לתמלול ההקלטה כולה. עם היתרה הנוכחית ניתן לתמלל כ-${affordableMinutes} דקות.`
    : `You don't have enough tokens to transcribe the whole recording. Your current balance covers about ${affordableMinutes} minutes.`;
}

/**
 * If the material's text is too short to generate from, writes a 400 JSON
 * response and returns true (caller should return immediately). Otherwise
 * returns false and the caller proceeds.
 */
export function rejectIfTooShort(
  res: Response,
  text: string | null | undefined,
  language: "he" | "en" = "he"
): boolean {
  // A short vocabulary/glossary list is valuable, legitimate source material
  // for flashcards/exams even when it's under MIN_CONTENT_LENGTH -- see
  // looksLikeVocabularyList above -- so it bypasses the floor entirely
  // instead of being rejected as if it were just thin prose.
  if (looksLikeVocabularyList(text)) return false;
  const trimmedLength = getTrimmedLength(text);
  if (trimmedLength < MIN_CONTENT_LENGTH) {
    res.status(400).json({
      error: "insufficient_content",
      message: insufficientContentMessage(language),
      minLength: MIN_CONTENT_LENGTH,
      receivedLength: trimmedLength,
    });
    return true;
  }
  return false;
}

export function getDynamicGenerationLimits(contentLength: number): {
  maxFlashcards: number;
  maxQuestions: number;
} {
  if (contentLength < SHORT_CONTENT_THRESHOLD) {
    return { maxFlashcards: 6, maxQuestions: 4 };
  }
  if (contentLength < 3000) {
    return { maxFlashcards: 10, maxQuestions: 6 };
  }
  return { maxFlashcards: 14, maxQuestions: 10 };
}

export function clampToContentLength(
  requested: number,
  contentLength: number,
  kind: "flashcards" | "questions" = "questions"
): number {
  const { maxFlashcards, maxQuestions } = getDynamicGenerationLimits(contentLength);
  const cap = kind === "flashcards" ? maxFlashcards : maxQuestions;
  return Math.max(1, Math.min(requested, cap));
}
