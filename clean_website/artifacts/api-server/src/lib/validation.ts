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

// Documents/URLs over ~40 pages reliably blow past Render's 100s free-tier
// HTTP timeout once that much text hits Gemini for summarization, and the
// resulting chunked-summarization burns through Gemini's rate limit in one
// shot -- there's no hosting-tier fix for that without upgrading, so the
// extracted text length itself is capped instead, same beta-limit pattern
// as the YouTube duration cap.
export const MAX_CONTENT_WORDS = 15000;

export function isContentTooLong(text: string | null | undefined): boolean {
  return getWordCount(text) > MAX_CONTENT_WORDS;
}

export function contentTooLongMessage(language: "he" | "en" = "he"): string {
  return language === "he"
    ? "הקובץ או האתר מכילים יותר מדי טקסט! בשלב הבטא אנו תומכים בסיכום של עד 40 עמודי חומר במכה אחת."
    : "This file or website contains too much text! During the beta we only support summarizing up to roughly 40 pages of material at once.";
}

// Shared with the direct browser-recording upload route (recordings.ts),
// which enforces the same 25MB/20-minute audio cap as the file-upload path
// in materials.ts -- same Render free-tier rationale, same message.
export function mediaTooLargeMessage(language: "he" | "en" = "he"): string {
  return language === "he"
    ? "קובץ המדיה ארוך או כבד מדי! בשלב הבטא אנו תומכים בהקלטות של עד 20 דקות ווידאו ישיר של עד 5 דקות."
    : "This media file is too long or too large! During the beta we only support recordings up to 20 minutes and direct video up to 5 minutes.";
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

// Free-plan ceiling on transcribable audio length, enforced both as a fast
// pre-flight check (client-supplied duration, before any Whisper call is
// made) and as a server-side backstop against the actual measured duration
// (lib/extractor.ts's transcribeAudio) -- lifted entirely for anyone who has
// ever bought a token package (lib/tokens.ts's getFreeTierAudioCapSeconds).
export const FREE_TIER_MAX_AUDIO_SECONDS = 20 * 60;

export function freeTierAudioLimitMessage(language: "he" | "en" = "he"): string {
  return language === "he"
    ? "בתוכנית החינמית ניתן לתמלל הקלטות של עד 20 דקות. שדרגו לחשבון בתשלום כדי לתמלל הרצאות באורך מלא."
    : "Free accounts can transcribe recordings up to 20 minutes. Top up your account to transcribe full-length lectures.";
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
