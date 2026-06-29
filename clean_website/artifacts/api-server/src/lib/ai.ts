import { GoogleGenAI, type Content } from "@google/genai";
import pLimit from "p-limit";
import { splitTextIntoChunks } from "./chunker";
import { setGenerationProgress, clearGenerationProgress } from "./progress";

// Caps how many heavy, chunked document-generation pipelines (summary,
// flashcards, questions, exam) can run their Gemini calls concurrently across
// the whole process. Without this, 2-3 users uploading large PDFs at once can
// OOM-kill the Render instance. Extra calls queue in-memory rather than
// running in parallel; fast single-call helpers (chat, grading) bypass it.
const pipelineLimit = pLimit(2);

// SECURITY: Gemini API keys must only ever come from the environment —
// never hardcode them here or anywhere else in source, and never log a full
// key value. Render (and local .env files) are expected to provide either
// GEMINI_API_KEYS (a comma-separated pool, for key rotation under load) or
// the single-key GEMINI_API_KEY at runtime.
//
// Key rotation: Gemini's per-minute rate limit is per-key, not per-project,
// so spreading chunk calls across several keys multiplies real throughput
// instead of just retrying the same choked key. With a single configured
// key (the common case) every function below degenerates to exactly the
// old single-client behavior — there is no separate "small document" code
// path needed for that.
const apiKeys: string[] = (() => {
  const pool = process.env.GEMINI_API_KEYS?.split(",").map((k) => k.trim()).filter(Boolean) ?? [];
  if (pool.length > 0) return pool;
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY (or GEMINI_API_KEYS) environment variable is required but was not provided.");
  }
  return [process.env.GEMINI_API_KEY];
})();

const genAIClients = apiKeys.map((apiKey) => new GoogleGenAI({ apiKey }));

// gemini-1.5-flash was fully retired by Google on 2025-09-24 -- every call
// to it now 404s immediately (not retryable), which is why failures here
// surface in seconds rather than after the full retry budget is exhausted.
// gemini-3.5-flash (the current stable GA default) is hitting sustained 503
// "high demand" capacity errors even with the widened retry budget below --
// falling back to gemini-2.5-flash, which is still fully supported until
// its scheduled retirement on 2026-10-16.
const TEXT_MODEL = "gemini-2.5-flash";
// Audio transcription runs on OpenAI's own Whisper API (not Groq's
// OpenAI-compatible proxy) -- see extractor.ts, which reads OPENAI_API_KEY
// directly via a raw fetch call. whisper-1 matches the $0.006/minute cost
// basis the token-pricing model (1 token = 10 min of audio, see
// lib/tokens.ts's RAW_UNITS_PER_TRANSCRIPTION_MINUTE) was derived from. This
// constant is kept here only because extractor.ts imports it alongside other
// AI helpers.
export const AUDIO_MODEL = "whisper-1";

// gemini-1.5-flash is natively multimodal -- the same model handles this
// image-understanding call as well as every text call above, no separate
// vision model needed. This is what lets the frontend later add a
// camera/gallery upload that sends a photo (e.g. of handwritten notes or a
// textbook page) straight through to material extraction.
export async function extractTextFromImage(buffer: Buffer, mimeType: string): Promise<string> {
  const prompt =
    "Extract and transcribe all visible text from this image exactly as written, preserving structure (headings, lists, etc). " +
    "If it's a photo of handwritten or printed study material, return only the transcribed text -- no commentary, no markdown fences.";

  try {
    return await callGeminiWithRetry({
      contents: [
        {
          role: "user",
          parts: [{ inlineData: { mimeType, data: buffer.toString("base64") } }, { text: prompt }],
        },
      ],
      temperature: 0.1,
    });
  } catch (error) {
    if (error instanceof RateLimitExhaustedError || error instanceof SystemBlockedError) throw error;
    console.error("extractTextFromImage failed:", error);
    throw new Error("Could not read this image. Please try a clearer photo or a different file.");
  }
}

// YouTube transcript scraping (youtube-transcript, see extractor.ts) gets
// blocked from hosted server IPs (Render, etc.) far more often than from a
// residential IP -- even on videos that do have captions, the request
// itself gets refused before it ever reaches the actual transcript data.
// Gemini's native multimodal video understanding can watch a public YouTube
// URL directly without scraping anything, so it's used as the first
// fallback when the transcript fetch fails for any reason.
export async function generateContentFromYouTubeVideo(url: string, language: "he" | "en"): Promise<string> {
  const prompt = language === "he"
    ? "צפה בסרטון הזה במלואו וכתוב תמליל/סיכום מפורט ומדויק של כל התוכן המדובר והמוצג בו (נקודות מרכזיות, הסברים, דוגמאות ונתונים), כך שניתן יהיה להשתמש בו כחומר לימוד מלא. הסרטון עצמו עשוי להיות בכל שפה שהיא (אנגלית, ערבית, ספרדית וכו') -- ללא קשר לשפת הדיבור בסרטון, התמליל/סיכום שתכתוב חייב להיות בעברית בלבד, מתורגם ומסונתז באופן טבעי, לא תרגום מילולי. כתוב טקסט רגיל בלבד, בלי הערות, כותרות או דברי הקדמה."
    : "Watch this video in full and write a detailed, accurate transcript/summary of everything spoken and shown in it (key points, explanations, examples, and data), so it can be used as complete study material. The video itself may be in any spoken language -- regardless of what language is spoken in the video, the transcript/summary you write must be strictly in English, naturally translated and synthesized, not a literal word-for-word translation. Output plain text only -- no commentary, headings, or preamble.";

  return callGeminiWithRetry({
    contents: [
      {
        role: "user",
        parts: [{ fileData: { fileUri: url } }, { text: prompt }],
      },
    ],
    temperature: 0.2,
    maxOutputTokens: 4000,
  });
}

// Last-resort fallback when Gemini can't access the video itself either
// (e.g. private/region-locked/unsupported video) -- YouTube's public oEmbed
// endpoint (no API key needed) still exposes the title/channel, which is
// enough for Gemini to produce a clearly-labeled best-effort guess instead
// of leaving the material with no usable content at all.
export async function generateContentFromVideoMetadata(
  metadata: { title: string; author?: string },
  url: string,
  language: "he" | "en"
): Promise<string> {
  const prompt = language === "he"
    ? `לא ניתן היה לגשת לתמליל או לתוכן הווידאו של הסרטון הזה (${url}). הנה המידע הציבורי היחיד שזמין עליו:\nכותרת: "${metadata.title}"\n${metadata.author ? `יוצר: ${metadata.author}\n` : ""}\nהכותרת עצמה עשויה להיות בכל שפה -- ללא קשר לשפת הכותרת, כתוב את התשובה בעברית בלבד. על בסיס הכותרת בלבד, כתוב פסקה קצרה שמסבירה מה כנראה הנושא הכללי של הסרטון, ומציינת בבירור שזו הערכה כללית מבוססת-כותרת בלבד וכי אין תמליל בפועל של תוכן הסרטון. אל תמציא פרטים ספציפיים שאינם נובעים מהכותרת.`
    : `The transcript and video content for this video (${url}) could not be accessed. Here is the only public information available about it:\nTitle: "${metadata.title}"\n${metadata.author ? `Channel: ${metadata.author}\n` : ""}\nThe title itself may be in any language -- regardless of the title's language, write your answer strictly in English. Based only on the title, write a short paragraph explaining what the video is likely about, and clearly state that this is only a general guess based on the title alone -- there is no actual transcript of the video's content. Do not invent specific details that aren't implied by the title.`;

  return callGeminiWithRetry({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    temperature: 0.3,
    maxOutputTokens: 800,
  });
}

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
//
// jsonMode's responseMimeType is supposed to guarantee a bare JSON object,
// but Gemini still sometimes prefixes it with markdown commentary/headers
// (e.g. "## Chapter 2\n```json\n{...}\n```") rather than wrapping the whole
// response in a fence anchored at position 0 -- so a fence stripped only at
// the start/end of the string (the old behavior) misses anything that
// precedes it. This now scans for a fenced block anywhere in the text first,
// then falls back to locating the outermost { ... } pair, so leading
// headers/prose never break the parse.
function safeJsonParse(rawText: string): any {
  if (!rawText) return {};
  let text = rawText.trim();

  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  try {
    return JSON.parse(text);
  } catch {
    // Fall through to brace extraction below.
  }

  try {
    // חילוץ מדויק מהסוגריים המסולסלים הראשונים ועד האחרונים
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    }
  } catch {
    // Truncated rather than the full text -- this is most often hit when
    // the model's JSON got cut off mid-output (see thinkingBudget: 0
    // below), so the interesting part is the END of the string, not a
    // multi-KB dump of content that parsed fine up to that point.
  }
  console.error("Failed to parse AI JSON response. Last 500 chars:", text.slice(-500));
  return {};
}

// Persona/grounding rules only -- deliberately excludes any JSON-format
// directive, since this same text is reused by summarizeChunk's plain-text
// (non-jsonMode) call below. Mixing a "you must output JSON only" rule into
// a system prompt for a call that actually wants a plain bullet list is
// what was producing the raw "{...}"-wrapped or markdown-fenced chunk
// summaries bleeding into the final stitched content -- the model was
// trying to satisfy both the system prompt's JSON mandate and the user
// prompt's "plain text, no headings" request at once.
const SMART_STUDENT_PERSONA_HE = `אתה תלמיד מחונן ונלהב שמסכם חומרי לימוד עבור חבריו לכיתה — מהסוג שכולם רוצים את הסיכומים שלו לפני המבחן.
סגנון הכתיבה שלך: חם, ברור, ממוקד, אקדמי אך נגיש — כמו חבר טוב שמסביר ולא כמו ספר לימוד יבש.
אתה משתמש בדוגמאות קונקרטיות כדי להמחיש מושגים מורכבים, ומוסיף "טיפ זהב" קצר במקומות שבהם תלמידים נוטים להתבלבל או לטעות במבחן.

STRICT OPERATIONAL RULES (VIOLATION WILL BREAK THE SYSTEM):
1. STRICT TRUTH: You must strictly rely ONLY on the provided text or audio transcript. DO NOT add outside knowledge.
2. ZERO DUPLICATION: DO NOT generate the same question, concept, or answer more than once. Every single flashcard must test a COMPLETELY DIFFERENT fact.
3. DIVERSITY: If you already asked about "the color of the fur", you CANNOT ask about it again in another card, not even with different wording.
4. QUALITY OVER QUANTITY: Do not try to reach a high number of cards by repeating concepts or making up filler text. If the facts in the text are exhausted, STOP GENERATING MORE CARDS. It is better to return 6 unique cards than 15 repetitive ones.
5. STRICT GROUNDING: You are strictly forbidden from hallucinating or fabricating information. If the source text lacks depth, do not stretch or invent concepts. Quality and precision always come before filling up quantity.
6. MISSING CONTEXT: If the provided text is empty, unreadable, or too short/corrupted to contain real study content (e.g. an error message instead of actual material), DO NOT invent a summary from general knowledge. Instead return content/cards/questions that explicitly state the material could not be read and ask the user to re-upload it.

ענה תמיד בעברית תקינה ואקדמית בלבד על בסיס הטקסט המסופק בלבד.`;

const SMART_STUDENT_PERSONA_EN = `You are a gifted and enthusiastic student who summarizes study materials for classmates — the kind of student whose notes everyone wants before the exam.
Your writing style: warm, clear, focused, academic yet genuinely engaging — like a sharp friend explaining things over coffee, not a dry textbook.
You identify what truly matters for exams, what is hard to understand, and what is worth remembering. You illustrate tricky concepts with concrete examples, and drop a short "Pro Tip" wherever students commonly get confused or lose points on exams.

STRICT GROUNDING: You are strictly forbidden from hallucinating or fabricating information. If the source text lacks depth, do not stretch or invent concepts. Quality and precision always come before filling up quantity.

MISSING CONTEXT: If the provided text is empty, unreadable, or too short/corrupted to contain real study content (e.g. an error message instead of actual material), DO NOT invent a summary from general knowledge. Instead return content that explicitly states the material could not be read and asks the user to re-upload it.

Always respond in clear English only.`;

const JSON_ONLY_SUFFIX_HE = `\n\nהפלט חייב להיות קובץ JSON תקני בלבד — אל תוסיף שום מילה, הסבר, כותרת או סימני Markdown לפני או אחרי ה-JSON. אסור לעטוף את ה-JSON בגדר קוד (\`\`\`json). התשובה כולה חייבת להתחיל ב-{ ולהסתיים ב-}, ללא שום תוכן נוסף.`;
const JSON_ONLY_SUFFIX_EN = `\n\nOutput must be a valid JSON object only — do not include any markdown formatting, headings, or commentary outside the JSON. Never wrap the JSON in a code fence (\`\`\`json). The entire response must start with { and end with }, with nothing else before or after it.`;

// Used by every jsonMode:true call below (flashcards, questions, exam,
// summary synthesis) -- the persona plus the strict JSON-only directive.
const SMART_STUDENT_SYSTEM_HE = SMART_STUDENT_PERSONA_HE + JSON_ONLY_SUFFIX_HE;
const SMART_STUDENT_SYSTEM_EN = SMART_STUDENT_PERSONA_EN + JSON_ONLY_SUFFIX_EN;

// 20,000 chars was cutting into the aggregated, already chunk-summarized
// content fed to the final synthesis calls -- on an 84-page document that
// aggregate is itself many thousands of chars (one ~2000-token summary per
// chunk), so the old cap was silently dropping most of the document before
// the model ever saw it. Gemini 2.5 Flash's 1M-token context window has
// enormous headroom here, so this is raised to a value chosen to comfortably
// exceed any realistic aggregated-summary length rather than to actively
// constrain it. chatWithMaterial still passes its own tighter 6000-char cap
// explicitly, since that call sends the *raw* (unsummarized) material.
function contentSlice(text: string, maxChars = 120000): string {
  return text.length > maxChars ? text.slice(0, maxChars) + "\n\n[...תוכן קוצר בגלל אורך...]" : text;
}

// Retries on rate limits (429) and transient server/network errors. Other
// errors (bad request, auth, etc.) are not retryable and fail immediately.
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
// 503 "model is currently experiencing high demand" responses from Gemini
// are explicitly described by Google as temporary -- 3 attempts with only
// ~3s of total backoff wasn't enough breathing room for those spikes to
// clear, so this gives transient errors more attempts and more backoff time
// before giving up. See AI_TASK_TIMEOUT_MS in generate-all.ts, which must
// stay comfortably above the worst case computed below.
const MAX_RETRY_ATTEMPTS = 4;
const BASE_RETRY_DELAY_MS = 3000;

