import OpenAI from "openai";
import { splitTextIntoChunks } from "./chunker";
import { setGenerationProgress, clearGenerationProgress } from "./progress";

if (!process.env.GROQ_API_KEY) {
  throw new Error("GROQ_API_KEY environment variable is required but was not provided.");
}

export const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
});

// Primary model for every chunk/call. Using the 8b model instead of the 70b
// one keeps us on Groq's much larger free-tier daily token allowance
// (500k/day vs 100k/day), which matters for large multi-chunk PDFs. Only an
// individual chunk that hits a 429 and exhausts its retries drops down to
// FALLBACK_TEXT_MODEL.
const TEXT_MODEL = "llama-3.1-8b-instant";
// Used only as a last resort for a single chunk after the primary model has
// exhausted its retries — a different lightweight model on a separate Groq
// rate-limit bucket, so a chunk can often still succeed even while
// llama-3.1-8b is being throttled. Only ever used for the specific chunk(s)
// that were rate-limited, not the whole document.
const FALLBACK_TEXT_MODEL = "gemma2-9b-it";
export const AUDIO_MODEL = "whisper-large-v3";

export interface AIGenerationOptions {
  language: "he" | "en";
  materialContent: string;
  materialTitle: string;
  // When provided, chunked generation reports "chunk X of Y" progress here
  // so the frontend can poll GET /materials/:id/progress and show a real
  // status instead of a generic spinner during long sequential processing.
  materialId?: number;
}

// פונקציית עזר חסינת תקלות משופרת לחילוץ ופענוח JSON מה-AI
function safeJsonParse(rawText: string): any {
  if (!rawText) return {};
  const cleaned = rawText.trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    try {
      // חילוץ מדויק מהסוגריים המסולסלים הראשונים ועד האחרונים
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
      }
    } catch (innerError) {
      console.error("Failed to parse AI JSON response:", rawText);
    }
    return {};
  }
}

const SMART_STUDENT_SYSTEM_HE = `אתה תלמיד מחונן ונלהב שמסכם חומרי לימוד עבור חבריו לכיתה — מהסוג שכולם רוצים את הסיכומים שלו לפני המבחן.
סגנון הכתיבה שלך: חם, ברור, ממוקד, אקדמי אך נגיש — כמו חבר טוב שמסביר ולא כמו ספר לימוד יבש.
אתה משתמש בדוגמאות קונקרטיות כדי להמחיש מושגים מורכבים, ומוסיף "טיפ זהב" קצר במקומות שבהם תלמידים נוטים להתבלבל או לטעות במבחן.

STRICT OPERATIONAL RULES (VIOLATION WILL BREAK THE SYSTEM):
1. STRICT TRUTH: You must strictly rely ONLY on the provided text or audio transcript. DO NOT add outside knowledge.
2. ZERO DUPLICATION: DO NOT generate the same question, concept, or answer more than once. Every single flashcard must test a COMPLETELY DIFFERENT fact.
3. DIVERSITY: If you already asked about "the color of the fur", you CANNOT ask about it again in another card, not even with different wording.
4. QUALITY OVER QUANTITY: Do not try to reach a high number of cards by repeating concepts or making up filler text. If the facts in the text are exhausted, STOP GENERATING MORE CARDS. It is better to return 6 unique cards than 15 repetitive ones.
5. STRICT GROUNDING: You are strictly forbidden from hallucinating or fabricating information. If the source text lacks depth, do not stretch or invent concepts. Quality and precision always come before filling up quantity.
6. MISSING CONTEXT: If the provided text is empty, unreadable, or too short/corrupted to contain real study content (e.g. an error message instead of actual material), DO NOT invent a summary from general knowledge. Instead return content/cards/questions that explicitly state the material could not be read and ask the user to re-upload it.

ענה תמיד בעברית תקינה ואקדמית בלבד על בסיס הטקסט המסופק בלבד.
הפלט חייב להיות קובץ JSON תקני בלבד — אל תוסיף שום מילה, הסבר או סימני Markdown לפני או אחרי ה-JSON.`;

const SMART_STUDENT_SYSTEM_EN = `You are a gifted and enthusiastic student who summarizes study materials for classmates — the kind of student whose notes everyone wants before the exam.
Your writing style: warm, clear, focused, academic yet genuinely engaging — like a sharp friend explaining things over coffee, not a dry textbook.
You identify what truly matters for exams, what is hard to understand, and what is worth remembering. You illustrate tricky concepts with concrete examples, and drop a short "Pro Tip" wherever students commonly get confused or lose points on exams.

STRICT GROUNDING: You are strictly forbidden from hallucinating or fabricating information. If the source text lacks depth, do not stretch or invent concepts. Quality and precision always come before filling up quantity.

MISSING CONTEXT: If the provided text is empty, unreadable, or too short/corrupted to contain real study content (e.g. an error message instead of actual material), DO NOT invent a summary from general knowledge. Instead return content that explicitly states the material could not be read and asks the user to re-upload it.

Always respond in clear English only.
Output must be a valid JSON object only — do not include any markdown formatting or commentary outside the JSON.`;

function contentSlice(text: string, maxChars = 20000): string {
  return text.length > maxChars ? text.slice(0, maxChars) + "\n\n[...תוכן קוצר בגלל אורך...]" : text;
}

// Retries on rate limits (429) and transient server/network errors. Other
// errors (bad request, auth, etc.) are not retryable and fail immediately.
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const MAX_RETRY_ATTEMPTS = 4;
const BASE_RETRY_DELAY_MS = 1000;

