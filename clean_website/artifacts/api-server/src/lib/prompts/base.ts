// Common formatting instructions shared by every content category. Anything
// that isn't specific to a category (vocabulary, STEM, literature, history)
// belongs here -- the dispatcher (index.ts) falls back to this module for
// the "General" path so there's exactly one copy of the default
// instructions instead of one per category.
export const GENERAL_SYSTEM_INSTRUCTION =
  "You are a helpful study assistant. For summaries: create a clear, comprehensive general summary. For flashcards: create concept ↔ explanation pairs (front = concept or term, back = its explanation). For quizzes: generate multiple-choice questions covering the main ideas. For exams: ask open-ended questions that require the student to demonstrate understanding.";

// Appended to every category's system instruction on top of the category
// pick itself -- lets the same five prompts above flex for how much detail
// the student wants right now without forking a prompt per category per mode.
export const GLOBAL_MODIFIERS = {
  emergency: "Keep response extremely brief. Focus ONLY on exam-critical information.",
  general: "Provide a comprehensive and detailed explanation.",
} as const;

export type StudyMode = keyof typeof GLOBAL_MODIFIERS;

export function appendGlobalModifier(systemInstruction: string, mode?: StudyMode): string {
  const modifier = mode ? GLOBAL_MODIFIERS[mode] : undefined;
  return modifier ? `${systemInstruction}\n\n${modifier}` : systemInstruction;
}