// Per-attempt request timeout passed to the Gemini SDK -- @google/genai's own
// config.httpOptions.timeout doesn't reliably abort in-flight requests (see
// withAttemptTimeout below), so this is the actual ceiling on how long a
// single call can hang before we give up on it and retry. 25s was too tight:
// on Render's throttled free-tier CPU (and under "high demand" load on
// Gemini's side), a call that would have eventually succeeded was getting
// aborted and burning a retry attempt on it instead. generate-all's outer
// AI_TASK_TIMEOUT_MS no longer needs to stay near this value -- it only
// bounds a background promise, not an HTTP response -- so there's room to
// give each attempt a genuinely generous window before failing fast into a
// retry.
const ATTEMPT_TIMEOUT_MS = 60_000;

function isRetryableError(error: any): boolean {
  const status = error?.status ?? error?.response?.status;
  if (typeof status === "number") return RETRYABLE_STATUS_CODES.has(status);
  // Timeouts (AbortController firing from ATTEMPT_TIMEOUT_MS) and raw
  // network-level failures (no HTTP status) are typically transient.
  if (error?.name === "AbortError") return true;
  return error?.code === "ECONNRESET" || error?.code === "ETIMEDOUT" || error?.code === "ENOTFOUND";
}

function isRateLimitError(error: any): boolean {
  return (error?.status ?? error?.response?.status) === 429;
}

// Thrown when a 429 survives every key in the pool (each one tried and
// blocked in turn — see callGeminiWithRetry's failover loop), so callers
// stop instead of silently hammering an already-exhausted rate-limit
// window. Carries a user-facing message so app.ts's catch-all handler can
// surface it as-is.
export class RateLimitExhaustedError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super("System is currently at maximum capacity. Please try again in a few minutes.");
    this.name = "RateLimitExhaustedError";
    // Every key in the pool just failed over and is blocked too at this
    // point -- trip them all so checkCircuitBreaker() fails fast on the
    // next call instead of letting a request slip onto an exhausted pool.
    for (let i = 0; i < apiKeys.length; i++) tripKeyCircuitBreaker(i, retryAfterSeconds);
  }
}

// Per-key circuit breaker: once a given key gets a confirmed 429, it's
// blocked until its own cool-down passes, independent of the other keys in
// the pool — instead of letting a stray click or a new request slip through
// on that same choked key and extend the penalty. Module-level state is
// sufficient here: this is a single-process API server, and the goal is
// just to stop hammering a rate-limited key, not to coordinate across
// instances.
const CIRCUIT_BREAKER_MAX_COOLDOWN_MS = 60 * 60 * 1000;
const keyBlockedUntil: (number | null)[] = apiKeys.map(() => null);
// Round-robin cursor shared across every call -- incremented (mod pool
// size) each time a key is selected, so distinct chunk/section calls spread
// across the whole pool instead of all landing on key 0.
let keyRotationCursor = 0;

function tripKeyCircuitBreaker(keyIndex: number, retryAfterSeconds: number): void {
  const cooldownMs = Math.min(Math.max(retryAfterSeconds, 1) * 1000, CIRCUIT_BREAKER_MAX_COOLDOWN_MS);
  const until = Date.now() + cooldownMs;
  if (!keyBlockedUntil[keyIndex] || until > keyBlockedUntil[keyIndex]!) {
    keyBlockedUntil[keyIndex] = until;
  }
  console.error(`Circuit breaker tripped for Gemini key #${keyIndex + 1}/${apiKeys.length}: blocked until ${new Date(keyBlockedUntil[keyIndex]!).toISOString()}.`);
}

// Picks the next key in round-robin order that isn't currently in its 429
// cool-down, or null if every key in the pool is blocked. With a single
// configured key this always returns 0 once it's unblocked -- the "small
// document just uses the default key" behavior the rotation pool is meant
// to add falls out naturally rather than needing its own branch.
function pickNextAvailableKeyIndex(): number | null {
  const now = Date.now();
  for (let i = 0; i < apiKeys.length; i++) {
    const idx = keyRotationCursor++ % apiKeys.length;
    const blockedUntil = keyBlockedUntil[idx];
    if (blockedUntil === null) return idx;
    if (blockedUntil <= now) {
      keyBlockedUntil[idx] = null;
      return idx;
    }
  }
  return null;
}

export class SystemBlockedError extends Error {
  constructor(public readonly retryAfterMinutes: number) {
    super(`We are currently in a cool-down period due to rate limits. Please try again in ${retryAfterMinutes} minutes.`);
    this.name = "SystemBlockedError";
  }
}

// Thrown after every retry attempt is exhausted for a non-rate-limit reason
// (network outage, invalid request, unexpected SDK failure). Lets app.ts's
// catch-all map this to a 503 (retryable upstream issue) instead of the
// generic 500 a plain Error would fall into, without every calling route
// needing its own try/catch.
export class AIServiceError extends Error {
  constructor() {
    super("AI generation failed due to a network or service issue. Please try again.");
    this.name = "AIServiceError";
  }
}

// Must be called as the first step before any Gemini call (and explicitly
// before any aggregation/chunking work begins) so an already-confirmed hard
// limit fails instantly without burning more budget or wasted chunking work.
// Only blocks the request when EVERY key in the pool is still cooling down;
// if even one key is free, the call is allowed through to use it.
function checkCircuitBreaker(): void {
  const now = Date.now();
  let minRemainingMs = Infinity;
  for (let i = 0; i < keyBlockedUntil.length; i++) {
    const blockedUntil = keyBlockedUntil[i];
    if (blockedUntil === null) return;
    const remainingMs = blockedUntil - now;
    if (remainingMs <= 0) {
      keyBlockedUntil[i] = null;
      return;
    }
    minRemainingMs = Math.min(minRemainingMs, remainingMs);
  }
  throw new SystemBlockedError(Math.ceil(minRemainingMs / 60000));
}

// Used when a 429 survives all retries -- Gemini's error shape doesn't
// reliably expose a retry-after value the way Groq's headers did, so we just
// cool down for a fixed window comfortably longer than its per-minute quota.
const RATE_LIMIT_COOLDOWN_SECONDS = 90;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// One full per-chunk operation (richifyChapter, summarizeChunk, etc.) gets
// this many attempts before its caller's "skip this chunk" fallback kicks
// in. This is deliberately separate from callGeminiWithRetry's own internal
// retries -- that helper only retries a single raw Gemini HTTP call and
// gives up immediately on errors it doesn't recognize as retryable (e.g. a
// one-off empty response), which was enough to burn a whole chapter on one
// transient blip. Wrapping the entire chunk operation catches every failure
// mode along that path, not just the ones callGeminiWithRetry already knows
// about.
const CHUNK_RETRY_ATTEMPTS = 3;
const CHUNK_RETRY_BASE_DELAY_MS = 1500;

async function withChunkRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastError: any;
  for (let attempt = 0; attempt < CHUNK_RETRY_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof RateLimitExhaustedError) throw error;
      lastError = error;
      if (attempt === CHUNK_RETRY_ATTEMPTS - 1) break;
      const delay = CHUNK_RETRY_BASE_DELAY_MS * 2 ** attempt;
      console.warn(`${label}: attempt ${attempt + 1}/${CHUNK_RETRY_ATTEMPTS} failed, retrying in ${Math.round(delay)}ms:`, error instanceof Error ? error.message : error);
      await sleep(delay);
    }
  }
  throw lastError;
}

// Error objects don't serialize their own properties via JSON.stringify by
// default (only enumerable own properties do, and most Error subclasses
// define message/stack as non-enumerable) -- this walks the prototype chain
// so nothing the SDK attached (status, error body, etc.) gets silently
// dropped from the logs.
function safeStringifyError(error: any): string {
  try {
    return JSON.stringify(error, Object.getOwnPropertyNames(error ?? {}));
  } catch {
    return String(error);
  }
}

// @google/genai's own config.httpOptions.timeout does not reliably abort
// in-flight requests (googleapis/js-genai#1277), so each attempt is bounded
// here instead via a plain race against a timer.
function withAttemptTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const err: any = new Error(`Gemini call timed out after ${ms}ms`);
      err.name = "AbortError";
      reject(err);
    }, ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

interface GeminiCallParams {
  systemInstruction?: string;
  contents: Content[];
  temperature?: number;
  maxOutputTokens?: number;
  jsonMode?: boolean;
}

/**
 * Wraps a Gemini generateContent call with exponential backoff retry for
 * transient errors, plus immediate key failover on rate limits (429): on a
 * 429, the key that just got throttled is blocked and the very next attempt
 * goes out on a different key from the pool instead of waiting out a
 * backoff on the same choked key. So a single flaky request -- or a single
 * choked key -- doesn't take down the whole pipeline (and, in turn, the HTTP
 * response) with it.
 */