function isRetryableError(error: any): boolean {
  const status = error?.status ?? error?.response?.status;
  if (typeof status === "number") return RETRYABLE_STATUS_CODES.has(status);
  // Network-level failures (no HTTP status) are typically transient.
  return error?.code === "ECONNRESET" || error?.code === "ETIMEDOUT" || error?.code === "ENOTFOUND";
}

// Thrown instead of retrying when Groq reports a retry-after long enough
// that waiting it out within the request would be pointless (and would just
// keep hammering an already-exhausted rate-limit window). Carries a
// user-facing message so app.ts's catch-all handler can surface it as-is.
export class RateLimitExhaustedError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super("System is currently at maximum capacity. Please try again in 20 minutes.");
    this.name = "RateLimitExhaustedError";
    tripCircuitBreaker(retryAfterSeconds);
  }
}

// Circuit breaker: once a hard rate limit is confirmed (see
// RateLimitExhaustedError above), every subsequent Groq call across the
// whole process is blocked until the cool-down passes — instead of letting
// a stray click or a new request slip through and extend the penalty.
// Module-level state is sufficient here: this is a single-process API
// server, and the goal is just to stop hammering Groq, not to coordinate
// across instances.
const CIRCUIT_BREAKER_MAX_COOLDOWN_MS = 60 * 60 * 1000;
let circuitBreakerBlockedUntil: number | null = null;

function tripCircuitBreaker(retryAfterSeconds: number): void {
  const cooldownMs = Math.min(Math.max(retryAfterSeconds, 1) * 1000, CIRCUIT_BREAKER_MAX_COOLDOWN_MS);
  const until = Date.now() + cooldownMs;
  if (!circuitBreakerBlockedUntil || until > circuitBreakerBlockedUntil) {
    circuitBreakerBlockedUntil = until;
  }
  console.error(`Circuit breaker tripped: blocking all Groq calls until ${new Date(circuitBreakerBlockedUntil).toISOString()}.`);
}

export class SystemBlockedError extends Error {
  constructor(public readonly retryAfterMinutes: number) {
    super(`We are currently in a cool-down period due to rate limits. Please try again in ${retryAfterMinutes} minutes.`);
    this.name = "SystemBlockedError";
  }
}

// Must be called as the first step before any Groq call (and explicitly
// before any aggregation/chunking work begins) so an already-confirmed hard
// limit fails instantly without burning more budget or wasted chunking work.
function checkCircuitBreaker(): void {
  if (circuitBreakerBlockedUntil === null) return;
  const remainingMs = circuitBreakerBlockedUntil - Date.now();
  if (remainingMs <= 0) {
    circuitBreakerBlockedUntil = null;
    return;
  }
  throw new SystemBlockedError(Math.ceil(remainingMs / 60000));
}

const HARD_LIMIT_RETRY_AFTER_THRESHOLD_S = 60;

function getRetryAfterSeconds(error: any): number | undefined {
  const status = error?.status ?? error?.response?.status;
  if (status !== 429) return undefined;
  const headers = error?.headers ?? error?.response?.headers;
  const raw = typeof headers?.get === "function" ? headers.get("retry-after") : headers?.["retry-after"];
  const seconds = Number(raw);
  return Number.isFinite(seconds) ? seconds : undefined;
}

