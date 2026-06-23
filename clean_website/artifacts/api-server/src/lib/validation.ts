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

export function isContentTooShort(text: string | null | undefined): boolean {
  return getTrimmedLength(text) < MIN_CONTENT_LENGTH;
}

export function getWordCount(text: string | null | undefined): number {
  const trimmed = (text || "").trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
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