async function callGeminiWithRetry(params: GeminiCallParams): Promise<string> {
  checkCircuitBreaker();

  let keyIndex = pickNextAvailableKeyIndex();
  if (keyIndex === null) throw new SystemBlockedError(1);

  let lastError: any;
  for (let attempt = 0; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
    try {
      const response = await withAttemptTimeout(
        genAIClients[keyIndex].models.generateContent({
          model: TEXT_MODEL,
          contents: params.contents,
          config: {
            systemInstruction: params.systemInstruction,
            temperature: params.temperature,
            maxOutputTokens: params.maxOutputTokens,
            responseMimeType: params.jsonMode ? "application/json" : undefined,
            // gemini-2.5-flash thinks by default, and that thinking draws from
            // the same output token budget as the actual response -- on a
            // long/complex prompt it can burn through the whole budget before
            // ever emitting the answer, producing a silently truncated (or
            // empty) result with no error. None of our calls need multi-step
            // reasoning, just direct extraction/formatting of the supplied
            // text, so thinking is switched off entirely to guarantee the full
            // budget goes to the actual output.
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
        ATTEMPT_TIMEOUT_MS,
      );
      const finishReason = response.candidates?.[0]?.finishReason;
      if (finishReason && finishReason !== "STOP") {
        console.warn(`callGeminiWithRetry: response finished with reason "${finishReason}" (not STOP) -- output may be truncated.`);
      }
      const text = response.text;
      if (!text) throw new Error("Gemini returned an empty response.");
      return text;
    } catch (error: any) {
      lastError = error;
      // Logged unconditionally (not just on retry) since a non-retryable
      // error breaks out below without ever hitting the warn log -- without
      // this, the only trace of a one-shot failure would be the generic
      // "request failed after all retries" line, with none of the SDK's own
      // diagnostic detail.
      console.error("callGeminiWithRetry: raw error from genAI.models.generateContent:", {
        model: TEXT_MODEL,
        key: `${keyIndex + 1}/${apiKeys.length}`,
        name: error?.name,
        status: error?.status ?? error?.response?.status,
        message: error?.message,
        cause: error?.cause,
        errorDetails: error?.error ?? error?.response?.error,
        raw: safeStringifyError(error),
      });

      if (isRateLimitError(error)) {
        // Block this key and fail over to the next available one in the
        // pool for the very next attempt -- no backoff wait, since the
        // problem is specific to this key, not a transient blip the whole
        // pool needs to wait out. With only one key configured, this just
        // blocks it (same as the pre-rotation behavior) and falls through
        // below since no other key is available.
        tripKeyCircuitBreaker(keyIndex, RATE_LIMIT_COOLDOWN_SECONDS);
        const nextKeyIndex = pickNextAvailableKeyIndex();
        if (nextKeyIndex === null) {
          console.error("callGeminiWithRetry: rate limit hit on every key in the pool, failing fast.");
          break;
        }
        console.warn(`Gemini key #${keyIndex + 1} rate-limited; failing over to key #${nextKeyIndex + 1}/${apiKeys.length}.`);
        keyIndex = nextKeyIndex;
        continue;
      }

      if (attempt === MAX_RETRY_ATTEMPTS || !isRetryableError(error)) {
        break;
      }
      // Full exponential backoff, then jitter scaled to the backoff itself
      // (0-50% of it) rather than a flat +/-250ms. With concurrencyLimit > 1,
      // several chunks hit a 503 in the same tick and would otherwise all
      // retry on the same fixed schedule -- a flat jitter window is too
      // narrow to desynchronize them, so the jitter needs to grow with the
      // delay to actually spread retries out and avoid hitting an
      // already-overloaded model again at the same moment.
      const exponentialDelay = BASE_RETRY_DELAY_MS * 2 ** attempt;
      const jitter = Math.random() * exponentialDelay * 0.5;
      const delay = exponentialDelay + jitter;
      console.warn(
        `Gemini call failed (attempt ${attempt + 1}/${MAX_RETRY_ATTEMPTS + 1}, status ${error?.status ?? "?"}). Retrying in ${Math.round(delay)}ms...`
      );
      await sleep(delay);
    }
  }

  if (isRateLimitError(lastError)) {
    console.error("callGeminiWithRetry: rate limit survived every key in the pool, failing fast.");
    throw new RateLimitExhaustedError(RATE_LIMIT_COOLDOWN_SECONDS);
  }
  // Every attempt is exhausted (and it wasn't a confirmed rate limit, which
  // throws above as RateLimitExhaustedError) -- this is a network outage,
  // an invalid request, or some other unexpected SDK failure. Log the raw
  // error for debugging, but never leak it to the client: callers and the
  // app-wide catch-all error handler should only ever see a clear,
  // user-facing message here, not a raw SDK error shape.
  console.error(
    `callGeminiWithRetry: request failed after all retries. model=${TEXT_MODEL} status=${lastError?.status ?? "?"} message=${lastError?.message ?? lastError}`,
  );
  throw new AIServiceError();
}

// How many times to re-run a *successful* (no thrown error) Gemini call
// whose parsed output still comes back empty -- e.g. a finishReason other
// than STOP that silently truncated the JSON, or a one-off bad parse. This
// is intentionally small and separate from MAX_RETRY_ATTEMPTS inside
// callGeminiWithRetry: that retry budget already covers network/5xx/timeout
// failures, this one covers "the call succeeded but produced nothing useful"
// so a real empty-output case (e.g. genuinely unreadable material) doesn't
// also have to survive the full network-error backoff schedule.
const EMPTY_OUTPUT_RETRY_ATTEMPTS = 2;

// Thrown by a section's validate() callback when a Gemini call returned
// successfully but with output that doesn't pass that section's own
// definition of "non-empty" -- gives generate-all.ts a single error type to
// branch on for the "section failed, fall back instead of aborting" path.
export class EmptyGenerationError extends Error {
  constructor(label: string) {
    super(`${label} produced no usable content after ${EMPTY_OUTPUT_RETRY_ATTEMPTS} attempt(s).`);
    this.name = "EmptyGenerationError";
  }
}

/**
 * Wraps callGeminiWithRetry with a validation pass: parse() turns the raw
 * response text into the section's result shape (summary content, card
 * array, question array, ...), and is expected to throw if that result is
 * empty/unusable. A throw here is treated as "this attempt produced
 * nothing", not a network failure, so it gets its own short retry budget
 * (EMPTY_OUTPUT_RETRY_ATTEMPTS) on top of -- not instead of --
 * callGeminiWithRetry's own retries. Exhausting that budget raises
 * EmptyGenerationError, so callers can catch a single specific error type
 * instead of re-deriving "was this empty or did it actually fail".
 */
async function callGeminiJsonWithValidation<T>(
  params: GeminiCallParams,
  parse: (text: string) => T,
  label: string,
): Promise<T> {
  let lastError: any;
  for (let attempt = 1; attempt <= EMPTY_OUTPUT_RETRY_ATTEMPTS; attempt++) {
    const text = await callGeminiWithRetry(params);
    try {
      return parse(text);
    } catch (err) {
      lastError = err;
      console.warn(
        `${label}: attempt ${attempt}/${EMPTY_OUTPUT_RETRY_ATTEMPTS} produced empty/invalid output (${err instanceof Error ? err.message : err}), ${attempt < EMPTY_OUTPUT_RETRY_ATTEMPTS ? "retrying..." : "giving up."}`,
      );
    }
  }
  console.error(`${label}: exhausted all attempts with empty/invalid output. Last error:`, lastError);
  throw new EmptyGenerationError(label);
}

// Explicit output-token ceilings for the four final synthesis calls. None of
// these were previously set, which left them at the SDK default -- on a
// long, detailed Hebrew response (token-dense relative to ASCII) that default
// could be reached before the model finished writing, producing a silently
// truncated (or, after JSON-parsing a cut-off string, fully empty) result
// with no error raised anywhere. Sized generously per section's actual
// shape rather than uniformly.
const SUMMARY_MAX_OUTPUT_TOKENS = 8000;
const FLASHCARDS_MAX_OUTPUT_TOKENS = 4000;
const QUESTIONS_MAX_OUTPUT_TOKENS = 6000;
const EXAM_MAX_OUTPUT_TOKENS = 6000;
const VOCAB_FILL_IN_BLANK_MAX_OUTPUT_TOKENS = 3000;

// Above this length, a single Gemini call risks silently dropping the tail
// of the document (or the model just skims the title and hallucinates) — so
// we chunk instead of truncating. Below it, material is short enough to pass
// through whole.
const CHUNK_TRIGGER_CHAR_LENGTH = 9000;
// Sized in estimated tokens, not words. Gemini 1.5 Flash's 1M-token context
// window means we no longer need to fight a tight per-minute token cap the
// way Groq's free tier did -- a generous chunk budget keeps each chunk's
// summary detailed (better Hebrew comprehension with more surrounding
// context) while still splitting very large documents into a few manageable
// pieces instead of one giant request.
const CHUNK_TOKEN_LIMIT = 22000;
const CHUNK_COMPLETION_MAX_TOKENS = 2000;

async function summarizeChunk(
  chunk: string,
  materialTitle: string,
  isHe: boolean,
  index: number,
  total: number
): Promise<string> {
  const prompt = isHe
    ? `## חלק ${index}/${total} מחומר הלימוד: "${materialTitle}"\n\n${chunk}\n\n---\nסכם בהרחבה ובמדויק את כל העובדות, המושגים והנקודות החשובות שמופיעות בקטע הזה בלבד. כתוב כרשימת נקודות עובדתיות וממוקדות, בלי כותרות ובלי הקדמות. אל תשמיט אף עובדה מהותית, ואל תוסיף שום מידע שלא מופיע בקטע.\n\nהקטע עצמו עשוי להיות כתוב בכל שפה -- ללא קשר לשפת המקור, הסיכום שתכתוב חייב להיות בעברית בלבד.\n\nהפלט הוא טקסט רגיל בלבד -- אסור להחזיר JSON, אסור לעטוף את התשובה בגדר קוד (\`\`\`), ואל תחזור על הכותרת "## חלק ${index}/${total}" שמופיעה למעלה בתחילת התשובה שלך.`
    : `## Part ${index}/${total} of study material: "${materialTitle}"\n\n${chunk}\n\n---\nThoroughly and precisely summarize all the facts, concepts, and important points that appear in this part only. Write a focused, factual bullet list — no headings, no preamble. Do not omit any substantive fact, and do not add information that isn't in this part.\n\nThis part may itself be written in any language -- regardless of the source language, the summary you write must be strictly in English.\n\nOutput plain text only -- do not return JSON, do not wrap the response in a code fence (\`\`\`), and do not repeat the "## Part ${index}/${total}" heading shown above at the start of your answer.`;

  return callGeminiWithRetry({
    systemInstruction: isHe ? SMART_STUDENT_PERSONA_HE : SMART_STUDENT_PERSONA_EN,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    temperature: 0.2,
    maxOutputTokens: CHUNK_COMPLETION_MAX_TOKENS,
  });
}

// How many chunks are summarized at once. Concurrency speeds up large
// documents, but every concurrent request adds to the "demand" Gemini sees
// at that instant, and 2 was still enough to trip 503s and exhaust retries
// on real documents. Dropped to 1 -- chunks are now processed strictly one
// at a time -- to prioritize a slower but reliable run over a faster one
// that keeps failing. Kept as a single tunable knob so it's a one-line
// change to raise again later if Gemini's demand eases up.
const CONCURRENCY_LIMIT = 1;

// Fixed cooldown between chunks (after one finishes, before the next
// starts). Even at CONCURRENCY_LIMIT 1, back-to-back requests with zero gap
// can still look like a burst to Gemini's demand-based throttling -- this
// small pause smooths that out. Skipped after the very last chunk since
// there's nothing left to protect.
const INTER_CHUNK_COOLDOWN_MS = 2000;

/**
 * For long documents, splits the text into large chunks and summarizes them
 * in batches of CONCURRENCY_LIMIT (currently 1, i.e. strictly one chunk at a
 * time, with a fixed cooldown between them), stitching the per-chunk
 * summaries back together in original order. The result is a much shorter
 * string that still covers the *entire* document, so the downstream
 * generation call (summary/flashcards/questions/exam) never has to silently
 * truncate the tail of a large file. Short documents pass through unchanged.
 *
 * A chunk that still fails after all retries is replaced with a placeholder
 * note instead of throwing, so one bad chunk doesn't take down the whole
 * request with a 500 — the rest of the document is still summarized.
 *
 * When materialId is given, "chunk X of Y" progress is recorded after every
 * batch so the frontend can poll GET /materials/:id/progress and show the
 * user real status during processing instead of a bare spinner.
 */
async function buildAggregatedContent(
  materialContent: string,
  materialTitle: string,
  isHe: boolean,
  materialId?: number
): Promise<{ content: string; parts: string[]; chunked: boolean }> {
  // First step, before any chunking or Gemini calls: if we already know
  // we're in a rate-limit cool-down, fail instantly instead of doing wasted
  // work.
  checkCircuitBreaker();

  if (materialContent.length <= CHUNK_TRIGGER_CHAR_LENGTH) {
    return { content: materialContent, parts: [materialContent], chunked: false };
  }

  const chunks = splitTextIntoChunks(materialContent, CHUNK_TOKEN_LIMIT);
  if (chunks.length <= 1) {
    return { content: materialContent, parts: [materialContent], chunked: false };
  }

  const partials: string[] = new Array(chunks.length);
  let failedChunkCount = 0;
  for (let batchStart = 0; batchStart < chunks.length; batchStart += CONCURRENCY_LIMIT) {
    const batchIndexes = Array.from(
      { length: Math.min(CONCURRENCY_LIMIT, chunks.length - batchStart) },
      (_, j) => batchStart + j,
    );

    const settled = await Promise.allSettled(
      batchIndexes.map((i) => withChunkRetry(`summarizeChunk(${i + 1}/${chunks.length})`, () => summarizeChunk(chunks[i], materialTitle, isHe, i + 1, chunks.length))),
    );

    const rateLimitFailure = settled.find(
      (r) => r.status === "rejected" && r.reason instanceof RateLimitExhaustedError,
    ) as PromiseRejectedResult | undefined;
    if (rateLimitFailure) {
      // The rate-limit window is confirmed exhausted — don't keep burning
      // budget on the remaining chunks, abort the whole request
      // immediately so the user gets the alert right away.
      console.error(`Aborting chunk processing in batch starting at ${batchStart}: rate limit exhausted.`);
      throw rateLimitFailure.reason;
    }

    settled.forEach((result, j) => {
      const i = batchIndexes[j];
      if (result.status === "fulfilled") {
        partials[i] = result.value;
      } else {
        console.error(`Failed to summarize chunk ${i + 1}/${chunks.length} after retries:`, result.reason);
        failedChunkCount++;
        partials[i] = isHe
          ? "[לא ניתן היה לעבד חלק זה של החומר עקב תקלה זמנית]"
          : "[This part of the material could not be processed due to a temporary error]";
      }
    });

    const completed = batchStart + batchIndexes.length;
    const percentage = Math.round((completed / chunks.length) * 100);
    console.log(`Processed ${completed} out of ${chunks.length} chunks (${percentage}%)`);
    if (materialId !== undefined) {
      setGenerationProgress(materialId, { currentChunk: completed, totalChunks: chunks.length, percentage, stage: "chunking" });
    }

    if (completed < chunks.length) {
      await sleep(INTER_CHUNK_COOLDOWN_MS);
    }
  }

  // Same guard as generateSummaryAndFlashcards: if every chunk failed, this
  // would otherwise return "successfully" composed entirely of failure
  // placeholders, which downstream callers (summary/flashcard/question
  // generation) would then treat as real source material.
  if (failedChunkCount === chunks.length) {
    throw new AIServiceError();
  }

  const content = partials
    .map((p, i) => (isHe ? `### חלק ${i + 1}\n${p}` : `### Part ${i + 1}\n${p}`))
    .join("\n\n");

  return { content, parts: partials, chunked: true };
}

// Normalizes a question's text for duplicate detection -- case/whitespace
// differences shouldn't let an otherwise-identical question slip through as
// "new".
function normalizeQuestionText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

// Filters out any generated question whose text matches (after
// normalization) one already generated in a previous run for this material,
// or a duplicate appearing earlier in the same batch -- used to keep
// re-runs ("give me a new set of practice questions") from just handing the
// student the same questions again.
function dedupeQuestionsAgainstExisting<T extends { question: string }>(
  questions: T[],
  existingQuestionTexts: string[],
): T[] {
  const seen = new Set(existingQuestionTexts.map(normalizeQuestionText));
  const result: T[] = [];
  for (const q of questions) {
    const norm = normalizeQuestionText(q.question);
    if (seen.has(norm)) continue;
    seen.add(norm);
    result.push(q);
  }
  return result;
}

type GeneratedQuestion = {
  question: string;
  answer: string;
  explanation: string;
  options: string[];
  correctIndex: number;
  questionType: string;
  difficulty: string;
  modelAnswer?: string;
  concept?: string;
  optionExplanations?: (string | null)[];
};

// Instruction forcing every generated item to carry a short "concept" tag --
// the specific sub-topic/principle it's actually testing (e.g. "Krebs cycle
// - ATP yield"), not the chapter title. This is the foundation for weak-spot
// tracking: without a stable tag per item, there's no way to aggregate "the
// student keeps missing X" across separate flashcards/questions/exams that
// happen to test the same underlying idea. The model is told to reuse
// identical wording across items testing the same concept so aggregation by
// exact string match works downstream.
function conceptTagRule(isHe: boolean): string {
  return isHe
    ? `תיוג מושג (concept) -- חובה: לכל פריט הוסיפו שדה "concept" -- תיאור קצר (2-6 מילים) של המושג/תת-הנושא הספציפי שהפריט בודק, בעברית. אם כמה פריטים בודקים את אותו מושג בדיוק -- תייגו אותם באותה מילולית בדיוק (כדי שניתן יהיה לצבור לפי מושג בהמשך). לדוגמה: "מחזור קרבס - תפוקת ATP" או "דיני חוזים - הצעה וקיבול". אל תשתמשו בכותרת הפרק הכללית כ-concept -- הוא צריך להיות ממוקד וספציפי.`
    : `Concept tagging -- mandatory: add a "concept" field to every item -- a short (2-6 word) label for the specific sub-topic/principle the item tests. If several items test the exact same concept, tag them with the exact same wording (so they can be aggregated later). For example: "Krebs cycle - ATP yield" or "Contract law - offer and acceptance". Do not use the chapter's general title as the concept -- it must be specific and narrow.`;
}

// One malformed entry (missing/wrong-typed field, often from the model's
// JSON getting truncated mid-array) used to sink the whole response via a
// blind .map() -- this drops only the bad entries so the rest of an
// otherwise-valid batch still counts instead of triggering a full retry/skip.
function filterValidQuestions(arr: any[]): GeneratedQuestion[] {
  return arr.filter((q): q is GeneratedQuestion =>
    q && typeof q.question === "string" && q.question.trim().length > 0 &&
    typeof q.answer === "string" && q.answer.trim().length > 0 &&
    Array.isArray(q.options) && q.options.every((o: any) => typeof o === "string")
  );
}

function buildExcludeQuestionsBlock(existingQuestionTexts: string[], isHe: boolean): string {
  if (existingQuestionTexts.length === 0) return "";
  const list = existingQuestionTexts.slice(0, 50).map((q) => `- ${q}`).join("\n");
  return isHe
    ? `\n\nשאלות שכבר נוצרו בעבר עבור חומר זה — אסור לחזור עליהן או על וריאציות קרובות שלהן, צרו שאלות חדשות ושונות:\n${list}\n`
    : `\n\nQuestions already generated previously for this material — do not repeat these or close variations, create new and different questions:\n${list}\n`;
}

// Output-token ceiling for expanding ONE chunk's plain factual bullet list
// (from buildAggregatedContent) into a full, structured Markdown chapter --
// headings, bold terms, examples, tip callouts. Generous relative to
// CHUNK_COMPLETION_MAX_TOKENS since this call is meant to genuinely deepen
// and restructure that chunk's content, not just reformat a sentence of it.
// Raised from 3000 -- a dense chunk's structured expansion (headings +
// bullets + examples + tips) can legitimately need more room than that, and
// running up against the ceiling is exactly what pushes the model to
// compress the tail into an unstructured wall of prose to fit.
const CHUNK_RICH_CHAPTER_MAX_OUTPUT_TOKENS = 4096;

// Turns one chunk's already-extracted facts into a deep, structured Markdown
// chapter instead of leaving the final "Detailed Summary" as a flat,
// unformatted stitch of factual bullet lists -- this is the actual
// "reduction" step readers see, so it needs to read like the rest of the
// app's rich summaries (headings, bold terms, worked examples, tip
// callouts), not a compressed digest. Runs per chunk with its own bounded
// output (same chunking discipline as flashcards/questions) so this can't
// truncate or time out the way a single call over the whole document would.
async function richifyChapter(
  factualSummary: string,
  materialTitle: string,
  isHe: boolean,
  index: number,
  total: number,
): Promise<string> {
  const prompt = isHe
    ? `## פרק ${index}/${total} מחומר הלימוד "${materialTitle}" — להלן העובדות שחולצו מהקטע הזה של החומר:

${factualSummary}

---
המשימה: הרחב את העובדות לעיל לפרק סיכום מפורט, מובנה ועמוק בעברית, בפורמט Markdown:
- כותרת ראשית אחת (##) שמתארת את עיקרי הפרק
- תתי-כותרות (###) לכל תת-נושא בתוך הפרק
- נקודות (- ) לכל פרט עובדתי — חובה לכלול את כל העובדות שמופיעות לעיל, בלי לדלג על אף אחת
- **הדגשה** למושגים ולמונחים קריטיים
- לפחות דוגמה קונקרטית אחת (מתוך העובדות לעיל, לא מומצאת) לכל מושג מורכב או מופשט
- בכל מקום שתלמידים נוטים להתבלבל, הוסף שורת "> 💡 **טיפ זהב:** ..." (כציטוט Markdown)

אסור להמציא מידע שלא מופיע בעובדות לעיל. אסור לקצר, לסנן או לדלג על עובדות — המטרה היא להעמיק ולהבנות את התוכן הקיים, לא לסכם אותו מחדש בקיצור.
חשוב מאוד: שמור על המבנה הזה (כותרות, נקודות, הדגשות, טיפים) בעקביות מההתחלה ועד הסוף הממש של הפלט, גם אם רשימת העובדות ארוכה — אסור בשום אופן שהפלט "יתעייף" וייהפך לקטע פרוזה רציף וארוך בלי כותרות ונקודות, אפילו בחלקים האחרונים של הפרק.
הפלט הוא טקסט Markdown רגיל בלבד — אסור JSON, אסור גדר קוד (\`\`\`), בלי הקדמות לפני הכותרת.`
    : `## Chapter ${index}/${total} of study material "${materialTitle}" -- facts extracted from this part of the material:

${factualSummary}

---
Task: expand the facts above into a detailed, structured, in-depth summary chapter in English, in Markdown format:
- One main heading (##) describing what this chapter covers
- Sub-headings (###) for each sub-topic within the chapter
- Bullet points (- ) for every factual detail -- you must include every fact listed above, skipping none
- **Bold** key terms and critical concepts
- At least one concrete example (drawn from the facts above, never invented) per complex or abstract concept
- Wherever students commonly get confused, add a "> 💡 **Pro Tip:** ..." line (as a Markdown blockquote)

Do not invent information that isn't in the facts above. Do not shorten, filter, or skip facts -- the goal is to deepen and structure the existing content, not re-summarize it briefly.
Critical: keep this exact structure (headings, bullets, bold, tips) consistent from the very first line to the very last, no matter how long the fact list is -- never let the output "tire out" partway through and collapse into a long unstructured wall of prose with no headings or bullets, even in the final sections of the chapter.
Output plain Markdown text only -- no JSON, no code fence (\`\`\`), no preamble before the heading.`;

  return callGeminiWithRetry({
    systemInstruction: isHe ? SMART_STUDENT_PERSONA_HE : SMART_STUDENT_PERSONA_EN,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    temperature: 0.4,
    maxOutputTokens: CHUNK_RICH_CHAPTER_MAX_OUTPUT_TOKENS,
  });
}

// Whisper's recording transcript has no per-segment timestamps (verbose_json
// is requested but only `text`/`duration` are kept -- see transcribeAudio in
// extractor.ts), so a bookmark's recorded second is mapped onto the
// transcript only by proportional position (timestamp / totalDuration ->
// character offset), not by an exact timestamp-to-text alignment. Good
// enough to anchor the AI's attention near the right neighborhood of the
// lecture without claiming precision the data doesn't support.
function buildBookmarkContext(
  bookmarkTimestamps: number[] | undefined,
  audioDurationSeconds: number | undefined,
  content: string,
  isHe: boolean,
): string {
  if (!bookmarkTimestamps || bookmarkTimestamps.length === 0 || !audioDurationSeconds || audioDurationSeconds <= 0) {
    return "";
  }
  const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const EXCERPT_RADIUS = 200;
  const entries = bookmarkTimestamps.map((ts) => {
    const fraction = Math.min(1, Math.max(0, ts / audioDurationSeconds));
    const charPos = Math.round(fraction * content.length);
    const excerpt = content.slice(Math.max(0, charPos - EXCERPT_RADIUS), charPos + EXCERPT_RADIUS).trim();
    return { ts, excerpt };
  });

  if (isHe) {
    const lines = entries.map((e) => `- בדקה ${fmt(e.ts)}, בסביבות הטקסט: "...${e.excerpt}..."`).join("\n");
    return `\n---\nהתלמיד/ה סימן/ה את הרגעים הבאים כ"חשובים" בזמן ההרצאה החיה (לחיצה על כפתור סימון רגע בזמן אמת):\n${lines}\n\nהתייחס/י במיוחד למושגים המרכזיים שמופיעים בקרבת כל אחד מהרגעים הללו, והדגש/י אותם בסיכום הסופי בעזרת סקשן/תג מיוחד עם הכיתוב המדויק "📌 נקודה קריטית שסומנה במהלך השיעור" ממש לפני ההסבר על אותו נושא.\n`;
  }
  const lines = entries.map((e) => `- At minute ${fmt(e.ts)}, near this part of the transcript: "...${e.excerpt}..."`).join("\n");
  return `\n---\nThe student marked the following moments as "important" live during the lecture (tapped a bookmark button in real time):\n${lines}\n\nPay extra attention to the core concepts discussed near each of these moments, and highlight them in the final summary with a dedicated section/badge using the exact label "📌 Critical point marked during class" right before the explanation of that topic.\n`;
}

// Course-specific terminology the student pre-defined (see glossary.ts) --
// grounds the model's transcription/correction/summary logic against the
// student's own definitions instead of guessing at course-specific jargon,
// abbreviations, or formulas. The "glossary:" markdown-link scheme is the
// carrier for output-side highlighting (see summary-view.tsx's custom `a`
// component override) -- chosen over raw HTML or a custom syntax so it
// renders correctly with the app's existing remark-gfm-only Markdown
// pipeline, with no new dependency needed.
function buildGlossaryContext(
  glossaryTerms: { term: string; definition: string }[] | undefined,
  isHe: boolean,
): string {
  if (!glossaryTerms || glossaryTerms.length === 0) return "";
  const list = glossaryTerms.map((t) => `[Term: ${t.term}: ${t.definition}]`).join(", ");

  // Worded as a hard constraint, not a suggestion: the course glossary is the
  // Supreme Source of Truth for these terms, so a contradiction between it
  // and the model's own general-knowledge sense of a word (e.g. a course-
  // specific acronym that happens to also be a common word) must always
  // resolve in the glossary's favor.
  if (isHe) {
    return `\n---\nמקור האמת העליון (Supreme Source of Truth): התלמיד/ה סיפק/ה מילון מונחים מותאם-קורס. אם מונח מהטקסט מופיע במילון הזה, עליך להשתמש בהגדרה שסיפק/ה התלמיד/ה -- אסור להשתמש במשמעות כללית/מילונית חיצונית, אפילו אם היא נראית סבירה יותר (לדוגמה: אם המונח "אהבת\"י" מופיע, השתמש/י בהגדרת ראשי-התיבות הספציפית לקורס, לא במשמעות המילונית הכללית של "אהבה"). אם הידע הכללי שלך סותר את המילון, הגדרת המילון גוברת תמיד: ${list}\n\nכל פעם שאחד מהמונחים האלה (בדיוק כפי שהוגדר, או נטייה דקדוקית ברורה שלו) מופיע בסיכום שאתה כותב, עטוף אותו בתחביר Markdown הבא במקום טקסט רגיל: [המונח](glossary:מונח "ההגדרה המדויקת"), כך שיודגש ויהיה ברור לתלמיד/ה שזה מונח מהמילון שלו/ה.\n`;
  }
  return `\n---\nSUPREME SOURCE OF TRUTH: The user has provided a custom glossary of course-specific terminology. If a term from the text appears in this glossary, you MUST use the provided definition from the student -- do not use external, general-knowledge meanings, even if they seem more plausible (e.g. if the term "אהבת\"י" appears, use the course-specific acronym definition, not the general dictionary meaning of "love"). If your general knowledge contradicts the course glossary, the glossary definition always takes precedence: ${list}\n\nWhenever one of these terms (exactly as defined, or an obvious inflection of it) appears in the summary you write, wrap it using this Markdown syntax instead of plain text: [TERM](glossary:term "EXACT DEFINITION"), so it gets highlighted and the student can instantly see it's a glossary term.\n`;
}

export function generateSummary(
  opts: AIGenerationOptions & {
    summaryType: string;
    topic?: string;
    bookmarkTimestamps?: number[];
    audioDurationSeconds?: number;
    glossaryTerms?: { term: string; definition: string }[];
  }
): Promise<{
  content: string;
  keyPoints: string[];
  parts: string[];
  chunked: boolean;
}> {
  return pipelineLimit(() => generateSummaryImpl(opts));
}

async function generateSummaryImpl(
  opts: AIGenerationOptions & {
    summaryType: string;
    topic?: string;
    bookmarkTimestamps?: number[];
    audioDurationSeconds?: number;
    glossaryTerms?: { term: string; definition: string }[];
  }
): Promise<{
  content: string;
  keyPoints: string[];
  // The same per-chunk factual summaries buildAggregatedContent computed for
  // this call -- returned so generate-all.ts can hand them straight to the
  // flashcards/questions stages (as precomputedParts) instead of re-chunking
  // and re-summarizing the same raw document a second and third time.
  parts: string[];
  chunked: boolean;
}> {
  const { language, materialContent, materialTitle, summaryType, topic, materialId, bookmarkTimestamps, audioDurationSeconds, glossaryTerms } = opts;
  const isHe = language === "he";
  const bookmarkContext = buildBookmarkContext(bookmarkTimestamps, audioDurationSeconds, materialContent, isHe);
  const glossaryContext = buildGlossaryContext(glossaryTerms, isHe);

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
  const { parts, chunked } = await buildAggregatedContent(materialContent, materialTitle, isHe, materialId);

  // Large/chunked documents: rather than risk a single Gemini call silently
  // truncating its output once asked to comprehensively cover every chunk,
  // the chapter bodies are assembled deterministically from each chunk's
  // already-validated factual summary (one chapter per chunk, guaranteed to
  // cover the whole document since nothing is re-summarized or re-sliced
  // here). Only the keyPoints + a short executive wrap-up come from a single,
  // lightweight, bounded-output Gemini call on top of that.
  if (chunked) {
    // Each chunk's factual bullet list (from buildAggregatedContent) gets its
    // own bounded richifyChapter call rather than being stitched in raw --
    // otherwise the final summary reads like a flat fact dump instead of the
    // headed/bolded/example-laden chapters the non-chunked branch produces.
    const richChapters: string[] = [];
    for (let i = 0; i < parts.length; i++) {
      try {
        const rich = await withChunkRetry(`richifyChapter(${i + 1}/${parts.length})`, () => richifyChapter(parts[i], materialTitle, isHe, i + 1, parts.length));
        richChapters.push(rich.trim() || (isHe ? `## פרק ${i + 1}\n${parts[i]}` : `## Chapter ${i + 1}\n${parts[i]}`));
      } catch (err) {
        if (err instanceof RateLimitExhaustedError) throw err;
        console.error(`generateSummary: richify failed for chunk ${i + 1}/${parts.length}, falling back to raw chunk:`, err);
        richChapters.push(isHe ? `## פרק ${i + 1}\n${parts[i]}` : `## Chapter ${i + 1}\n${parts[i]}`);
      }

      const completed = i + 1;
      const percentage = Math.round((completed / parts.length) * 100);
      if (materialId !== undefined) {
        setGenerationProgress(materialId, { currentChunk: completed, totalChunks: parts.length, percentage, stage: "chunking" });
      }
      if (completed < parts.length) {
        await sleep(INTER_CHUNK_COOLDOWN_MS);
      }
    }
    const chapterBody = richChapters.join("\n\n");

    const synthPrompt = isHe
      ? `## סיכום מחולק לפרקים של חומר הלימוד "${materialTitle}":

${contentSlice(chapterBody)}
${bookmarkContext}${glossaryContext}
---
המשימה שלך: קרא את כל הפרקים מעלה וצור:
1. keyPoints — מערך של 5–8 משפטים קצרים, הכי חשובים מכל החומר (מה שהייתה רוצה לדעת לפני הבחינה).
2. executiveSummary — פסקת "סיכום מנהלים" חמה של 3-5 משפטים, כאילו אתה אומר לחבר "זה מה שחשוב שתזכור", המכסה את כל הפרקים.${bookmarkContext ? ' לאחר פסקת הסיכום, הוסף סקשן נפרד בשם "## נקודות קריטיות שסומנו במהלך השיעור" עם תג "📌 נקודה קריטית שסומנה במהלך השיעור" והסבר קצר לכל אחד מהרגעים שסומנו.' : ""}

החזר JSON בלבד במבנה הבא:
{
  "keyPoints": ["נקודה 1", "נקודה 2", "נקודה 3", "נקודה 4", "נקודה 5"],
  "executiveSummary": "פסקת סיכום מנהלים כאן"
}`
      : `## Chapter-by-chapter summary of study material "${materialTitle}":

${contentSlice(chapterBody)}
${bookmarkContext}${glossaryContext}
---
Your task: read every chapter above and produce:
1. keyPoints — an array of 5-8 short sentences, the most important things from the whole material (what you'd want to know before the exam).
2. executiveSummary — a warm 3-5 sentence "executive summary" wrap-up, written like you're telling a friend "here's what actually matters", covering all the chapters.${bookmarkContext ? ' After the wrap-up, add a separate section titled "## Critical Points Marked During Class" with a "📌 Critical point marked during class" badge and a short explanation for each marked moment.' : ""}

Return ONLY JSON matching this structure:
{
  "keyPoints": ["point 1", "point 2", "point 3", "point 4", "point 5"],
  "executiveSummary": "Executive summary paragraph here"
}`;

    const { keyPoints, executiveSummary } = await callGeminiJsonWithValidation(
      {
        systemInstruction: isHe ? SMART_STUDENT_SYSTEM_HE : SMART_STUDENT_SYSTEM_EN,
        contents: [{ role: "user", parts: [{ text: synthPrompt }] }],
        temperature: 0.4,
        jsonMode: true,
        maxOutputTokens: 2000,
      },
      (text) => {
        const parsed = safeJsonParse(text);
        const kp = Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [];
        const exec = typeof parsed.executiveSummary === "string" ? parsed.executiveSummary : "";
        if (kp.length === 0 && !exec) throw new Error("empty keyPoints and executiveSummary");
        return { keyPoints: kp, executiveSummary: exec };
      },
      "generateSummary(chaptered)",
    );

    const execHeading = isHe ? "## סיכום מנהלים" : "## Executive Summary";
    const content = executiveSummary ? `${chapterBody}\n\n${execHeading}\n${executiveSummary}` : chapterBody;
    console.log(`generateSummary: assembled ${parts.length}-chapter summary (${content.length} chars, ${keyPoints.length} key points) for material ${materialId ?? "?"}.`);
    return { content, keyPoints, parts, chunked };
  }

  const aggregatedContent = parts[0];

  const userPrompt = isHe
    ? `## חומר לימוד: "${materialTitle}"

${contentSlice(aggregatedContent)}
${bookmarkContext}${glossaryContext}
---
המשימה שלך: צור ${typeDesc}.

חומר המקור עשוי להיות כתוב או מדובר בכל שפה (לדוגמה אנגלית, ערבית, ספרדית) -- ללא קשר לשפת המקור, הסיכום, כל הכותרות והמטא-דאטה חייבים להיות בעברית בלבד. תרגם וסנתז את התוכן באופן טבעי לעברית, לא תרגום מילולי.

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
${bookmarkContext}${glossaryContext}
---
Your task: Create ${typeDesc}.

The source material may be written or spoken in any language (e.g. Hebrew, Arabic, Spanish) -- regardless of the source language, the summary, all headings, and metadata must be strictly in English. Translate and synthesize the content naturally into English, not a literal word-for-word translation.

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

  const { content, keyPoints } = await callGeminiJsonWithValidation(
    {
      systemInstruction: isHe ? SMART_STUDENT_SYSTEM_HE : SMART_STUDENT_SYSTEM_EN,
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      temperature: 0.4,
      jsonMode: true,
      maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS,
    },
    (text) => {
      const parsed = safeJsonParse(text);
      if (!parsed.content || typeof parsed.content !== "string" || !parsed.content.trim()) {
        throw new Error("empty content field");
      }
      return {
        content: parsed.content as string,
        keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
      };
    },
    "generateSummary",
  );
  console.log(`generateSummary: generated summary (${content.length} chars, ${keyPoints.length} key points) for material ${materialId ?? "?"}.`);
  return { content, keyPoints, parts, chunked };
  } finally {
    if (materialId !== undefined) clearGenerationProgress(materialId);
  }
}

function flashcardTypeGuide(isHe: boolean): string {
  return isHe
    ? `סוגי כרטיסיות אפשריים:
- definition (הגדרה): "מהי/מהו [מושג]?" → הגדרה מדויקת וקצרה
- formula (נוסחה): "נוסחת/חוק [שם]?" → הנוסחה + משמעות המשתנים בקצרה
- concept (מושג): "הסבר את [מושג]" → הסבר תכליתי בשפה פשוטה
- qa (שאלה ותשובה): שאלה מעמיקה על עקרון/תהליך → תשובה תכליתית`
    : `Card types:
- definition: "What is [term]?" → precise, brief definition
- formula: "Formula/Law of [name]?" → the formula + variable meanings, briefly
- concept: "Explain [concept]" → to-the-point, plain-language explanation
- qa: Deep question about a principle/process → to-the-point answer`;
}

// Flashcards are reviewed for a few seconds at a time, not read like a
// textbook -- a "back" field that runs to a full paragraph overflows the
// fixed-size card UI and overlaps the review buttons below it, and it
// defeats the point of a flashcard (quick recall, not re-reading the
// source). Every prompt below enforces this same hard cap regardless of
// card type.
function flashcardLengthRule(isHe: boolean): string {
  return isHe
    ? `אורך התשובה (back): מקסימום 2-3 משפטים קצרים, רצוי כתבי-יד (bullet points) אם יש כמה נקודות. אסור לכתוב פסקאות! תשובה ארוכה מ-40 מילים היא שגיאה.`
    : `Answer length (back): maximum 2-3 short sentences, ideally bullet points if there's more than one fact. No paragraphs. An answer longer than 40 words is an error.`;
}

// Output-token ceiling for ONE chunk's worth of flashcards -- deliberately
// much smaller than FLASHCARDS_MAX_OUTPUT_TOKENS since each call here only
// has to cover a small slice of the document, not the whole thing.
const CHUNK_FLASHCARDS_MAX_OUTPUT_TOKENS = 2000;
const CARDS_PER_CHUNK_CAP = 6;

async function generateFlashcardsForChunk(
  chunk: string,
  materialTitle: string,
  isHe: boolean,
  index: number,
  total: number,
  cardsForChunk: number,
  cardTypes: string[],
): Promise<Array<{ front: string; back: string; difficulty: string; cardType: string; concept?: string }>> {
  const typeGuide = flashcardTypeGuide(isHe);
  const lengthRule = flashcardLengthRule(isHe);
  const userPrompt = isHe
    ? `## חלק ${index}/${total} מחומר הלימוד: "${materialTitle}"

${chunk}

---
המשימה: צור עד ${cardsForChunk} כרטיסיות לימוד ייחודיות בעברית, מבוססות רק על עובדות מהחלק הזה בלבד -- אל תתייחס לחלקים אחרים של החומר.

${typeGuide}

חוקי ברזל: אסור לחזור על שום מושג. אם אין מספיק עובדות שונות בחלק הזה -- צור פחות כרטיסיות, עדיף מעט וייחודי מהרבה וחזרתי.

${lengthRule}

${conceptTagRule(true)}

החזר JSON במבנה הבא בלבד:
{"cards": [{"front": "שאלה ייחודית", "back": "תשובה קצרה ותכליתית", "difficulty": "medium", "cardType": "definition", "concept": "המושג הספציפי שהכרטיסייה בודקת"}]}`
    : `## Part ${index}/${total} of study material: "${materialTitle}"

${chunk}

---
Task: create up to ${cardsForChunk} unique flashcards in English, based only on facts in this part -- do not reference other parts.

${typeGuide}

Strict rules: never repeat a concept. Create fewer cards if this part doesn't have enough distinct facts -- fewer unique cards beats more repetitive ones. Distribute across types: ${cardTypes.join(", ")}.

${lengthRule}

${conceptTagRule(false)}

Return ONLY JSON matching this structure:
{"cards": [{"front": "question", "back": "short, to-the-point answer", "difficulty": "medium", "cardType": "definition", "concept": "the specific concept this card tests"}]}`;

  return callGeminiJsonWithValidation(
    {
      systemInstruction: isHe ? SMART_STUDENT_SYSTEM_HE : SMART_STUDENT_SYSTEM_EN,
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      temperature: 0.3,
      jsonMode: true,
      maxOutputTokens: CHUNK_FLASHCARDS_MAX_OUTPUT_TOKENS,
    },
    (text) => {
      const parsed = safeJsonParse(text);
      const result = Array.isArray(parsed.cards) ? parsed.cards : [];
      if (result.length === 0) throw new Error("empty cards array");
      return result;
    },
    `generateFlashcardsForChunk(${index}/${total})`,
  );
}

export function generateFlashcardsAI(
  opts: AIGenerationOptions & { cardCount: number; cardTypes: string[]; precomputedParts?: string[] }
): Promise<Array<{ front: string; back: string; difficulty: string; cardType: string; concept?: string }>> {
  return pipelineLimit(() => generateFlashcardsAIImpl(opts));
}

async function generateFlashcardsAIImpl(
  opts: AIGenerationOptions & { cardCount: number; cardTypes: string[]; precomputedParts?: string[] }
): Promise<Array<{ front: string; back: string; difficulty: string; cardType: string; concept?: string }>> {
  const { language, materialContent, materialTitle, cardCount, cardTypes, materialId, precomputedParts } = opts;
  const isHe = language === "he";
  try {
  // generate-all.ts passes Stage 1's already-computed chunk parts here so
  // this stage never re-chunks/re-summarizes the raw document a second
  // time. Other callers (the standalone flashcards route) don't pass this,
  // so they chunk the raw material themselves via buildAggregatedContent.
  const { parts, chunked } = precomputedParts !== undefined
    ? { parts: precomputedParts, chunked: precomputedParts.length > 1 }
    : await buildAggregatedContent(materialContent, materialTitle, isHe, materialId);

  // Large/chunked documents: one small, bounded-output Gemini call per
  // chunk instead of a single call over the whole aggregated text. This is
  // what actually fixes the truncation/empty-response failures on large
  // documents -- a single call asked to cover dozens of pages within
  // FLASHCARDS_MAX_OUTPUT_TOKENS was the root cause, not just a speed issue.
  if (chunked) {
    const cardsPerChunk = Math.max(2, Math.min(CARDS_PER_CHUNK_CAP, Math.ceil(cardCount / parts.length)));
    const allCards: Array<{ front: string; back: string; difficulty: string; cardType: string; concept?: string }> = [];

    for (let i = 0; i < parts.length; i++) {
      try {
        const chunkCards = await withChunkRetry(`generateFlashcardsForChunk(${i + 1}/${parts.length})`, () => generateFlashcardsForChunk(parts[i], materialTitle, isHe, i + 1, parts.length, cardsPerChunk, cardTypes));
        allCards.push(...chunkCards);
      } catch (err) {
        if (err instanceof RateLimitExhaustedError) throw err;
        console.error(`generateFlashcardsAI: chunk ${i + 1}/${parts.length} failed after retries, skipping:`, err);
      }

      const completed = i + 1;
      const percentage = Math.round((completed / parts.length) * 100);
      if (materialId !== undefined) {
        setGenerationProgress(materialId, { currentChunk: completed, totalChunks: parts.length, percentage, stage: "chunking" });
      }
      if (completed < parts.length) {
        await sleep(INTER_CHUNK_COOLDOWN_MS);
      }
    }

    const seenFronts = new Set<string>();
    const deduped = allCards.filter((c) => {
      const norm = normalizeQuestionText(c.front || "");
      if (!norm || seenFronts.has(norm)) return false;
      seenFronts.add(norm);
      return true;
    });
    if (deduped.length === 0) throw new EmptyGenerationError("generateFlashcardsAI");

    const trimmed = deduped.slice(0, cardCount);
    console.log(`generateFlashcardsAI: generated ${trimmed.length} flashcards across ${parts.length} chunks (requested up to ${cardCount}) for material ${materialId ?? "?"}.`);
    return trimmed;
  }

  const aggregatedContent = parts[0];
  const typeGuide = flashcardTypeGuide(isHe);
  const lengthRule = flashcardLengthRule(isHe);

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
4. ${lengthRule}
5. ${conceptTagRule(true)}

החזר JSON במבנה הבא בלבד:
{
  "cards": [
    {"front": "שאלה ייחודית 1", "back": "תשובה קצרה 1", "difficulty": "medium", "cardType": "definition", "concept": "המושג הספציפי שכרטיסייה 1 בודקת"},
    {"front": "שאלה ייחודית 2 (בנושא שונה לגמרי!)", "back": "תשובה קצרה 2", "difficulty": "medium", "cardType": "concept", "concept": "המושג הספציפי שכרטיסייה 2 בודקת"}
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
4. Front = short, sharp question. Back = short, accurate answer based strictly on the text.
5. Difficulty: easy, medium, hard.
6. ${lengthRule}
7. ${conceptTagRule(false)}

Return ONLY JSON matching this structure:
{
  "cards": [
    {"front": "question", "back": "short answer", "difficulty": "medium", "cardType": "definition", "concept": "the specific concept this card tests"}
  ]
}`;

  const cards = await callGeminiJsonWithValidation(
    {
      systemInstruction: isHe ? SMART_STUDENT_SYSTEM_HE : SMART_STUDENT_SYSTEM_EN,
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      temperature: 0.3,
      jsonMode: true,
      maxOutputTokens: FLASHCARDS_MAX_OUTPUT_TOKENS,
    },
    (text) => {
      const parsed = safeJsonParse(text);
      const result = Array.isArray(parsed.cards) ? parsed.cards : [];
      if (result.length === 0) throw new Error("empty cards array");
      return result;
    },
    "generateFlashcardsAI",
  );
  console.log(`generateFlashcardsAI: generated ${cards.length} flashcards (requested up to ${cardCount}) for material ${materialId ?? "?"}.`);
  return cards;
  } finally {
    if (materialId !== undefined) clearGenerationProgress(materialId);
  }
}

// Output-token ceiling for ONE chunk's worth of questions -- a fraction of
// QUESTIONS_MAX_OUTPUT_TOKENS since each call only needs to cover a small
// slice of the document.
const CHUNK_QUESTIONS_MAX_OUTPUT_TOKENS = 2500;
const QUESTIONS_PER_CHUNK_CAP = 4;

// Shared quality bar for every multiple_choice question generated anywhere
// in the app (practice questions and exams, chunked and whole-document).
// Plain recall questions ("Is a black banana sweet?") test memorization, not
// understanding -- this forces half the multiple_choice questions into a
// short scenario/case-study wrapper instead, so the student has to apply the
// underlying principle rather than just spot a sentence they already read.
function scenarioMcRules(isHe: boolean): string {
  return isHe
    ? `כללי איכות לשאלות אמריקאיות (multiple_choice) -- חובה להקפיד על כולם:
- איזון 50/50: מתוך כל שאלות ה-multiple_choice שתיצרו כאן, מחצית (50%) חייבות להיות שאלות ידע/שליפה ישירה (מבוססות ישירות על עובדה או הגדרה מהטקסט), והמחצית השנייה (50%) חייבות להיות שאלות מצביות/יישומיות/מקרה-בוחן.
- שאלות מצביות: עטפו את העובדה או העיקרון מהטקסט בתוך תרחיש קצר, דילמה מהחיים האמיתיים, או מקרה מקצועי -- כדי לענות, הסטודנט/ית חייב/ת להבין את העיקרון ולהפעיל אותו על הסיפור, לא רק לשלוף משפט מהטקסט. לדוגמה: במקום "האם בננה שחורה מתוקה?" שאלו "יוסי רצה להכין קינוח מתוק מאוד בלי להוסיף סוכר -- מה עליו לקנות?"
- התאמה לתחום: זהו אוטומטית את התחום של הטקסט (רפואה, משפטים, הנדסה, עסקים, פסיכולוגיה, חיים יומיומיים וכו') והתאימו את התרחיש אליו: טקסט רפואי -> תרחיש רופא-מטופל; טקסט משפטי -> תרחיש עו"ד-לקוח; טקסט כללי -> מצב מחיי היומיום.
- מסיחים איכותיים: כל אפשרות שגויה חייבת להיות סבירה ומאתגרת באמת -- מבוססת על טעות מושגית נפוצה או על מונח/עובדה אחרת שמופיעה בטקסט, כך שתלמיד שלא הבין לעומק יוכל בקלות לבחור בה בטעות. אסור מסיחים מגוחכים שניתן לפסול בלי לדעת את התוכן.
- הסברי מסיחים (חובה): הוסיפו שדה "optionExplanations" -- מערך באותו אורך ובאותו סדר כמו "options". בכל אינדקס שאינו ה-correctIndex, כתבו הסבר קצר (משפט-שניים) שמסביר את התפיסה השגויה הספציפית שמובילה לבחירה באפשרות הזו -- לדוגמה: "אם בחרת באפשרות הזו, כנראה בלבלת בין X ל-Y כי...". באינדקס הנכון עצמו שימו null. אסור הסבר גנרי כמו "זו תשובה שגויה" -- ההסבר חייב לנקוב במושג הספציפי שגרם לבלבול.`
    : `Quality rules for multiple_choice questions -- all of these are mandatory:
- 50/50 balance: of all the multiple_choice questions you generate here, exactly half (50%) must be direct recall/knowledge questions (based directly on a fact or definition from the text), and the other half (50%) must be situational/application/case-study questions.
- Situational questions: wrap the fact or principle from the text inside a short real-life scenario, dilemma, or professional case -- to answer, the student must understand the underlying principle and apply it to the story, not just recall a sentence from the text. For example, instead of "Is a black banana sweet?" ask "Yossi wants to make a very sweet dessert without adding sugar -- what should he buy?"
- Domain adaptation: automatically detect the subject of the text (medicine, law, engineering, business, psychology, everyday life, etc.) and tailor the scenario to it: medical text -> doctor-patient scenario; legal text -> lawyer-client scenario; general text -> everyday-life situation.
- Quality distractors: every wrong option must be genuinely plausible and challenging -- based on a common misconception or another fact/term that actually appears in the text, so a student who didn't deeply understand the material could easily pick it by mistake. No throwaway distractors that can be ruled out without knowing the content.
- Distractor explanations (mandatory): add an "optionExplanations" field -- an array the same length and order as "options". At every index except the correctIndex, write a short (1-2 sentence) explanation of the specific misconception that leads a student to pick that option -- e.g. "If you chose this, you likely confused X with Y because...". At the correct index itself, use null. Never write a generic explanation like "this is wrong" -- it must name the specific misconception.`;
}

async function generateQuestionsForChunk(
  chunk: string,
  materialTitle: string,
  isHe: boolean,
  index: number,
  total: number,
  questionsForChunk: number,
  questionTypes: string[],
  difficulty: string,
  excludeBlock: string,
): Promise<GeneratedQuestion[]> {
  const userPrompt = isHe
    ? `## חלק ${index}/${total} מחומר הלימוד: "${materialTitle}"

${chunk}
${excludeBlock}
---
המשימה: צור עד ${questionsForChunk} שאלות תרגול בעברית, מבוססות רק על תוכן מהחלק הזה בלבד -- אל תתייחס לחלקים אחרים.
סוגי שאלות: ${questionTypes.join(", ")}
רמת קושי: ${difficulty}

כללים חשובים:
- multiple_choice: 4 אפשרויות ב-"options". "answer" הוא הטקסט של התשובה הנכונה בלבד. "correctIndex" הוא מספר האינדקס (0-3) של האפשרות הנכונה.
${scenarioMcRules(true)}
- דיוק לשוני (חובה): כל מילה בכל אפשרות תשובה — נכונה כמו שגויה — חייבת להיות מילה עברית אמיתית ותקנית. אסור מילים מומצאות או "גיבריש".
- true_false: options = ["נכון", "לא נכון"]. correctIndex = 0 (נכון) או 1 (לא נכון).
- open: options = [], correctIndex = 0, "answer" הוא תשובה קצרה, ו-"modelAnswer" הוא תשובת מודל מקיפה.
- כל שאלה חייבת להיות על תוכן אמיתי מהחלק הזה — אסור להמציא. אם אין מספיק תוכן ייחודי, צור פחות שאלות.
- "explanation": הסבר קצר, ברור ומעודד -- כתוב גם הוא בהקשר התרחיש (אם השאלה מצבית), לא רק ציטוט מהטקסט.
- ${conceptTagRule(true)}

החזר JSON במבנה הבא:
{"questions": [{"question": "שאלה", "answer": "תשובה נכונה", "explanation": "הסבר", "options": ["א", "ב", "ג", "ד"], "correctIndex": 0, "questionType": "multiple_choice", "difficulty": "medium", "concept": "המושג הספציפי שהשאלה בודקת", "optionExplanations": [null, "הסבר התפיסה השגויה לבחירה ב'ב'", "הסבר התפיסה השגויה לבחירה ב'ג'", "הסבר התפיסה השגויה לבחירה ב'ד'"]}]}`
    : `## Part ${index}/${total} of study material: "${materialTitle}"

${chunk}
${excludeBlock}
---
Task: create up to ${questionsForChunk} practice questions in English, based only on content from this part -- do not reference other parts.
Question types: ${questionTypes.join(", ")}
Difficulty: ${difficulty}

Important rules:
- multiple_choice: 4 options in "options". "answer" is the exact text of the correct option. "correctIndex" is the 0-based index.
${scenarioMcRules(false)}
- Linguistic accuracy (mandatory): every word in every option must be a real, grammatically correct word in the target language. Never use made-up words or gibberish.
- true_false: options = ["True", "False"]. correctIndex = 0 (True) or 1 (False).
- open: options = [], correctIndex = 0. "answer" is a short reference answer, "modelAnswer" is a comprehensive model answer.
- All questions must be based on real content from this part -- no fabrication. Create fewer questions if there isn't enough unique content.
- "explanation": a brief, clear, encouraging explanation -- written in context of the scenario itself (if the question is situational), not just a quote from the text.
- ${conceptTagRule(false)}

Return ONLY JSON matching this structure:
{"questions": [{"question": "Question text", "answer": "Correct answer", "explanation": "Explanation", "options": ["A", "B", "C", "D"], "correctIndex": 0, "questionType": "multiple_choice", "difficulty": "medium", "concept": "the specific concept this question tests", "optionExplanations": [null, "misconception explanation for option B", "misconception explanation for option C", "misconception explanation for option D"]}]}`;

  return callGeminiJsonWithValidation(
    {
      systemInstruction: isHe ? SMART_STUDENT_SYSTEM_HE : SMART_STUDENT_SYSTEM_EN,
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      temperature: 0.4,
      jsonMode: true,
      maxOutputTokens: CHUNK_QUESTIONS_MAX_OUTPUT_TOKENS,
    },
    (text) => {
      const parsed = safeJsonParse(text);
      const result: GeneratedQuestion[] = Array.isArray(parsed.questions)
        ? parsed.questions.map((q: any) => ({ ...q, correctIndex: q.correctIndex ?? 0 }))
        : [];
      if (result.length === 0) throw new Error("empty questions array");
      return result;
    },
    `generateQuestionsForChunk(${index}/${total})`,
  );
}

export function generateQuestionsAI(
  opts: AIGenerationOptions & { questionCount: number; questionTypes: string[]; difficulty: string; excludeQuestions?: string[]; precomputedParts?: string[] }
): Promise<Array<{ question: string; answer: string; explanation: string; options: string[]; correctIndex: number; questionType: string; difficulty: string; modelAnswer?: string; concept?: string; optionExplanations?: (string | null)[] }>> {
  return pipelineLimit(() => generateQuestionsAIImpl(opts));
}

async function generateQuestionsAIImpl(
  opts: AIGenerationOptions & { questionCount: number; questionTypes: string[]; difficulty: string; excludeQuestions?: string[]; precomputedParts?: string[] }
): Promise<Array<{ question: string; answer: string; explanation: string; options: string[]; correctIndex: number; questionType: string; difficulty: string; modelAnswer?: string; concept?: string; optionExplanations?: (string | null)[] }>> {
  const { language, materialContent, materialTitle, questionCount, questionTypes, difficulty, materialId, excludeQuestions, precomputedParts } = opts;
  const isHe = language === "he";
  try {
  // generate-all.ts passes Stage 1's already-computed chunk parts here so
  // this stage never re-chunks/re-summarizes the raw document a second
  // time. Other callers (the standalone practice-questions route) don't
  // pass this, so they chunk the raw material themselves.
  const { parts, chunked } = precomputedParts !== undefined
    ? { parts: precomputedParts, chunked: precomputedParts.length > 1 }
    : await buildAggregatedContent(materialContent, materialTitle, isHe, materialId);

  // Large/chunked documents: one small, bounded-output call per chunk
  // instead of one call over the whole aggregated text -- this is what
  // actually prevents truncation/empty-response failures on large
  // documents, not just a speed optimization. excludeQuestions accumulates
  // across chunks within the same run too, so chunk 2 never repeats a
  // question chunk 1 already produced.
  if (chunked) {
    const perChunkCount = Math.max(2, Math.min(QUESTIONS_PER_CHUNK_CAP, Math.ceil(questionCount / parts.length)));
    const cumulativeExclude = [...(excludeQuestions ?? [])];
    const allQuestions: GeneratedQuestion[] = [];

    for (let i = 0; i < parts.length; i++) {
      const excludeBlock = buildExcludeQuestionsBlock(cumulativeExclude, isHe);
      try {
        const chunkQuestions = await withChunkRetry(`generateQuestionsForChunk(${i + 1}/${parts.length})`, () => generateQuestionsForChunk(parts[i], materialTitle, isHe, i + 1, parts.length, perChunkCount, questionTypes, difficulty, excludeBlock));
        const deduped = dedupeQuestionsAgainstExisting(chunkQuestions, cumulativeExclude);
        allQuestions.push(...deduped);
        cumulativeExclude.push(...deduped.map((q) => q.question));
      } catch (err) {
        if (err instanceof RateLimitExhaustedError) throw err;
        console.error(`generateQuestionsAI: chunk ${i + 1}/${parts.length} failed after retries, skipping:`, err);
      }

      const completed = i + 1;
      const percentage = Math.round((completed / parts.length) * 100);
      if (materialId !== undefined) {
        setGenerationProgress(materialId, { currentChunk: completed, totalChunks: parts.length, percentage, stage: "chunking" });
      }
      if (completed < parts.length) {
        await sleep(INTER_CHUNK_COOLDOWN_MS);
      }
    }

    if (allQuestions.length === 0) throw new EmptyGenerationError("generateQuestionsAI");

    const trimmed = allQuestions.slice(0, questionCount);
    console.log(`generateQuestionsAI: generated ${trimmed.length} unique questions across ${parts.length} chunks (requested ${questionCount}) for material ${materialId ?? "?"}.`);
    return trimmed;
  }

  const aggregatedContent = parts[0];
  const excludeBlock = buildExcludeQuestionsBlock(excludeQuestions ?? [], isHe);

  const userPrompt = isHe
    ? `## חומר לימוד: "${materialTitle}"

${contentSlice(aggregatedContent)}
${excludeBlock}
---
המשימה: צור בדיוק ${questionCount} שאלות תרגול בעברית.
סוגי שאלות: ${questionTypes.join(", ")}
רמת קושי: ${difficulty}

כללים חשובים:
- multiple_choice: 4 אפשרויות ב-"options". "answer" הוא הטקסט של התשובה הנכונה בלבד. "correctIndex" הוא מספר האינדקס (0-3) של האפשרות הנכונה.
${scenarioMcRules(true)}
- דיוק לשוני (חובה): כל מילה בכל אפשרות תשובה — נכונה כמו שגויה — חייבת להיות מילה עברית אמיתית, תקנית ומובנת. אסור בהחלט להשתמש במילים מומצאות, צירופי אותיות חסרי משמעות, או "גיבריש". לפני שמחזירים את ה-JSON, בדקו פנימית שכל מילה בכל אפשרות קיימת בשפה העברית והגיונית בהקשר השאלה. אם אינכם בטוחים שמונח מסוים הוא מילה עברית תקנית ונפוצה — אל תשתמשו בו; העדיפו ניסוח פשוט וברור על פני ניסוח מורכב או נדיר.
- true_false: options = ["נכון", "לא נכון"]. correctIndex = 0 (נכון) או 1 (לא נכון).
- open: options = [], correctIndex = 0, "answer" הוא תשובה קצרה/תקציר, ו-"modelAnswer" הוא תשובת מודל מקיפה ואיכותית — מנוסחת היטב, ברמה שתלמיד היה רוצה לכתוב במבחן, שמכסה את כל הנקודות החשובות מהחומר.
- כל שאלה חייבת להיות על תוכן אמיתי מהחומר — אסור להמציא.
- "explanation": הסבר קצר, ברור ומעודד למה התשובה הנכונה היא הנכונה — כתוב בטון חם ותומך (כמו חבר שמסביר, לא שופט), בהקשר התרחיש עצמו (אם השאלה מצבית), ולא רק "כי זה מה שכתוב בטקסט".
- ${conceptTagRule(true)}

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
      "modelAnswer": "תשובת מודל מלאה (רק לשאלות open, אחרת השמיט שדה זה)",
      "concept": "המושג הספציפי שהשאלה בודקת",
      "optionExplanations": ["הסבר התפיסה השגויה לבחירה ב'אפשרות א'", "הסבר התפיסה השגויה לבחירה ב'אפשרות ב'", null, "הסבר התפיסה השגויה לבחירה ב'אפשרות ד'"]
    }
  ]
}`
    : `## Study Material: "${materialTitle}"

${contentSlice(aggregatedContent)}
${excludeBlock}
---
Task: Create exactly ${questionCount} practice questions in English.
Question types: ${questionTypes.join(", ")}
Difficulty: ${difficulty}

Important rules:
- multiple_choice: 4 options in "options". "answer" is the exact text of the correct option. "correctIndex" is the 0-based index (0-3) of the correct option.
${scenarioMcRules(false)}
- Linguistic accuracy (mandatory): every word in every answer option — correct and incorrect alike — must be a real, grammatically correct, commonly understood word or phrase in the target language. Never use made-up words, gibberish, or nonsensical letter combinations. Before returning the JSON, internally verify that every word in every option is a real word and makes sense in context. If you are unsure whether a term is valid and commonly understood, do not use it — prefer simple, clear phrasing over complex or obscure wording.
- true_false: options = ["True", "False"]. correctIndex = 0 (True) or 1 (False).
- open: options = [], correctIndex = 0. "answer" is a short reference answer, and "modelAnswer" is a comprehensive, high-quality model answer — well-written, the kind a strong student would aim to write on an exam, covering all the key points from the material.
- All questions must be based on actual content — no fabrication.
- "explanation": a brief, clear, encouraging explanation of why the correct answer is right — written in a warm, supportive tone (like a friend explaining, not a judge), in context of the scenario itself (if the question is situational), not just "because the text says so."
- ${conceptTagRule(false)}

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
      "modelAnswer": "Full model answer (only for open questions, omit this field otherwise)",
      "concept": "the specific concept this question tests",
      "optionExplanations": ["misconception explanation for option A", "misconception explanation for option B", null, "misconception explanation for option D"]
    }
  ]
}`;

  const questions = await callGeminiJsonWithValidation(
    {
      systemInstruction: isHe ? SMART_STUDENT_SYSTEM_HE : SMART_STUDENT_SYSTEM_EN,
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      temperature: 0.4,
      jsonMode: true,
      maxOutputTokens: QUESTIONS_MAX_OUTPUT_TOKENS,
    },
    (text) => {
      const parsed = safeJsonParse(text);
      const result: GeneratedQuestion[] = Array.isArray(parsed.questions)
        ? parsed.questions.map((q: any) => ({ ...q, correctIndex: q.correctIndex ?? 0 }))
        : [];
      if (result.length === 0) throw new Error("empty questions array");
      return result;
    },
    "generateQuestionsAI",
  );
  const deduped = dedupeQuestionsAgainstExisting(questions, excludeQuestions ?? []);
  if (deduped.length < questions.length) {
    console.warn(`generateQuestionsAI: dropped ${questions.length - deduped.length} duplicate question(s) against previous runs.`);
  }
  console.log(`generateQuestionsAI: generated ${deduped.length} unique questions (requested ${questionCount}) for material ${materialId ?? "?"}.`);
  return deduped;
  } finally {
    if (materialId !== undefined) clearGenerationProgress(materialId);
  }
}

const EXAM_TYPE_MAP: Record<string, { he: string; en: string }> = {
  practice:   { he: "תרגול (שאלות מגוונות בקצב נוח)", en: "practice (varied questions, relaxed pace)" },
  topic_quiz: { he: "חידון נושאי (ממוקד בנושאים ספציפיים)", en: "topic quiz (focused on specific topics)" },
  midterm:    { he: "מבחן אמצע סמסטר (מקיף, מעורב)", en: "midterm exam (comprehensive, mixed types)" },
  final:      { he: "מבחן גמר (מקיף, קשה, מעמיק)", en: "final exam (comprehensive, challenging, in-depth)" },
};

function examTypeDesc(examType: string, isHe: boolean): string {
  return isHe
    ? (EXAM_TYPE_MAP[examType]?.he ?? EXAM_TYPE_MAP.practice.he)
    : (EXAM_TYPE_MAP[examType]?.en ?? EXAM_TYPE_MAP.practice.en);
}

// Output-token ceiling for ONE chunk's worth of exam questions. Higher than
// the equivalent questions-pipeline cap (2500) because every exam chunk
// always mixes in open questions with a full modelAnswer, which run
// noticeably longer than multiple_choice/true_false -- the old 2500 cap was
// truncating those mid-object often enough to fail validation on every chunk.
const CHUNK_EXAM_MAX_OUTPUT_TOKENS = 4096;
const EXAM_QUESTIONS_PER_CHUNK_CAP = 4;

async function generateExamQuestionsForChunk(
  chunk: string,
  materialTitle: string,
  isHe: boolean,
  index: number,
  total: number,
  questionsForChunk: number,
  examDesc: string,
  difficulty: string,
  topicsLine: string,
  excludeBlock: string,
): Promise<GeneratedQuestion[]> {
  const userPrompt = isHe
    ? `## חלק ${index}/${total} מחומר הלימוד: "${materialTitle}"
${topicsLine}
סוג מבחן: ${examDesc} | רמת קושי: ${difficulty}

${chunk}
${excludeBlock}
---
המשימה: צור עד ${questionsForChunk} שאלות מבחן בעברית, מבוססות רק על תוכן מהחלק הזה בלבד -- אל תתייחס לחלקים אחרים.
שלב סוגי שאלות: multiple_choice (70%), true_false (15%), open (15%).

כללי JSON:
- multiple_choice: 4 אפשרויות, correctIndex = אינדקס 0-3 של הנכונה.
${scenarioMcRules(true)}
- דיוק לשוני (חובה): כל מילה בכל אפשרות תשובה חייבת להיות מילה עברית אמיתית ותקנית.
- true_false: options = ["נכון", "לא נכון"], correctIndex = 0 או 1.
- open: options = [], correctIndex = 0. "answer" תשובה קצרה, "modelAnswer" תשובת מודל מקיפה.
- אם אין מספיק תוכן ייחודי בחלק הזה, צור פחות שאלות.
- "explanation": הסבר קצר, ברור ומעודד -- בהקשר התרחיש עצמו אם השאלה מצבית.
- ${conceptTagRule(true)}

החזר JSON במבנה הבא בלבד:
{"questions": [{"question": "שאלה", "answer": "תשובה נכונה", "explanation": "הסבר", "options": ["א", "ב", "ג", "ד"], "correctIndex": 1, "questionType": "multiple_choice", "difficulty": "medium", "concept": "המושג הספציפי שהשאלה בודקת", "optionExplanations": ["הסבר התפיסה השגויה לבחירה ב'א'", null, "הסבר התפיסה השגויה לבחירה ב'ג'", "הסבר התפיסה השגויה לבחירה ב'ד'"]}]}`
    : `## Part ${index}/${total} of study material: "${materialTitle}"
${topicsLine}
Exam type: ${examDesc} | Difficulty: ${difficulty}

${chunk}
${excludeBlock}
---
Task: create up to ${questionsForChunk} exam questions in English, based only on content from this part -- do not reference other parts.
Mix question types: multiple_choice (70%), true_false (15%), open (15%).

JSON rules:
- multiple_choice: 4 options, correctIndex = 0-based index of the correct one.
${scenarioMcRules(false)}
- Linguistic accuracy (mandatory): every word in every option must be a real, grammatically correct word.
- true_false: options = ["True", "False"], correctIndex = 0 or 1.
- open: options = [], correctIndex = 0. "answer" short reference answer, "modelAnswer" comprehensive model answer.
- Create fewer questions if there isn't enough unique content in this part.
- "explanation": a brief, clear, encouraging explanation -- in context of the scenario itself if the question is situational.
- ${conceptTagRule(false)}

Return ONLY JSON matching this structure:
{"questions": [{"question": "Question", "answer": "Correct answer", "explanation": "Explanation", "options": ["A", "B", "C", "D"], "correctIndex": 1, "questionType": "multiple_choice", "difficulty": "medium", "concept": "the specific concept this question tests", "optionExplanations": ["misconception explanation for option A", null, "misconception explanation for option C", "misconception explanation for option D"]}]}`;

  return callGeminiJsonWithValidation(
    {
      systemInstruction: isHe ? SMART_STUDENT_SYSTEM_HE : SMART_STUDENT_SYSTEM_EN,
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      temperature: 0.4,
      jsonMode: true,
      maxOutputTokens: CHUNK_EXAM_MAX_OUTPUT_TOKENS,
    },
    (text) => {
      const parsed = safeJsonParse(text);
      const result = Array.isArray(parsed.questions)
        ? filterValidQuestions(parsed.questions.map((q: any) => ({ ...q, correctIndex: q.correctIndex ?? 0 })))
        : [];
      if (result.length === 0) throw new Error("empty questions array");
      return result;
    },
    `generateExamQuestionsForChunk(${index}/${total})`,
  );
}

export function generateExamAI(
  opts: AIGenerationOptions & { questionCount: number; examType: string; difficulty: string; topics?: string[]; excludeQuestions?: string[] }
): Promise<Array<{ question: string; answer: string; explanation: string; options: string[]; correctIndex: number; questionType: string; difficulty: string; modelAnswer?: string; concept?: string; optionExplanations?: (string | null)[] }>> {
  return pipelineLimit(() => generateExamAIImpl(opts));
}

async function generateExamAIImpl(
  opts: AIGenerationOptions & { questionCount: number; examType: string; difficulty: string; topics?: string[]; excludeQuestions?: string[] }
): Promise<Array<{ question: string; answer: string; explanation: string; options: string[]; correctIndex: number; questionType: string; difficulty: string; modelAnswer?: string; concept?: string; optionExplanations?: (string | null)[] }>> {
  const { language, materialContent, materialTitle, questionCount, examType, difficulty, topics, materialId, excludeQuestions } = opts;
  const isHe = language === "he";
  try {
  const { parts, chunked } = await buildAggregatedContent(materialContent, materialTitle, isHe, materialId);
  const excludeBlock = buildExcludeQuestionsBlock(excludeQuestions ?? [], isHe);

  const topicsLine = topics?.length
    ? (isHe ? `נושאים ממוקדים: ${topics.join(", ")}` : `Focused topics: ${topics.join(", ")}`)
    : "";

  const examDesc = examTypeDesc(examType, isHe);

  // Large/chunked documents: one small, bounded-output call per chunk
  // instead of one call over the whole aggregated text -- same fix as
  // generateFlashcardsAI/generateQuestionsAI above, since this route has the
  // same single-call truncation risk on a large document.
  if (chunked) {
    const perChunkCount = Math.max(2, Math.min(EXAM_QUESTIONS_PER_CHUNK_CAP, Math.ceil(questionCount / parts.length)));
    const cumulativeExclude = [...(excludeQuestions ?? [])];
    const allQuestions: GeneratedQuestion[] = [];

    for (let i = 0; i < parts.length; i++) {
      const chunkExcludeBlock = buildExcludeQuestionsBlock(cumulativeExclude, isHe);
      try {
        const chunkQuestions = await withChunkRetry(`generateExamQuestionsForChunk(${i + 1}/${parts.length})`, () => generateExamQuestionsForChunk(parts[i], materialTitle, isHe, i + 1, parts.length, perChunkCount, examDesc, difficulty, topicsLine, chunkExcludeBlock));
        const deduped = dedupeQuestionsAgainstExisting(chunkQuestions, cumulativeExclude);
        allQuestions.push(...deduped);
        cumulativeExclude.push(...deduped.map((q) => q.question));
      } catch (err) {
        if (err instanceof RateLimitExhaustedError) throw err;
        console.error(`generateExamAI: chunk ${i + 1}/${parts.length} failed after retries, skipping:`, err);
      }

      const completed = i + 1;
      const percentage = Math.round((completed / parts.length) * 100);
      if (materialId !== undefined) {
        setGenerationProgress(materialId, { currentChunk: completed, totalChunks: parts.length, percentage, stage: "chunking" });
      }
      if (completed < parts.length) {
        await sleep(INTER_CHUNK_COOLDOWN_MS);
      }
    }

    if (allQuestions.length === 0) throw new EmptyGenerationError("generateExamAI");

    const trimmed = allQuestions.slice(0, questionCount);
    console.log(`generateExamAI: generated ${trimmed.length} unique questions across ${parts.length} chunks (requested ${questionCount}) for material ${materialId ?? "?"}.`);
    return trimmed;
  }

  const aggregatedContent = parts[0];

  const userPrompt = isHe
    ? `## חומר לימוד: "${materialTitle}"
${topicsLine}
סוג מבחן: ${examDesc} | רמת קושי: ${difficulty}

${contentSlice(aggregatedContent)}
${excludeBlock}
---
המשימה: צור מבחן עם בדיוק ${questionCount} שאלות בעברית.
שלב סוגי שאלות: multiple_choice (70%), true_false (15%), open (15%).

כללי JSON:
- multiple_choice: 4 אפשרויות, correctIndex = אינדקס 0-3 של הנכונה.
${scenarioMcRules(true)}
- דיוק לשוני (חובה): כל מילה בכל אפשרות תשובה — נכונה כמו שגויה — חייבת להיות מילה עברית אמיתית, תקנית ומובנת. אסור בהחלט להשתמש במילים מומצאות, צירופי אותיות חסרי משמעות, או "גיבריש". לפני שמחזירים את ה-JSON, בדקו פנימית שכל מילה בכל אפשרות קיימת בשפה העברית והגיונית בהקשר השאלה. אם אינכם בטוחים שמונח מסוים הוא מילה עברית תקנית ונפוצה — אל תשתמשו בו; העדיפו ניסוח פשוט וברור על פני ניסוח מורכב או נדיר.
- true_false: options = ["נכון", "לא נכון"], correctIndex = 0 או 1.
- open: options = [], correctIndex = 0. "answer" הוא תשובה קצרה/תקציר, ו-"modelAnswer" הוא תשובת מודל מקיפה ואיכותית, ברמת תשובת מבחן מצוינת, המכסה את כל הנקודות החשובות.
- "explanation": הסבר קצר, ברור ומעודד למה התשובה הנכונה היא הנכונה — בטון חם ותומך, בהקשר התרחיש עצמו אם השאלה מצבית, לא רק ציטוט מהטקסט.
- ${conceptTagRule(true)}

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
      "modelAnswer": "תשובת מודל מלאה (רק לשאלות open, אחרת השמיט שדה זה)",
      "concept": "המושג הספציפי שהשאלה בודקת",
      "optionExplanations": ["הסבר התפיסה השגויה לבחירה ב'א'", null, "הסבר התפיסה השגויה לבחירה ב'ג'", "הסבר התפיסה השגויה לבחירה ב'ד'"]
    }
  ]
}`
    : `## Study Material: "${materialTitle}"