// Logs every 429 with the data needed to tell a per-request burst apart from
// a per-token-volume throttle: the rate-limit headers Groq sends back (when
// present) report remaining requests/tokens for the window, and approxTokens
// (a rough chars/4 estimate) shows how big the offending request actually was.
function log429(context: string, error: any, approxTokens?: number) {
  const status = error?.status ?? error?.response?.status;
  if (status !== 429) return;
  const headers = error?.headers ?? error?.response?.headers;
  const get = (name: string) => (typeof headers?.get === "function" ? headers.get(name) : headers?.[name]);
  console.warn(
    `[429] ${context} | remaining-requests=${get("x-ratelimit-remaining-requests") ?? "?"} ` +
    `remaining-tokens=${get("x-ratelimit-remaining-tokens") ?? "?"} ` +
    `retry-after=${get("retry-after") ?? "?"}s ` +
    `approxTokens=${approxTokens ?? "?"}`
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wraps a Groq chat-completion call with exponential backoff retry for
 * rate limits (429) and transient errors, so a single flaky request doesn't
 * take down the whole pipeline (and, in turn, the HTTP response) with it.
 */
async function callGroqWithRetry(
  params: Parameters<typeof groq.chat.completions.create>[0]
): Promise<OpenAI.Chat.ChatCompletion> {
  checkCircuitBreaker();
  let lastError: any;
  for (let attempt = 0; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
    try {
      return (await groq.chat.completions.create(params)) as OpenAI.Chat.ChatCompletion;
    } catch (error: any) {
      lastError = error;
      log429("callGroqWithRetry", error);
      const retryAfter = getRetryAfterSeconds(error);
      if (retryAfter !== undefined && retryAfter > HARD_LIMIT_RETRY_AFTER_THRESHOLD_S) {
        console.error(`callGroqWithRetry: retry-after=${retryAfter}s exceeds hard-limit threshold, failing fast instead of retrying.`);
        throw new RateLimitExhaustedError(retryAfter);
      }
      if (attempt === MAX_RETRY_ATTEMPTS || !isRetryableError(error)) {
        throw error;
      }
      const delay = BASE_RETRY_DELAY_MS * 2 ** attempt + Math.random() * 250;
      console.warn(
        `Groq call failed (attempt ${attempt + 1}/${MAX_RETRY_ATTEMPTS + 1}, status ${error?.status ?? "?"}). Retrying in ${Math.round(delay)}ms...`
      );
      await sleep(delay);
    }
  }
  throw lastError;
}

// Per-chunk retry/fallback used only by the sequential chunk-summarization
// pipeline (see buildAggregatedContent), where Groq's free-tier limits are
// tightest. Backoff is fixed at 2s/4s/8s (one delay per retry) instead of
// callGroqWithRetry's formula, per the requested escalation. After 3 retries
// on the primary model still fail, we wait the final 16s window and retry
// once on FALLBACK_TEXT_MODEL — a different model with its own separate
// rate-limit bucket — before giving up on the chunk entirely.
const CHUNK_RETRY_DELAYS_MS = [2000, 4000, 8000, 16000];
const MAX_PRIMARY_CHUNK_RETRIES = 3;

async function callGroqForChunk(
  params: Parameters<typeof groq.chat.completions.create>[0],
  chunkLabel: string
): Promise<{ response: OpenAI.Chat.ChatCompletion; usedFallback: boolean }> {
  checkCircuitBreaker();
  const approxTokens = Math.round(JSON.stringify(params.messages).length / 4);
  let lastError: any;

  for (let attempt = 0; attempt <= MAX_PRIMARY_CHUNK_RETRIES; attempt++) {
    try {
      const response = (await groq.chat.completions.create({ ...params, model: TEXT_MODEL })) as OpenAI.Chat.ChatCompletion;
      return { response, usedFallback: false };
    } catch (error: any) {
      lastError = error;
      log429(`${chunkLabel} (primary: ${TEXT_MODEL}, attempt ${attempt + 1}/${MAX_PRIMARY_CHUNK_RETRIES + 1})`, error, approxTokens);
      const retryAfter = getRetryAfterSeconds(error);
      if (retryAfter !== undefined && retryAfter > HARD_LIMIT_RETRY_AFTER_THRESHOLD_S) {
        console.error(`${chunkLabel}: retry-after=${retryAfter}s exceeds hard-limit threshold, aborting instead of retrying/falling back.`);
        throw new RateLimitExhaustedError(retryAfter);
      }
      if (attempt === MAX_PRIMARY_CHUNK_RETRIES || !isRetryableError(error)) break;
      const delay = CHUNK_RETRY_DELAYS_MS[attempt];
      console.warn(`${chunkLabel}: retrying on primary model in ${delay}ms (status ${error?.status ?? "?"})...`);
      await sleep(delay);
    }
  }

  if (!isRetryableError(lastError)) {
    throw lastError;
  }

  console.warn(`${chunkLabel}: primary model exhausted ${MAX_PRIMARY_CHUNK_RETRIES} retries, falling back to ${FALLBACK_TEXT_MODEL} after a 16s cool-down...`);
  await sleep(CHUNK_RETRY_DELAYS_MS[CHUNK_RETRY_DELAYS_MS.length - 1]);

  try {
    const response = (await groq.chat.completions.create({ ...params, model: FALLBACK_TEXT_MODEL })) as OpenAI.Chat.ChatCompletion;
    return { response, usedFallback: true };
  } catch (error: any) {
    log429(`${chunkLabel} (fallback: ${FALLBACK_TEXT_MODEL})`, error, approxTokens);
    console.error(`${chunkLabel}: fallback model ${FALLBACK_TEXT_MODEL} also failed (status ${error?.status ?? "?"}).`);
    // Both the primary and fallback model failed for this chunk — there is
    // nothing left to try. Surface the same hard-limit message regardless of
    // the exact retry-after value, rather than silently patching over a
    // chunk with a placeholder.
    throw new RateLimitExhaustedError(getRetryAfterSeconds(error) ?? 1200);
  }
}

// Above this length, a single Groq call risks silently dropping the tail of
// the document (or the model just skims the title and hallucinates) — so we
// chunk instead of truncating. Below it, material is short enough to pass
// through whole.
const CHUNK_TRIGGER_CHAR_LENGTH = 9000;
// Sized in estimated tokens, not words -- a word-based limit looked safe for
// English but let Hebrew chunks (which tokenize far less efficiently) blow
// past Groq's free-tier 6000 TPM cap on a single request (one chunk hit
// 6450 tokens at the old 600-word limit). 2000 tokens of chunk content still
// leaves headroom under 6000 once the system prompt, instruction template,
// and the model's own Hebrew completion tokens are added in.
const CHUNK_TOKEN_LIMIT = 2000;
// Groq's free tier rate limits are tight enough that even 2 concurrent
// chunk calls on a large document reliably triggers 429s, so chunks are
// processed strictly one at a time (see the for...of loop below) with a
// mandatory pause between calls (whether the previous one succeeded or
// failed) to stay well under Groq's requests-per-minute ceiling. We
// deliberately trade speed for not getting rate-limited on big documents.
const INTER_CHUNK_DELAY_MS = 2500;

async function summarizeChunk(
  chunk: string,
  materialTitle: string,
  isHe: boolean,
  index: number,
  total: number
): Promise<{ text: string; usedFallback: boolean }> {
  const prompt = isHe
    ? `## חלק ${index}/${total} מחומר הלימוד: "${materialTitle}"\n\n${chunk}\n\n---\nסכם בקצרה (כ-150-300 מילים) את כל העובדות, המושגים והנקודות החשובות שמופיעות בקטע הזה בלבד. כתוב כרשימת נקודות עובדתיות וממוקדות, בלי כותרות ובלי הקדמות. אל תשמיט אף עובדה מהותית, ואל תוסיף שום מידע שלא מופיע בקטע.`
    : `## Part ${index}/${total} of study material: "${materialTitle}"\n\n${chunk}\n\n---\nBriefly summarize (~150-300 words) all the facts, concepts, and important points that appear in this part only. Write a focused, factual bullet list — no headings, no preamble. Do not omit any substantive fact, and do not add information that isn't in this part.`;

  const { response, usedFallback } = await callGroqForChunk(
    {
      model: TEXT_MODEL,
      messages: [
        { role: "system", content: isHe ? SMART_STUDENT_SYSTEM_HE : SMART_STUDENT_SYSTEM_EN },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
    },
    `chunk ${index}/${total}`
  );
  return { text: response.choices[0].message.content || "", usedFallback };
}

/**
 * For long documents, splits the text into page-sized chunks and summarizes
 * them strictly one at a time (no concurrency, with a mandatory delay
 * between requests to stay under Groq's free-tier rate limits), stitching
 * the per-chunk summaries back together. The result is a much shorter
 * string that still covers the *entire* document, so the downstream
 * generation call (summary/flashcards/questions/exam) never has to silently
 * truncate the tail of a large file. Short documents pass through unchanged.
 *
 * A chunk that still fails after all retries is replaced with a placeholder
 * note instead of throwing, so one bad chunk doesn't take down the whole
 * request with a 500 — the rest of the document is still summarized.
 *
 * When materialId is given, "chunk X of Y" progress is recorded after every
 * chunk so the frontend can poll GET /materials/:id/progress and show the
 * user real status during the (now strictly sequential, multi-minute)
 * processing instead of a bare spinner.
 */
async function buildAggregatedContent(
  materialContent: string,
  materialTitle: string,
  isHe: boolean,
  materialId?: number
): Promise<{ content: string; usedFallback: boolean }> {
  // First step, before any chunking or Groq calls: if we already know we're
  // in a rate-limit cool-down, fail instantly instead of doing wasted work.
  checkCircuitBreaker();

  if (materialContent.length <= CHUNK_TRIGGER_CHAR_LENGTH) {
    return { content: materialContent, usedFallback: false };
  }

  const chunks = splitTextIntoChunks(materialContent, CHUNK_TOKEN_LIMIT);
  if (chunks.length <= 1) {
    return { content: materialContent, usedFallback: false };
  }

  const partials: string[] = [];
  let anyChunkUsedFallback = false;
  for (let i = 0; i < chunks.length; i++) {
    try {
      const { text, usedFallback } = await summarizeChunk(chunks[i], materialTitle, isHe, i + 1, chunks.length);
      partials.push(text);
      if (usedFallback) anyChunkUsedFallback = true;
    } catch (error) {
      if (error instanceof RateLimitExhaustedError) {
        // The rate-limit window is confirmed exhausted (either a long hard
        // limit, or both the primary and fallback models failed) — don't
        // keep burning budget on the remaining chunks, abort the whole
        // request immediately so the user gets the alert right away.
        console.error(`Aborting chunk processing at ${i + 1}/${chunks.length}: rate limit exhausted (retry-after=${error.retryAfterSeconds}s).`);
        throw error;
      }
      console.error(`Failed to summarize chunk ${i + 1}/${chunks.length} after retries:`, error);
      partials.push(
        isHe
          ? "[לא ניתן היה לעבד חלק זה של החומר עקב תקלה זמנית]"
          : "[This part of the material could not be processed due to a temporary error]"
      );
    }
    // Computed after every chunk regardless of success/failure (the catch
    // block above only rethrows for RateLimitExhaustedError, which aborts
    // the whole loop) so the reported percentage always reflects exactly
    // how much of the document has actually been attempted so far.
    const percentage = Math.round(((i + 1) / chunks.length) * 100);
    console.log(`Processed ${i + 1} out of ${chunks.length} chunks (${percentage}%)`);
    if (materialId !== undefined) {
      setGenerationProgress(materialId, { currentChunk: i + 1, totalChunks: chunks.length, percentage, stage: "chunking" });
    }
    // Mandatory pause before the next chunk, regardless of success/failure,
    // to keep our request rate well below Groq's free-tier limit. Skipped
    // after the last chunk since there's nothing left to wait for.
    if (i < chunks.length - 1) {
      await sleep(INTER_CHUNK_DELAY_MS);
    }
  }

  const content = partials
    .map((p, i) => (isHe ? `### חלק ${i + 1}\n${p}` : `### Part ${i + 1}\n${p}`))
    .join("\n\n");

  return { content, usedFallback: anyChunkUsedFallback };
}

export async function generateSummary(
  opts: AIGenerationOptions & { summaryType: string; topic?: string }
): Promise<{ content: string; keyPoints: string[] }> {
  const { language, materialContent, materialTitle, summaryType, topic, materialId } = opts;
  const isHe = language === "he";

  const typeMap: Record<string, { he: string; en: string }> = {
    quick:         { he: "סיכום קצר ותמציתי (עד 400 מילה) עם הנקודות המרכזיות בלבד", en: "a short summary (up to 400 words) with only the key points" },
    detailed:      { he: "סיכום מעמיק ומלא של כל הנושאים, עם דוגמאות", en: "a thorough, complete summary of all topics with examples" },
    chapter:       { he: "סיכום לפי פרקים / חלקים, כל חלק בכותרת משנה", en: "a chapter-by-chapter summary, each section under its own heading" },
    topic:         { he: `סיכום ממוקד על: ${topic || "הנושאים הראשיים"}`, en: `a summary focused on: ${topic || "the main topics"}` },
    key_takeaways: { he: "עיקרי הדברים — רשימת תובנות מרכזיות שכדאי לזכור", en: "key takeaways — a list of the main insights worth remembering" },
    exam_focused:  { he: "סיכום ממוקד מבחן: מה לדעת, מה לזכור, מה נשאל בבחינות", en: "exam-focused summary: what to know, what to memorize, what gets tested" },
  };

  const typeDesc = isHe
    ? (typeMap[summaryType]?.he ?? typeMap.quick.he)
    : (typeMap[summaryType]?.en ?? typeMap.quick.en);

  const richTypes = ["detailed", "chapter", "exam_focused"];
  const useRichFormatting = richTypes.includes(summaryType);

  const richBulletsHe = `- לפחות דוגמה קונקרטית אחת (מתוך החומר עצמו, לא מומצאת) לכל מושג מורכב או מופשט — משהו שעוזר לתלמיד "לראות" את הרעיון, לא רק לקרוא הגדרה
- בכל מקום שתלמידים נוטים להתבלבל, לטעות, או שיש בו ניואנס שחשוב לשים אליו לב — הוסף שורת "> 💡 **טיפ זהב:** ..." (כציטוט Markdown) עם תזכורת קצרה וממוקדת
`;

  const richBulletsEn = `- At least one concrete example per complex or abstract concept (drawn from the material itself, never invented) — something that helps the student "see" the idea, not just read a definition
- Wherever students commonly get confused, mix up similar terms, or miss a key nuance, add a "> 💡 **Pro Tip:** ..." line (as a Markdown blockquote) with a short, sharp reminder
`;

  try {
  const { content: aggregatedContent, usedFallback } = await buildAggregatedContent(materialContent, materialTitle, isHe, materialId);

  const userPrompt = isHe
    ? `## חומר לימוד: "${materialTitle}"

${contentSlice(aggregatedContent)}

---
המשימה שלך: צור ${typeDesc}.

הסיכום יכתב בעברית בפורמט Markdown מסודר וחם עם:
- כותרת ראשית (##) לכל נושא מרכזי
- תתי-כותרות (###) לנושאי משנה
- נקודות (- ) לפרטים חשובים
- **הדגשה** למושגים ולמונחים קריטיים
${useRichFormatting ? richBulletsHe : ""}${summaryType === "quick" ? '- חשוב: הסיכום הזה הוא "קצר ותמציתי" — הישאר בתוך מגבלת המילים, בלי דוגמאות מורחבות או טיפים נוספים. ישר לעניין.\n' : ""}- בסוף: "## סיכום מנהלים" — פסקת מסכמת חמה של 3-5 משפטים, כאילו אתה אומר לחבר "זה מה שחשוב שתזכור"

ה-keyPoints הוא מערך של 5–8 משפטים קצרים הכי חשובים מהחומר (מה שהייתה רוצה לדעת לפני הבחינה).

החזר JSON בלבד במבנה הבא:
{
  "content": "סיכום בפורמט Markdown כאן",
  "keyPoints": ["נקודה 1", "נקודה 2", "נקודה 3", "נקודה 4", "נקודה 5"]
}`
    : `## Study Material: "${materialTitle}"

${contentSlice(aggregatedContent)}

---
Your task: Create ${typeDesc}.

Write the summary in English using clean, warm Markdown:
- Main heading (##) for each major topic
- Sub-headings (###) for sub-topics
- Bullet points (- ) for important details
- **Bold** key terms and critical concepts
${useRichFormatting ? richBulletsEn : ""}${summaryType === "quick" ? '- Important: this is a "short and concise" summary — stay within the word limit, no extended examples or extra tips. Get straight to the point.\n' : ""}- At the end: "## Executive Summary" — a warm 3-5 sentence wrap-up, written like you're telling a friend "here's what actually matters"

keyPoints is an array of 5–8 short sentences covering the most important things to know (what you'd want to know before the exam).

Return ONLY JSON matching this structure:
{
  "content": "Summary in Markdown format here",
  "keyPoints": ["point 1", "point 2", "point 3", "point 4", "point 5"]
}`;

  const response = await callGroqWithRetry({
    model: TEXT_MODEL,
    messages: [
      { role: "system", content: isHe ? SMART_STUDENT_SYSTEM_HE : SMART_STUDENT_SYSTEM_EN },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.4,
  });

  const parsed = safeJsonParse(response.choices[0].message.content || "{}");
  const fallbackNote = usedFallback
    ? (isHe
        ? "\n\n> הערה: חלקים מסוימים מהחומר סוכמו באמצעות מודל חלופי עקב עומס בשרת, אך האיכות נשארת גבוהה."
        : "\n\n> Note: Some sections were summarized using an alternative model due to server load, but the quality remains high.")
    : "";
  return {
    content: (parsed.content || "") + fallbackNote,
    keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
  };
  } finally {
    if (materialId !== undefined) clearGenerationProgress(materialId);
  }
}

export async function generateFlashcardsAI(
  opts: AIGenerationOptions & { cardCount: number; cardTypes: string[] }
): Promise<Array<{ front: string; back: string; difficulty: string; cardType: string }>> {
  const { language, materialContent, materialTitle, cardCount, cardTypes, materialId } = opts;
  const isHe = language === "he";
  try {
  const { content: aggregatedContent } = await buildAggregatedContent(materialContent, materialTitle, isHe, materialId);

  const typeGuide = isHe
    ? `סוגי כרטיסיות אפשריים:
- definition (הגדרה): "מהי/מהו [מושג]?" → הגדרה מדויקת ומלאה
- formula (נוסחה): "נוסחת/חוק [שם]?" → הנוסחה + משמעות המשתנים
- concept (מושג): "הסבר את [מושג]" → הסבר בשפה פשוטה עם דוגמה
- qa (שאלה ותשובה): שאלה מעמיקה על עקרון/תהליך → תשובה מפורטת`
    : `Card types:
- definition: "What is [term]?" → precise, complete definition
- formula: "Formula/Law of [name]?" → the formula + variable meanings
- concept: "Explain [concept]" → plain-language explanation with example
- qa: Deep question about a principle/process → detailed answer`;

  const userPrompt = isHe
    ? `## חומר לימוד: "${materialTitle}"

${contentSlice(aggregatedContent)}

---
המשימה: צור ערכת כרטיסיות לימוד מגוונת בעברית (מקסימום ${cardCount} כרטיסיות).

${typeGuide}

חוקי ברזל חמושים (אי-ציות יגרום לשגיאה):
1. אסור לחזור על שום מושג! כל כרטיסייה חייבת לעסוק בנושא, משפט או עובדה שונים לחלוטין מהטקסט.
2. אם כבר שאלת על "פרווה", הנושא הזה חסום! עבור לעובדה הבאה (למשל: צבע העור, תזונה, יכולת שחייה, עובי השומן).
3. אם נגמרו העובדות השונות בטקסט, עצור מיד ואל תייצר כרטיסיות נוספות. עדיף 4 כרטיסיות שונות לחלוטין מאשר 6 שחוזרות על עצמן.

החזר JSON במבנה הבא בלבד:
{
  "cards": [
    {"front": "שאלה ייחודית 1", "back": "תשובה מלאה 1", "difficulty": "medium", "cardType": "definition"},
    {"front": "שאלה ייחודית 2 (בנושא שונה לגמרי!)", "back": "תשובה מלאה 2", "difficulty": "medium", "cardType": "concept"}
  ]
}`
    : `## Study Material: "${materialTitle}"

${contentSlice(aggregatedContent)}

---
Task: Create up to ${cardCount} interactive flashcards in English (fewer is allowed if the text is short to prevent duplication).

${typeGuide}

Strict rules to avoid duplication:
1. Distribute across types: ${cardTypes.join(", ")}.
2. ZERO REPETITION: Do not ask about the same fact, concept, or variable more than once. Every card must cover a completely unique piece of information.
3. If a concept was tested once, do not create another card for it under a different type.
4. Front = short, sharp question. Back = complete, accurate answer based strictly on the text.
5. Difficulty: easy, medium, hard.

Return ONLY JSON matching this structure:
{
  "cards": [
    {"front": "question", "back": "complete answer", "difficulty": "medium", "cardType": "definition"}
  ]
}`;

  const response = await callGroqWithRetry({
    model: TEXT_MODEL,
    messages: [
      { role: "system", content: isHe ? SMART_STUDENT_SYSTEM_HE : SMART_STUDENT_SYSTEM_EN },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.3,
  });

  const parsed = safeJsonParse(response.choices[0].message.content || "{}");
  return Array.isArray(parsed.cards) ? parsed.cards : [];
  } finally {
    if (materialId !== undefined) clearGenerationProgress(materialId);
  }
}

export async function generateQuestionsAI(
  opts: AIGenerationOptions & { questionCount: number; questionTypes: string[]; difficulty: string }
): Promise<Array<{ question: string; answer: string; explanation: string; options: string[]; correctIndex: number; questionType: string; difficulty: string; modelAnswer?: string }>> {
  const { language, materialContent, materialTitle, questionCount, questionTypes, difficulty, materialId } = opts;
  const isHe = language === "he";
  try {
  const { content: aggregatedContent } = await buildAggregatedContent(materialContent, materialTitle, isHe, materialId);

  const userPrompt = isHe
    ? `## חומר לימוד: "${materialTitle}"

${contentSlice(aggregatedContent)}

---
המשימה: צור בדיוק ${questionCount} שאלות תרגול בעברית.
סוגי שאלות: ${questionTypes.join(", ")}
רמת קושי: ${difficulty}

כללים חשובים:
- multiple_choice: 4 אפשרויות ב-"options". "answer" הוא הטקסט של התשובה הנכונה בלבד. "correctIndex" הוא מספר האינדקס (0-3) של האפשרות הנכונה.
- מסיחים (distractors) חייבים להיות אמיתיים ומאתגרים: כל אפשרות שגויה צריכה להיות סבירה לחלוטין, מבוססת על טעות מושגית נפוצה או על בלבול בין מונחים קרובים מהחומר עצמו. אסור מסיחים מגוחכים, לא רלוונטיים, או כאלה שניתן לפסול מבלי לדעת את התוכן (כמו אורך שונה באופן בולט, או ניסוח שמסגיר את עצמו). תלמיד שלא הבין את החומר לעומק צריך להיות מסוגל לטעות.
- true_false: options = ["נכון", "לא נכון"]. correctIndex = 0 (נכון) או 1 (לא נכון).
- open: options = [], correctIndex = 0, "answer" הוא תשובה קצרה/תקציר, ו-"modelAnswer" הוא תשובת מודל מקיפה ואיכותית — מנוסחת היטב, ברמה שתלמיד היה רוצה לכתוב במבחן, שמכסה את כל הנקודות החשובות מהחומר.
- כל שאלה חייבת להיות על תוכן אמיתי מהחומר — אסור להמציא.
- "explanation": הסבר קצר, ברור ומעודד למה התשובה הנכונה היא הנכונה — כתוב בטון חם ותומך (כמו חבר שמסביר, לא שופט), ולא רק "כי זה מה שכתוב בטקסט".

החזר JSON במבנה הבא:
{
  "questions": [
    {
      "question": "שאלה בעברית",
      "answer": "הטקסט המדויק של התשובה הנכונה",
      "explanation": "הסבר קצר, ברור ומעודד למה זו התשובה הנכונה",
      "options": ["אפשרות א", "אפשרות ב", "אפשרות ג", "אפשרות ד"],
      "correctIndex": 2,
      "questionType": "multiple_choice",
      "difficulty": "medium",
      "modelAnswer": "תשובת מודל מלאה (רק לשאלות open, אחרת השמיט שדה זה)"
    }
  ]
}`
    : `## Study Material: "${materialTitle}"

${contentSlice(aggregatedContent)}

---
Task: Create exactly ${questionCount} practice questions in English.
Question types: ${questionTypes.join(", ")}
Difficulty: ${difficulty}

Important rules:
- multiple_choice: 4 options in "options". "answer" is the exact text of the correct option. "correctIndex" is the 0-based index (0-3) of the correct option.
- Distractors must be realistic and challenging: every wrong option should be genuinely plausible, based on a common misconception or confusion between closely related terms/concepts from the material itself. No throwaway, irrelevant, or self-revealing distractors (e.g. obviously shorter/longer phrasing, or wording that gives away the answer). A student who only half-understood the material should be able to plausibly pick a wrong one.
- true_false: options = ["True", "False"]. correctIndex = 0 (True) or 1 (False).
- open: options = [], correctIndex = 0. "answer" is a short reference answer, and "modelAnswer" is a comprehensive, high-quality model answer — well-written, the kind a strong student would aim to write on an exam, covering all the key points from the material.
- All questions must be based on actual content — no fabrication.
- "explanation": a brief, clear, encouraging explanation of why the correct answer is right — written in a warm, supportive tone (like a friend explaining, not a judge), not just "because the text says so."

Return ONLY JSON matching this structure:
{
  "questions": [
    {
      "question": "Question text",
      "answer": "Exact text of the correct answer",
      "explanation": "Brief, clear, encouraging explanation of why this is correct",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctIndex": 2,
      "questionType": "multiple_choice",
      "difficulty": "medium",
      "modelAnswer": "Full model answer (only for open questions, omit this field otherwise)"
    }
  ]
}`;

  const response = await callGroqWithRetry({
    model: TEXT_MODEL,
    messages: [
      { role: "system", content: isHe ? SMART_STUDENT_SYSTEM_HE : SMART_STUDENT_SYSTEM_EN },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.4,
  });

  const parsed = safeJsonParse(response.choices[0].message.content || "{}");
  return Array.isArray(parsed.questions)
    ? parsed.questions.map((q: any) => ({ ...q, correctIndex: q.correctIndex ?? 0 }))
    : [];
  } finally {
    if (materialId !== undefined) clearGenerationProgress(materialId);
  }
}

export async function generateExamAI(
  opts: AIGenerationOptions & { questionCount: number; examType: string; difficulty: string; topics?: string[] }
): Promise<Array<{ question: string; answer: string; explanation: string; options: string[]; correctIndex: number; questionType: string; difficulty: string; modelAnswer?: string }>> {
  const { language, materialContent, materialTitle, questionCount, examType, difficulty, topics, materialId } = opts;
  const isHe = language === "he";
  try {
  const { content: aggregatedContent } = await buildAggregatedContent(materialContent, materialTitle, isHe, materialId);

  const topicsLine = topics?.length
    ? (isHe ? `נושאים ממוקדים: ${topics.join(", ")}` : `Focused topics: ${topics.join(", ")}`)
    : "";

  const examTypeMap: Record<string, { he: string; en: string }> = {
    practice:   { he: "תרגול (שאלות מגוונות בקצב נוח)", en: "practice (varied questions, relaxed pace)" },
    topic_quiz: { he: "חידון נושאי (ממוקד בנושאים ספציפיים)", en: "topic quiz (focused on specific topics)" },
    midterm:    { he: "מבחן אמצע סמסטר (מקיף, מעורב)", en: "midterm exam (comprehensive, mixed types)" },
    final:      { he: "מבחן גמר (מקיף, קשה, מעמיק)", en: "final exam (comprehensive, challenging, in-depth)" },
  };

  const examDesc = isHe
    ? (examTypeMap[examType]?.he ?? examTypeMap.practice.he)
    : (examTypeMap[examType]?.en ?? examTypeMap.practice.en);

  const userPrompt = isHe
    ? `## חומר לימוד: "${materialTitle}"
${topicsLine}
סוג מבחן: ${examDesc} | רמת קושי: ${difficulty}

${contentSlice(aggregatedContent)}

---
המשימה: צור מבחן עם בדיוק ${questionCount} שאלות בעברית.
שלב סוגי שאלות: multiple_choice (70%), true_false (15%), open (15%).

כללי JSON:
- multiple_choice: 4 אפשרויות, correctIndex = אינדקס 0-3 של הנכונה.
- מסיחים (distractors) חייבים להיות אמיתיים ומאתגרים: כל אפשרות שגויה צריכה להיות סבירה לחלוטין, מבוססת על טעות מושגית נפוצה או בלבול בין מונחים קרובים מהחומר. אסור מסיחים מגוחכים או כאלה שניתן לפסול בלי לדעת את התוכן. ככל שרמת הקושי גבוהה יותר, כך המסיחים צריכים להיות דקים ומתוחכמים יותר.
- true_false: options = ["נכון", "לא נכון"], correctIndex = 0 או 1.
- open: options = [], correctIndex = 0. "answer" הוא תשובה קצרה/תקציר, ו-"modelAnswer" הוא תשובת מודל מקיפה ואיכותית, ברמת תשובת מבחן מצוינת, המכסה את כל הנקודות החשובות.
- "explanation": הסבר קצר, ברור ומעודד למה התשובה הנכונה היא הנכונה — בטון חם ותומך, לא רק ציטוט מהטקסט.

החזר JSON במבנה הבא בלבד:
{
  "questions": [
    {
      "question": "שאלה",
      "answer": "טקסט התשובה הנכונה",
      "explanation": "הסבר קצר, ברור ומעודד",
      "options": ["א", "ב", "ג", "ד"],
      "correctIndex": 1,
      "questionType": "multiple_choice",
      "difficulty": "medium",
      "modelAnswer": "תשובת מודל מלאה (רק לשאלות open, אחרת השמיט שדה זה)"
    }
  ]
}`
    : `## Study Material: "${materialTitle}"
${topicsLine}
Exam type: ${examDesc} | Difficulty: ${difficulty}

${contentSlice(aggregatedContent)}

---
Task: Create an exam with exactly ${questionCount} questions in English.
Mix question types: multiple_choice (70%), true_false (15%), open (15%).

JSON rules:
- multiple_choice: 4 options, correctIndex = 0-based index of the correct one.
- Distractors must be realistic and challenging: every wrong option should be genuinely plausible, based on a common misconception or confusion between closely related terms/concepts from the material. No throwaway distractors that can be ruled out without knowing the content. The higher the difficulty, the more subtle and sophisticated the distractors should be.
- true_false: options = ["True", "False"], correctIndex = 0 or 1.
- open: options = [], correctIndex = 0. "answer" is a short reference answer, and "modelAnswer" is a comprehensive, high-quality model answer at the level of an excellent exam response, covering all the key points.
- "explanation": a brief, clear, encouraging explanation of why the correct answer is right — warm and supportive in tone, not just a quote from the text.

Return ONLY JSON matching this structure:
{
  "questions": [
    {
      "question": "Question",
      "answer": "Exact text of correct answer",
      "explanation": "Brief, clear, encouraging explanation",
      "options": ["A", "B", "C", "D"],
      "correctIndex": 1,
      "questionType": "multiple_choice",
      "difficulty": "medium",
      "modelAnswer": "Full model answer (only for open questions, omit this field otherwise)"
    }
  ]
}`;

  const response = await callGroqWithRetry({
    model: TEXT_MODEL,
    messages: [
      { role: "system", content: isHe ? SMART_STUDENT_SYSTEM_HE : SMART_STUDENT_SYSTEM_EN },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.4,
  });

  const parsed = safeJsonParse(response.choices[0].message.content || "{}");
  return Array.isArray(parsed.questions)
    ? parsed.questions.map((q: any) => ({ ...q, correctIndex: q.correctIndex ?? 0 }))
    : [];
  } finally {
    if (materialId !== undefined) clearGenerationProgress(materialId);
  }
}

export async function chatWithMaterial(
  materialContent: string,
  materialTitle: string,
  userMessage: string,
  language: "he" | "en",
  history: Array<{ role: "user" | "assistant"; content: string }>
): Promise<string> {
  const isHe = language === "he";

  const systemPrompt = isHe
    ? `אתה מורה-בוט חכם ונלהב שעוזר לסטודנטים להבין חומר לימוד.
ענה בעברית תקינה, ברורה וממוקדת. היה אדיב ומעודד.
אם שאלה אינה קשורה לחומר — ציין זאת בנימוס והפנה לחומר הלימוד.

כותרת החומר: "${materialTitle}"

תוכן החומר:
${contentSlice(materialContent, 6000)}`
    : `You are a smart and enthusiastic tutor bot helping students understand study material.
Answer in clear, focused English. Be friendly and encouraging.
If a question is unrelated to the material, politely note it and redirect to the study material.

Material title: "${materialTitle}"

Content:
${contentSlice(materialContent, 6000)}`;

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...history.slice(-10).map(m => ({ role: m.role, content: m.content })),
    { role: "user", content: userMessage },
  ];

  const response = await callGroqWithRetry({
    model: TEXT_MODEL,
    messages,
    temperature: 0.6,
  });

  return response.choices[0].message.content || "";
}

export async function gradeAnswer(
  question: string,
  correctAnswer: string,
  userAnswer: string,
  language: "he" | "en"
): Promise<{ correct: boolean; explanation: string }> {
  const isHe = language === "he";

  const prompt = isHe
    ? `שאלה: ${question}
תשובה נכונה: ${correctAnswer}
תשובת הסטודנט: ${userAnswer}

בדוק אם תשובת הסטודנט נכונה מבחינה תוכנית (לא בהכרח ניסוח זהה).
החזר JSON במבנה הבא: {"correct": true/false, "explanation": "הסבר קצר בעברית על מה שנכון ומה חסר"}`
    : `Question: ${question}
Correct answer: ${correctAnswer}
Student's answer: ${userAnswer}

Check if the student's answer is conceptually correct (exact wording not required).
Return JSON matching this structure: {"correct": true/false, "explanation": "Brief explanation of what's right and what's missing"}`;

  const response = await callGroqWithRetry({
    model: TEXT_MODEL,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.2,
  });

  const parsed = safeJsonParse(response.choices[0].message.content || "{}");
  return { correct: !!parsed.correct, explanation: parsed.explanation || "" };
}
