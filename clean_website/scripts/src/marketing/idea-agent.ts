import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "@google/genai";

// Repo layout: clean_website/scripts/src/marketing/idea-agent.ts -> repo root
// is four levels up.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const BACKLOG_PATH = join(REPO_ROOT, "marketing/ideas/backlog.json");
const PAGES_DIR = join(REPO_ROOT, "clean_website/artifacts/study-platform/src/pages");
const PAGES_SOURCE_PREFIX = "clean_website/artifacts/study-platform/src/pages";

// Account/legal/meta pages aren't student-facing "features" worth marketing --
// skip them outright rather than asking Gemini to filter them every run.
const EXCLUDED_PAGES = new Set([
  "auth.tsx",
  "contact.tsx",
  "privacy.tsx",
  "terms.tsx",
  "not-found.tsx",
  "profile.tsx",
  "landing.tsx",
]);

// Caps how many brand-new ideas one run can add, so a single invocation can't
// flood the backlog if many features are uncovered at once.
const MAX_NEW_IDEAS_PER_RUN = 6;
const SNIPPET_MAX_CHARS = 6000;

const MODEL = "gemini-2.5-flash";

interface BacklogIdea {
  id: string;
  created_at: string;
  format: string;
  channel_hint: string;
  title: string;
  angle: string;
  source: string;
  script_or_caption_draft: string;
  status: string;
}

interface Backlog {
  schema: Record<string, string>;
  ideas: BacklogIdea[];
}

interface GeneratedIdea {
  file: string;
  format: "image" | "reel" | "banner" | "video";
  channel_hint: "instagram" | "facebook" | "heygen" | "any";
  title: string;
  angle: string;
  script_or_caption_draft: string;
}

function loadBacklog(): Backlog {
  return JSON.parse(readFileSync(BACKLOG_PATH, "utf-8"));
}

function saveBacklog(backlog: Backlog): void {
  writeFileSync(BACKLOG_PATH, JSON.stringify(backlog, null, 2) + "\n", "utf-8");
}

// Existing ideas reference their source page(s) as free text (e.g.
// "feature:.../recorder.tsx + material-new.tsx") -- pull out every .tsx
// filename mentioned anywhere so a page already covered under any wording
// isn't offered to the model again.
function alreadyCoveredFiles(backlog: Backlog): Set<string> {
  const covered = new Set<string>();
  for (const idea of backlog.ideas) {
    for (const match of idea.source.matchAll(/([\w-]+\.tsx)/g)) {
      covered.add(match[1]);
    }
  }
  return covered;
}

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

function nextIdeaId(backlog: Backlog, offset: number): string {
  const today = new Date().toISOString().slice(0, 10);
  const todaysCount = backlog.ideas.filter((i) => i.id.startsWith(`idea-${today}-`)).length;
  const seq = todaysCount + offset + 1;
  return `idea-${today}-${String(seq).padStart(3, "0")}`;
}

function safeJsonParse(rawText: string): any {
  const text = rawText.trim();
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenceMatch ? fenceMatch[1].trim() : text;
  return JSON.parse(candidate);
}