${topicsLine}
Exam type: ${examDesc} | Difficulty: ${difficulty}

${contentSlice(aggregatedContent)}
${excludeBlock}
---
Task: Create an exam with exactly ${questionCount} questions in English.
Mix question types: multiple_choice (70%), true_false (15%), open (15%).

JSON rules:
- multiple_choice: 4 options, correctIndex = 0-based index of the correct one.
${scenarioMcRules(false)}
- Linguistic accuracy (mandatory): every word in every answer option — correct and incorrect alike — must be a real, grammatically correct, commonly understood word or phrase in the target language. Never use made-up words, gibberish, or nonsensical letter combinations. Before returning the JSON, internally verify that every word in every option is a real word and makes sense in context. If you are unsure whether a term is valid and commonly understood, do not use it — prefer simple, clear phrasing over complex or obscure wording.
- true_false: options = ["True", "False"], correctIndex = 0 or 1.
- open: options = [], correctIndex = 0. "answer" is a short reference answer, and "modelAnswer" is a comprehensive, high-quality model answer at the level of an excellent exam response, covering all the key points.
- "explanation": a brief, clear, encouraging explanation of why the correct answer is right — warm and supportive in tone, in context of the scenario itself if the question is situational, not just a quote from the text.
- ${conceptTagRule(false)}

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
      "modelAnswer": "Full model answer (only for open questions, omit this field otherwise)",
      "concept": "the specific concept this question tests",
      "optionExplanations": ["misconception explanation for option A", null, "misconception explanation for option C", "misconception explanation for option D"]
    }
  ]
}`;

  const questions = await callGeminiJsonWithValidation(
    {
      systemInstruction: isHe ? SMART_STUDENT_SYSTEM_HE : SMART_STUDENT_SYSTEM_EN,
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      temperature: 0.4,
      jsonMode: true,
      maxOutputTokens: EXAM_MAX_OUTPUT_TOKENS,
    },
    (text) => {
      const parsed = safeJsonParse(text);
      const result = Array.isArray(parsed.questions)
        ? filterValidQuestions(parsed.questions.map((q: any) => ({ ...q, correctIndex: q.correctIndex ?? 0 })))
        : [];
      if (result.length === 0) throw new Error("empty questions array");
      return result;
    },
    "generateExamAI",
  );
  const deduped = dedupeQuestionsAgainstExisting(questions, excludeQuestions ?? []);
  if (deduped.length < questions.length) {
    console.warn(`generateExamAI: dropped ${questions.length - deduped.length} duplicate question(s) against previous exams.`);
  }
  console.log(`generateExamAI: generated ${deduped.length} unique questions (requested ${questionCount}) for material ${materialId ?? "?"}.`);
  return deduped;
  } finally {
    if (materialId !== undefined) clearGenerationProgress(materialId);
  }
}

// Output-token ceiling for a single targeted question. Generous relative to
// what one multiple_choice item actually needs, since it still carries a
// full optionExplanations breakdown (3 distractor explanations) alongside
// the question itself.
const TARGETED_QUESTION_MAX_OUTPUT_TOKENS = 1200;

/**
 * Relearning-loop entry point: generates exactly ONE scenario-based
 * multiple_choice question that re-tests a single concept a student has
 * repeatedly gotten wrong (across flashcards or quizzes). Deliberately a
 * single bounded call against a content slice rather than reusing the
 * chunked generateQuestionsAI pipeline -- that pipeline is built to spread
 * N questions across an entire document, which is the wrong shape for "give
 * me one rescue question about this exact concept right now."
 */
export function generateTargetedConceptQuestionAI(
  opts: AIGenerationOptions & { concept: string; excludeQuestions?: string[] }
): Promise<{ question: string; answer: string; explanation: string; options: string[]; correctIndex: number; questionType: string; difficulty: string; concept?: string; optionExplanations?: (string | null)[] } | null> {
  return pipelineLimit(() => generateTargetedConceptQuestionAIImpl(opts));
}

async function generateTargetedConceptQuestionAIImpl(
  opts: AIGenerationOptions & { concept: string; excludeQuestions?: string[] }
): Promise<{ question: string; answer: string; explanation: string; options: string[]; correctIndex: number; questionType: string; difficulty: string; concept?: string; optionExplanations?: (string | null)[] } | null> {
  const { language, materialContent, materialTitle, concept, excludeQuestions } = opts;
  const isHe = language === "he";
  const excludeBlock = buildExcludeQuestionsBlock(excludeQuestions ?? [], isHe);

  const userPrompt = isHe
    ? `## חומר לימוד: "${materialTitle}"

