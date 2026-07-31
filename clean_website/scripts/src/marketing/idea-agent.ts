import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "@google/genai";

// Repo layout: clean_website/scripts/src/marketing/idea-agent.ts -> repo root
// is four levels up.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const BACKLOG_PATH = join(REPO_ROOT, "marketing/ideas/backlog.json");
const TRENDS_DIR = join(REPO_ROOT, "marketing/trends");
const PAGES_DIR = join(REPO_ROOT, "clean_website/artifacts/study-platform/src/pages");
const PAGES_SOURCE_PREFIX = "clean_website/artifacts/study-platform/src/pages";
const TREND_LOOKBACK_DAYS = 30;
const TREND_PLATFORMS = ["Instagram (Reels)", "TikTok", "X (Twitter)", "Facebook", "YouTube Shorts"];

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
  // Which researched trend format (see marketing/trends/*.md) the script below
  // was modeled on. Optional field -- absent on ideas seeded before the
  // trend-research skill existed.
  trend_reference?: string;
  script_or_caption_draft: string;
  // The exact words to be spoken by a HeyGen avatar -- no stage directions,
  // beat labels, or on-screen-text notes, just the narration itself in
  // order. Optional field -- absent on ideas seeded before this existed;
  // the heygen-agent skips those rather than reading stage directions aloud.
  voiceover_text?: string;
  // The actual text to post alongside the video/image on Instagram/Facebook
  // (short marketing copy + hashtags) -- distinct from the full production
  // script above. Optional field -- absent on ideas seeded before this
  // existed; the publish-agent skips those rather than posting a script as
  // a caption.
  caption?: string;
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
  trend_reference: string;
  script_or_caption_draft: string;
  voiceover_text: string;
  caption: string;
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

// Researches real, current social-media trends via Gemini's Google Search
// grounding tool (not the model's training data) so the ideas below are based
// on what's actually working on each platform right now, not stale patterns.
// Cached to one file per calendar day -- re-running the agent several times
// in the same day reuses the existing research instead of re-querying.
async function researchSocialTrends(ai: GoogleGenAI): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const cachePath = join(TRENDS_DIR, `${today}.md`);
  if (existsSync(cachePath)) {
    console.log(`Using cached trend research from ${cachePath}`);
    return readFileSync(cachePath, "utf-8");
  }

  const now = new Date();
  const lookbackStart = new Date(now.getTime() - TREND_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const prompt = `חקור ביסודיות רבה, באמצעות חיפוש אמיתי ועדכני (אל תסתמך על ידע כללי ישן, ואל תמציא) -- מה היו הטרנדים החמים ביותר ב-${TREND_LOOKBACK_DAYS} הימים האחרונים (${lookbackStart.toISOString().slice(0, 10)} עד ${now.toISOString().slice(0, 10)}) בכל אחת מהפלטפורמות החברתיות הרשמיות הבאות: ${TREND_PLATFORMS.join(", ")}.

התמקד בטרנדים שרלוונטיים או ניתנים להתאמה לתוכן בנושאי לימודים, סטודנטים, פרודוקטיביות ולמידה עם AI -- אבל דווח על הטרנדים המדויקים כפי שהם, אל תעוות אותם כדי "להתאים" בכוח.

עבור כל טרנד, כתוב בעברית:
1. **שם/תיאור הטרנד** ובאיזו פלטפורמה/פלטפורמות הוא רץ עכשיו.
2. **מבנה בפועל**: איך נראה ה-hook (2-3 השניות הראשונות), מבנה ההמשך בפועל (beat by beat), אורך טיפוסי, סאונד/מוזיקה/טקסט-על-מסך אופייני, וסגנון עריכה/צילום.
3. **למה זה עובד** -- למה הפורמט הזה יוצר engagement.

תן לפחות 6 טרנדים שונים, כל אחד עם הפירוט המלא הזה. פלט: טקסט/מארקדאון רגיל, לא JSON.`;

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      tools: [
        {
          googleSearch: {
            timeRangeFilter: { startTime: lookbackStart.toISOString(), endTime: now.toISOString() },
          },
        },
      ],
      temperature: 0.3,
      maxOutputTokens: 4000,
    },
  });

  const text = response.text;
  if (!text) throw new Error("Gemini returned an empty trend-research response.");

  mkdirSync(TRENDS_DIR, { recursive: true });
  writeFileSync(
    cachePath,
    `# Social trend research -- ${today}\nWindow: ${lookbackStart.toISOString()} to ${now.toISOString()}\nPlatforms: ${TREND_PLATFORMS.join(", ")}\n\n${text}\n`,
    "utf-8",
  );
  console.log(`Saved trend research to ${cachePath}`);
  return text;
}

