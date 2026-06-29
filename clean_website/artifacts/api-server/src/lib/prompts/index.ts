// The Dispatcher. getSystemPrompt() runs a lightweight keyword check against
// the material content and returns the matching category's system prompt,
// falling back to base.ts's General prompt when nothing scores high enough.
// Category modules stay thin (just the system instruction text) -- all the
// classification and modifier logic lives here, in one place.
import { looksLikeVocabularyList } from "../validation";
import { VOCAB_SYSTEM_INSTRUCTION } from "./vocab";
import { STEM_SYSTEM_INSTRUCTION } from "./stem";
import { LITERATURE_SYSTEM_INSTRUCTION } from "./literature";
import { HISTORY_SYSTEM_INSTRUCTION } from "./history";
import { GENERAL_SYSTEM_INSTRUCTION, appendGlobalModifier, StudyMode } from "./base";

export type { StudyMode } from "./base";

export type ContentCategory = "vocabulary" | "stem" | "literature" | "history" | "general";

type ScoredCategory = Exclude<ContentCategory, "vocabulary" | "general">;

// Lightweight presence-based keyword check, not an ML classifier -- same
// spirit as validation.ts's looksLikeVocabularyList: cheap, deterministic,
// good enough to route to the right prompt without an extra AI call.
const CATEGORY_KEYWORDS: Record<ScoredCategory, string[]> = {
  stem: [
    "equation", "formula", "theorem", "derivative", "integral", "velocity", "acceleration",
    "force", "energy", "algorithm", "function", "variable", "loop", "array", "complexity",
    "recursion", "matrix", "vector", "calculus", "algebra", "physics", "molecule", "atom",
    "נוסחה", "משוואה", "משפט", "נגזרת", "אינטגרל", "מהירות", "תאוצה", "כוח", "אנרגיה",
    "אלגוריתם", "פונקציה", "משתנה", "פיזיקה", "מתמטיקה", "אלגברה", "מטריצה", "וקטור",
  ],
  literature: [
    "novel", "poem", "author", "character", "theme", "motif", "narrator", "protagonist",
    "metaphor", "symbolism", "literature", "stanza", "plot", "literary",
    "רומן", "שיר", "מחבר", "דמות", "נושא", "מוטיב", "מספר הסיפור", "גיבור", "מטאפורה",
    "סמליות", "ספרות", "עלילה", "יצירה",
  ],
  history: [
    "century", "war", "revolution", "empire", "dynasty", "treaty", "monarchy", "timeline",
    "historical", "era", "regime", "colonial",
    "מאה", "מלחמה", "מהפכה", "אימפריה", "שלטון", "אמנה", "מלוכה", "היסטוריה", "תקופה",
    "ציר זמן", "משטר",
  ],
};

// Minimum total keyword occurrences before a category is trusted over
// General -- a couple of stray hits in an otherwise generic document
// shouldn't be enough to flip the prompt.
const MIN_CATEGORY_SCORE = 3;

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = 0;
  while ((index = haystack.indexOf(needle, index)) !== -1) {
    count++;
    index += needle.length;
  }
  return count;
}

export function classifyContent(content: string | null | undefined): ContentCategory {
  const text = (content || "");
  if (looksLikeVocabularyList(text)) return "vocabulary";
  if (!text.trim()) return "general";

  const lower = text.toLowerCase();
  let best: ContentCategory = "general";
  let bestScore = MIN_CATEGORY_SCORE - 1;
  for (const category of Object.keys(CATEGORY_KEYWORDS) as ScoredCategory[]) {
    const score = CATEGORY_KEYWORDS[category].reduce(
      (sum, kw) => sum + countOccurrences(lower, kw.toLowerCase()),
      0,
    );
    if (score > bestScore) {
      bestScore = score;
      best = category;
    }
  }
  return best;
}

const SYSTEM_INSTRUCTIONS: Record<ContentCategory, string> = {
  vocabulary: VOCAB_SYSTEM_INSTRUCTION,
  stem: STEM_SYSTEM_INSTRUCTION,
  literature: LITERATURE_SYSTEM_INSTRUCTION,
  history: HISTORY_SYSTEM_INSTRUCTION,
  general: GENERAL_SYSTEM_INSTRUCTION,
};

export interface SystemPromptResult {
  category: ContentCategory;
  systemInstruction: string;
}

export function getSystemPrompt(content: string, mode?: StudyMode): SystemPromptResult {
  const category = classifyContent(content);
  const systemInstruction = appendGlobalModifier(SYSTEM_INSTRUCTIONS[category], mode);
  return { category, systemInstruction };
}