${contentSlice(materialContent)}
${excludeBlock}
---
המשימה: התלמיד/ה התקשה שוב ושוב במושג הספציפי הזה: "${concept}". צרו שאלת אמריקאית (multiple_choice) אחת בלבד, ממוקדת בדיוק במושג הזה, שתעזור לתלמיד/ה להבין ולתקן את הטעות.

כללי JSON:
- 4 אפשרויות ב-"options". "answer" הוא הטקסט של התשובה הנכונה בלבד. "correctIndex" הוא האינדקס (0-3) של האפשרות הנכונה.
${scenarioMcRules(true)}
- דיוק לשוני (חובה): כל מילה בכל אפשרות תשובה חייבת להיות מילה עברית אמיתית ותקנית.
- השאלה חייבת להיות ממוקדת אך ורק במושג "${concept}" -- אל תבדקו מושג אחר.
- "explanation": הסבר קצר, ברור ומעודד למה התשובה הנכונה היא הנכונה, בהקשר התרחיש עצמו אם השאלה מצבית.
- "concept": חזרו על אותו מושג בדיוק כפי שניתן לכם: "${concept}".

החזר JSON במבנה הבא בלבד, אובייקט שאלה אחד (לא מערך):
{"question": "שאלה", "answer": "תשובה נכונה", "explanation": "הסבר", "options": ["א", "ב", "ג", "ד"], "correctIndex": 0, "questionType": "multiple_choice", "difficulty": "medium", "concept": "${concept}", "optionExplanations": [null, "הסבר התפיסה השגויה לבחירה ב'ב'", "הסבר התפיסה השגויה לבחירה ב'ג'", "הסבר התפיסה השגויה לבחירה ב'ד'"]}`
    : `## Study Material: "${materialTitle}"