async function generateIdeasForCandidates(
  candidates: { file: string; snippet: string }[],
): Promise<GeneratedIdea[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is required but was not provided.");
  }
  const ai = new GoogleGenAI({ apiKey });

  const systemInstruction = `אתה אסטרטג תוכן שיווקי עבור FocusStudy, אפליקציית לימוד ישראלית מבוססת AI (סיכומים, כרטיסיות, מבחני תרגול, צ'אט על החומר, פודקאסטים, חזרות מרווחות).
תפקידך: לקבל קטעי קוד מדפי פיצ'ר באפליקציה, ולהחליט האם כל אחד מהם מייצג פיצ'ר אמיתי שמשתמש קצה חווה וששווה לשווק אותו ברשתות חברתיות.
עבור כל פיצ'ר שכן שווה לשווק, כתוב רעיון תוכן קונקרטי אחד בעברית.
דלג לגמרי (אל תכלול בפלט) על קבצים שהם טכניים גרידא, מסך שגיאה, מסך ריק, או לא מייצגים פיצ'ר שמשתמש רגיל היה מספר עליו לחבר.

הפלט חייב להיות מערך JSON תקני בלבד (ללא טקסט נוסף, ללא גדר קוד), כאשר כל איבר הוא אובייקט עם השדות:
- file: שם קובץ הפיצ'ר בדיוק כפי שסופק
- format: אחד מ- "image" | "reel" | "banner" | "video"
- channel_hint: אחד מ- "instagram" | "facebook" | "heygen" | "any"
- title: כותרת קצרה לרעיון
- angle: משפט או שניים שמסבירים את זווית השיווק
- script_or_caption_draft: טיוטת קאפשן/תסריט קצר בעברית, בסגנון חם וממוקד תלמידים`;

  const prompt = `הנה קטעי קוד מדפי פיצ'ר שעדיין לא כוסו ב-backlog השיווקי. עבור כל אחד, החלט אם שווה רעיון תוכן, ואם כן - כתוב אותו לפי ההנחיות:\n\n${candidates
    .map((c) => `## קובץ: ${c.file}\n\`\`\`tsx\n${c.snippet}\n\`\`\``)
    .join("\n\n")}`;

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      systemInstruction,
      temperature: 0.6,
      responseMimeType: "application/json",
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  const text = response.text;
  if (!text) throw new Error("Gemini returned an empty response.");

  const parsed = safeJsonParse(text);
  if (!Array.isArray(parsed)) throw new Error("Expected a JSON array of ideas from Gemini.");
  return parsed as GeneratedIdea[];
}

async function main() {
  const backlog = loadBacklog();
  const covered = alreadyCoveredFiles(backlog);
  const existingTitles = new Set(backlog.ideas.map((i) => normalizeTitle(i.title)));

  const candidateFiles = readdirSync(PAGES_DIR)
    .filter((f) => f.endsWith(".tsx"))
    .filter((f) => !EXCLUDED_PAGES.has(f) && !covered.has(f));

  if (candidateFiles.length === 0) {
    console.log("No uncovered feature pages found -- backlog is already up to date.");
    return;
  }

  const candidates = candidateFiles.map((file) => ({
    file,
    snippet: readFileSync(join(PAGES_DIR, file), "utf-8").slice(0, SNIPPET_MAX_CHARS),
  }));

  console.log(`Asking Gemini to evaluate ${candidates.length} uncovered page(s): ${candidateFiles.join(", ")}`);
  const generated = await generateIdeasForCandidates(candidates);

  let added = 0;
  for (const idea of generated) {
    if (added >= MAX_NEW_IDEAS_PER_RUN) break;
    if (!idea.title || !idea.format || !idea.channel_hint || !idea.script_or_caption_draft) continue;
    if (existingTitles.has(normalizeTitle(idea.title))) continue;

    const newIdea: BacklogIdea = {
      id: nextIdeaId(backlog, added),
      created_at: new Date().toISOString(),
      format: idea.format,
      channel_hint: idea.channel_hint,
      title: idea.title,
      angle: idea.angle,
      source: `feature:${PAGES_SOURCE_PREFIX}/${idea.file}`,
      script_or_caption_draft: idea.script_or_caption_draft,
      status: "new",
    };
    backlog.ideas.push(newIdea);
    existingTitles.add(normalizeTitle(newIdea.title));
    added++;
  }

  if (added === 0) {
    console.log("Gemini didn't return any new usable ideas this run.");
    return;
  }

  saveBacklog(backlog);
  console.log(`Added ${added} new idea(s) to marketing/ideas/backlog.json.`);
}

main().catch((error) => {
  console.error("idea-agent failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