async function generateIdeasForCandidates(
  ai: GoogleGenAI,
  trendBrief: string,
  candidates: { file: string; snippet: string }[],
): Promise<GeneratedIdea[]> {
  const systemInstruction = `אתה אסטרטג תוכן שיווקי עבור FocusStudy, אפליקציית לימוד ישראלית מבוססת AI (סיכומים, כרטיסיות, מבחני תרגול, צ'אט על החומר, פודקאסטים, חזרות מרווחות).
תפקידך: לקבל קטעי קוד מדפי פיצ'ר באפליקציה ותקציר מחקר טרנדים עדכני מהרשתות החברתיות, ולהחליט אילו פיצ'רים שווה לשווק.
עבור כל פיצ'ר שכן שווה לשווק, בחר את הטרנד המתאים ביותר מהתקציר (או שילוב שלהם) והשתמש בו בפועל -- לא רק כנושא, אלא כמבנה של התסריט עצמו (hook, beats, אורך, סגנון עריכה/סאונד).
דלג לגמרי (אל תכלול בפלט) על קבצים שהם טכניים גרידא, מסך שגיאה, מסך ריק, או לא מייצגים פיצ'ר שמשתמש רגיל היה מספר עליו לחבר.

הפלט חייב להיות מערך JSON תקני בלבד (ללא טקסט נוסף, ללא גדר קוד), כאשר כל איבר הוא אובייקט עם השדות:
- file: שם קובץ הפיצ'ר בדיוק כפי שסופק
- format: אחד מ- "image" | "reel" | "banner" | "video"
- channel_hint: אחד מ- "instagram" | "facebook" | "heygen" | "any"
- title: כותרת קצרה לרעיון
- angle: משפט או שניים שמסבירים את זווית השיווק
- trend_reference: שם הטרנד (מהתקציר) שעליו מבוסס התסריט, ומשפט קצר למה הוא מתאים לפיצ'ר הזה
- script_or_caption_draft: תסריט מקיף ומפורט (לא רק כותרת/קאפשן) -- כתוב beat-by-beat: השורה/תמונה הפותחת (hook), מה קורה בכל שנייה/קטע לאורך הסרטון, טקסט-על-מסך אם רלוונטי, וסיום/CTA. חייב לשקף בפועל את מבנה הטרנד שנבחר, לא רק להזכיר את שמו
- voiceover_text: אך ורק המילים שיוקראו בקול על ידי אווטאר (לצורך יצירת וידאו אוטומטית) -- ברצף טבעי מההתחלה ועד הסוף, בלי שום תווית בימוי כמו "Hook:" או "טקסט על מסך:", בלי תיאורי מצלמה/עריכה, רק הנאום עצמו בעברית תקינה ורהוטה
- caption: הקאפשן בפועל שיפורסם מתחת לפוסט באינסטגרם/פייסבוק (לא התסריט) -- 2-3 משפטים קצרים וקליטים בעברית, ואז שורה של 3-5 האשטגים רלוונטיים`;

  const prompt = `## תקציר מחקר טרנדים חברתיים (${TREND_LOOKBACK_DAYS} הימים האחרונים)\n${trendBrief}\n\n---\n\nהנה קטעי קוד מדפי פיצ'ר שעדיין לא כוסו ב-backlog השיווקי. עבור כל אחד, החלט אם שווה רעיון תוכן, ואם כן -- כתוב אותו לפי ההנחיות, מבוסס בפועל על אחד הטרנדים שלמעלה:\n\n${candidates
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
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is required but was not provided.");
  }
  const ai = new GoogleGenAI({ apiKey });

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

  console.log(`Researching the last ${TREND_LOOKBACK_DAYS} days of social trends across ${TREND_PLATFORMS.join(", ")}...`);
  const trendBrief = await researchSocialTrends(ai);

  console.log(`Asking Gemini to evaluate ${candidates.length} uncovered page(s): ${candidateFiles.join(", ")}`);
  const generated = await generateIdeasForCandidates(ai, trendBrief, candidates);

  let added = 0;
  for (const idea of generated) {
    if (added >= MAX_NEW_IDEAS_PER_RUN) break;
    if (!idea.title || !idea.format || !idea.channel_hint || !idea.script_or_caption_draft || !idea.voiceover_text || !idea.caption) continue;
    if (existingTitles.has(normalizeTitle(idea.title))) continue;

    const newIdea: BacklogIdea = {
      id: nextIdeaId(backlog, added),
      created_at: new Date().toISOString(),
      format: idea.format,
      channel_hint: idea.channel_hint,
      title: idea.title,
      angle: idea.angle,
      source: `feature:${PAGES_SOURCE_PREFIX}/${idea.file}`,
      trend_reference: idea.trend_reference,
      script_or_caption_draft: idea.script_or_caption_draft,
      voiceover_text: idea.voiceover_text,
      caption: idea.caption,
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