${contentSlice(materialContent)}
${excludeBlock}
---
Task: the student has repeatedly struggled with this specific concept: "${concept}". Create exactly ONE multiple_choice question, focused precisely on this concept, that will help the student understand and correct the misconception.

JSON rules:
- 4 options in "options". "answer" is the exact text of the correct option. "correctIndex" is the 0-based index (0-3) of the correct option.
${scenarioMcRules(false)}
- Linguistic accuracy (mandatory): every word in every option must be a real, grammatically correct word in the target language.
- The question must be focused exclusively on the concept "${concept}" -- do not test any other concept.
- "explanation": a brief, clear, encouraging explanation of why the correct answer is right, in context of the scenario itself if the question is situational.
- "concept": echo back this exact concept string: "${concept}".

Return ONLY JSON matching this structure, a single question object (not an array):
{"question": "Question text", "answer": "Correct answer", "explanation": "Explanation", "options": ["A", "B", "C", "D"], "correctIndex": 0, "questionType": "multiple_choice", "difficulty": "medium", "concept": "${concept}", "optionExplanations": [null, "misconception explanation for option B", "misconception explanation for option C", "misconception explanation for option D"]}`;

  try {
    const question = await callGeminiJsonWithValidation(
      {
        systemInstruction: isHe ? SMART_STUDENT_SYSTEM_HE : SMART_STUDENT_SYSTEM_EN,
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        temperature: 0.4,
        jsonMode: true,
        maxOutputTokens: TARGETED_QUESTION_MAX_OUTPUT_TOKENS,
      },
      (text) => {
        const parsed = safeJsonParse(text);
        const candidate = Array.isArray(parsed.questions) ? parsed.questions[0] : parsed;
        const [valid] = filterValidQuestions([{ ...candidate, correctIndex: candidate?.correctIndex ?? 0 }]);
        if (!valid) throw new Error("invalid targeted question");
        return valid;
      },
      `generateTargetedConceptQuestionAI(${concept})`,
    );
    return question;
  } catch (err) {
    if (err instanceof RateLimitExhaustedError) throw err;
    console.error(`generateTargetedConceptQuestionAI: failed to generate question for concept "${concept}":`, err);
    return null;
  }
}

// Vocab-Kit's one AI-backed piece: writing a natural example sentence with a
// blank for a bounded subset of vocabulary words. Everything else in the
// Vocab-Kit path (flashcards, the MC quiz, and the MC options for these
// sentences) is deterministic -- see lib/vocab.ts -- because there's nothing
// for an LLM to "understand" beyond a literal term/definition pair. A natural
// sentence is the one thing that genuinely needs generation. The model
// returns only {word, sentence}; the route builds the actual 4-option
// distractor array itself (reusing vocab.ts's pickDistractors), so the only
// JSON shape we need to trust the model for is two string fields per item.
export async function generateVocabFillInBlanksAI(opts: {
  language: "he" | "en";
  words: string[];
  materialTitle: string;
  materialId?: number;
}): Promise<Array<{ word: string; sentence: string }>> {
  return pipelineLimit(() => generateVocabFillInBlanksAIImpl(opts));
}

async function generateVocabFillInBlanksAIImpl(opts: {
  language: "he" | "en";
  words: string[];
  materialTitle: string;
  materialId?: number;
}): Promise<Array<{ word: string; sentence: string }>> {
  const { language, words, materialTitle } = opts;
  const isHe = language === "he";
  if (words.length === 0) return [];

  const wordList = words.map((w, i) => `${i + 1}. ${w}`).join("\n");

  const userPrompt = isHe
    ? `## רשימת מילים מתוך "${materialTitle}":
