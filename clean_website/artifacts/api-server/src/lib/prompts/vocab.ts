// Deterministic, AI-free generation path for materials that
// looksLikeVocabularyList() (see validation.ts) identifies as a plain
// "term - definition" word list. A general-purpose summarizer/quiz
// generator adds no value over a word list and risks paraphrasing terms
// the student needs verbatim, so these helpers build flashcards and
// multiple-choice questions directly from the parsed term/definition pairs
// instead of asking Gemini to do it.

export const VOCAB_SYSTEM_INSTRUCTION =
  "You are a vocabulary tutor. For summaries: list each term with its definition and usage examples. For flashcards: create word ↔ definition pairs (front = word/term, back = its definition). For quizzes: generate fill-in-the-blank sentences where the student must supply the missing word. For exams: ask for synonyms and antonyms of the studied terms.";

const VOCAB_LINE_PATTERN = /^([^\n]{1,60}?)[ \t]*[-:–—\t][ \t]*([^\n]{1,200})$/;
const HEBREW_PATTERN = /[֐-׿]/;

export interface VocabEntry {
  term: string;
  definition: string;
}

export function parseVocabEntries(text: string | null | undefined): VocabEntry[] {
  const lines = (text || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const entries: VocabEntry[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const m = line.match(VOCAB_LINE_PATTERN);
    if (!m) continue;
    const term = m[1].trim();
    const definition = m[2].trim();
    if (!term || !definition) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ term, definition });
  }
  return entries;
}

export function shuffle<T>(arr: T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function isHebrew(s: string): boolean {
  return HEBREW_PATTERN.test(s);
}

// Front = term, back = definition, exactly as written in the source list --
// re-randomized on every call (per spec: "never the same" order twice).
export function generateVocabFlashcards(entries: VocabEntry[]): Array<{ front: string; back: string; difficulty: string; cardType: string; concept: string }> {
  return shuffle(entries).map((e) => ({
    front: e.term,
    back: e.definition,
    difficulty: "medium",
    cardType: "vocab",
    concept: e.term,
  }));
}

// Normalizes term/definition pairs into explicit English/Hebrew sides so the
// quiz can ask in either direction regardless of which column the source
// file happened to put the English word in.
interface VocabPair {
  en: string;
  he: string;
}

function toVocabPairs(entries: VocabEntry[]): VocabPair[] {
  return entries.map((e) =>
    isHebrew(e.term) ? { he: e.term, en: e.definition } : { en: e.term, he: e.definition }
  );
}

export function pickDistractors(pool: string[], correct: string, count: number): string[] {
  const candidates = shuffle(pool.filter((v) => v.toLowerCase() !== correct.toLowerCase()));
  return candidates.slice(0, count);
}

export interface VocabMCQuestion {
  question: string;
  answer: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  questionType: "multiple_choice";
  difficulty: string;
  concept: string;
  modelAnswer?: undefined;
  optionExplanations?: undefined;
}

// One "Word -> 4 options" question. forward=true asks EN word -> HE options;
// forward=false flips it to HE word -> EN options (the spec's dual
// directionality). Returns null when there isn't enough vocabulary to build
// a real 4-way distractor set.
function buildMCQuestion(pair: VocabPair, allPairs: VocabPair[], forward: boolean): VocabMCQuestion | null {
  const promptSide = forward ? pair.en : pair.he;
  const answerSide = forward ? pair.he : pair.en;
  if (!promptSide || !answerSide) return null;
  const pool = allPairs.map((p) => (forward ? p.he : p.en)).filter(Boolean);
  const distractors = pickDistractors(pool, answerSide, 3);
  if (distractors.length < 3) return null;
  const options = shuffle([answerSide, ...distractors]);
  return {
    question: promptSide,
    answer: answerSide,
    options,
    correctIndex: options.indexOf(answerSide),
    explanation: `${pair.en} = ${pair.he}`,
    questionType: "multiple_choice",
    difficulty: "medium",
    concept: pair.en || pair.he,
  };
}

// "Dynamic Matching" quiz: alternates EN->HE and HE->EN across entries so
// both directions are represented, stopping once `count` valid questions
// have been built (or vocabulary runs out).
export function generateVocabQuiz(entries: VocabEntry[], count: number): VocabMCQuestion[] {
  const pairs = toVocabPairs(entries);
  if (pairs.length < 4) return [];
  const order = shuffle(pairs);
  const questions: VocabMCQuestion[] = [];
  for (let i = 0; questions.length < count && i < order.length * 2; i++) {
    const pair = order[i % order.length];
    const forward = i % 2 === 0;
    const q = buildMCQuestion(pair, pairs, forward);
    if (q) questions.push(q);
  }
  return questions;
}

// Picks up to `count` entries (cycling, deduped) to hand to the AI
// fill-in-blank sentence generator -- keeps that prompt's input bounded
// even for very long vocabulary lists.
export function pickEntriesForFillInBlank(entries: VocabEntry[], count: number): VocabEntry[] {
  return shuffle(entries).slice(0, Math.min(count, entries.length));
}