${wordList}

המשימה: לכל מילה ברשימה, כתבו משפט טבעי אחד וקצר (5-15 מילים) המשתמש במילה הזו בהקשר ברור, ואז החליפו את המילה עצמה במשפט בסימן "____" (4 קווים תחתיים).
כללים:
- "word" חייב להיות זהה אות-באות למילה כפי שניתנה לכם ברשימה -- אסור לשנות צורת נטייה, ריבוי/יחיד, או זמן.
- ה-"____" במשפט הוא תחליף ישיר למילה הזו בלבד, כך שהמשפט יישאר תקין דקדוקית כשמחזירים את המילה למקומה.
- אל תכתבו את המילה במקום אחר באותו משפט.
- המשפט חייב לתת הקשר מספיק כדי שתלמיד שיודע את משמעות המילה יוכל לבחור אותה מבין כמה אפשרויות.

החזירו JSON במבנה הבא בלבד:
{"items": [{"word": "המילה", "sentence": "משפט עם ____ במקום המילה"}]}`
    : `## Word list from "${materialTitle}":
${wordList}

Task: for each word in the list, write one short, natural sentence (5-15 words) that uses the word in clear context, then replace that exact word in the sentence with "____" (4 underscores).
Rules:
- "word" must be identical, character-for-character, to the word as given in the list -- do not change its inflection, plural/singular form, or tense.
- The "____" in the sentence is a direct stand-in for that word only, so the sentence stays grammatically correct when the word is put back in its place.
- Do not write the word anywhere else in the same sentence.
- The sentence must give enough context that a student who knows the word's meaning could pick it out from a few options.

Return ONLY JSON matching this structure:
{"items": [{"word": "the word", "sentence": "a sentence with ____ in place of the word"}]}`;

  try {
    return await callGeminiJsonWithValidation(
      {
        systemInstruction: isHe ? SMART_STUDENT_SYSTEM_HE : SMART_STUDENT_SYSTEM_EN,
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        temperature: 0.5,
        jsonMode: true,
        maxOutputTokens: VOCAB_FILL_IN_BLANK_MAX_OUTPUT_TOKENS,
      },
      (text) => {
        const parsed = safeJsonParse(text);
        const result = Array.isArray(parsed.items)
          ? parsed.items.filter(
              (it: any) =>
                typeof it?.word === "string" && it.word.trim().length > 0 &&
                typeof it?.sentence === "string" && it.sentence.includes("____")
            )
          : [];
        if (result.length === 0) throw new Error("empty fill-in-blank items array");
        return result as Array<{ word: string; sentence: string }>;
      },
      "generateVocabFillInBlanksAI",
    );
  } catch (err) {
    if (err instanceof RateLimitExhaustedError) throw err;
    console.error("generateVocabFillInBlanksAI: failed to generate fill-in-blank sentences:", err);
    return [];
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

  // Gemini's chat turns use "model" for the assistant role, not "assistant".
  const contents: Content[] = [
    ...history.slice(-10).map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
    { role: "user", parts: [{ text: userMessage }] },
  ];

  return callGeminiWithRetry({
    systemInstruction: systemPrompt,
    contents,
    temperature: 0.6,
  });
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

  const text = await callGeminiWithRetry({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    temperature: 0.2,
    jsonMode: true,
  });

  const parsed = safeJsonParse(text);
  return { correct: !!parsed.correct, explanation: parsed.explanation || "" };
}
