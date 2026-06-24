import { GoogleGenAI, type Content } from "@google/genai";
import { splitTextIntoChunks } from "./chunker";
import { setGenerationProgress, clearGenerationProgress } from "./progress";

// SECURITY: the Gemini API key must only ever come from the environment —
// never hardcode it here or anywhere else in source. Render (and local
// .env files) are expected to provide GEMINI_API_KEY at runtime.
if (!process.env.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY environment variable is required but was not provided.");
}

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// gemini-1.5-flash was fully retired by Google on 2025-09-24 -- every call
// to it now 404s immediately (not retryable), which is why failures here
// surface in seconds rather than after the full retry budget is exhausted.
// gemini-3.5-flash (the current stable GA default) is hitting sustained 503
// "high demand" capacity errors even with the widened retry budget below --
// falling back to gemini-2.5-flash, which is still fully supported until
// its scheduled retirement on 2026-10-16.
const TEXT_MODEL = "gemini-2.5-flash";
// Audio transcription (Whisper) stays on Groq — see extractor.ts, which
// reads GROQ_API_KEY directly via a raw fetch call. This constant is kept
// here only because extractor.ts imports it alongside other AI helpers.
export const AUDIO_MODEL = "whisper-large-v3";

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
  // Strip ```json / ``` fences first -- jsonMode's responseMimeType should
  // already prevent these, but some Gemini responses still wrap output in
  // markdown fences regardless of the requested mime type.
  const cleaned = rawText.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
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
      // Truncated rather than the full text -- this is most often hit when
      // the model's JSON got cut off mid-output (see thinkingBudget: 0
      // below), so the interesting part is the END of the string, not a
      // multi-KB dump of content that parsed fine up to that point.
      console.error("Failed to parse AI JSON response. Last 500 chars:", cleaned.slice(-500));
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

// Thrown after a 429 survives every retry attempt, so callers stop instead
// of silently hammering an already-exhausted rate-limit window. Carries a
// user-facing message so app.ts's catch-all handler can surface it as-is.
export class RateLimitExhaustedError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super("System is currently at maximum capacity. Please try again in a few minutes.");
    this.name = "RateLimitExhaustedError";
    tripCircuitBreaker(retryAfterSeconds);
  }
}

// Circuit breaker: once a hard rate limit is confirmed (see
// RateLimitExhaustedError above), every subsequent Gemini call across the
// whole process is blocked until the cool-down passes — instead of letting
// a stray click or a new request slip through and extend the penalty.
// Module-level state is sufficient here: this is a single-process API
// server, and the goal is just to stop hammering the API, not to coordinate
// across instances.
const CIRCUIT_BREAKER_MAX_COOLDOWN_MS = 60 * 60 * 1000;
let circuitBreakerBlockedUntil: number | null = null;

function tripCircuitBreaker(retryAfterSeconds: number): void {
  const cooldownMs = Math.min(Math.max(retryAfterSeconds, 1) * 1000, CIRCUIT_BREAKER_MAX_COOLDOWN_MS);
  const until = Date.now() + cooldownMs;
  if (!circuitBreakerBlockedUntil || until > circuitBreakerBlockedUntil) {
    circuitBreakerBlockedUntil = until;
  }
  console.error(`Circuit breaker tripped: blocking all Gemini calls until ${new Date(circuitBreakerBlockedUntil).toISOString()}.`);
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
function checkCircuitBreaker(): void {
  if (circuitBreakerBlockedUntil === null) return;
  const remainingMs = circuitBreakerBlockedUntil - Date.now();
  if (remainingMs <= 0) {
    circuitBreakerBlockedUntil = null;
    return;
  }
  throw new SystemBlockedError(Math.ceil(remainingMs / 60000));
}

// Used when a 429 survives all retries -- Gemini's error shape doesn't
// reliably expose a retry-after value the way Groq's headers did, so we just
// cool down for a fixed window comfortably longer than its per-minute quota.
const RATE_LIMIT_COOLDOWN_SECONDS = 90;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
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
 * rate limits (429) and transient errors, so a single flaky request doesn't
 * take down the whole pipeline (and, in turn, the HTTP response) with it.
 */
async function callGeminiWithRetry(params: GeminiCallParams): Promise<string> {
  checkCircuitBreaker();

  let lastError: any;
  for (let attempt = 0; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
    try {
      const response = await withAttemptTimeout(
        genAI.models.generateContent({
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
        name: error?.name,
        status: error?.status ?? error?.response?.status,
        message: error?.message,
        cause: error?.cause,
        errorDetails: error?.error ?? error?.response?.error,
        raw: safeStringifyError(error),
      });
      if (isRateLimitError(error) && attempt === MAX_RETRY_ATTEMPTS) {
        console.error("callGeminiWithRetry: rate limit survived all retries, failing fast.");
        throw new RateLimitExhaustedError(RATE_LIMIT_COOLDOWN_SECONDS);
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
  // Every attempt is exhausted (and it wasn't a confirmed rate limit, which
  // throws earlier as RateLimitExhaustedError) -- this is a network outage,
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
    ? `## חלק ${index}/${total} מחומר הלימוד: "${materialTitle}"\n\n${chunk}\n\n---\nסכם בהרחבה ובמדויק את כל העובדות, המושגים והנקודות החשובות שמופיעות בקטע הזה בלבד. כתוב כרשימת נקודות עובדתיות וממוקדות, בלי כותרות ובלי הקדמות. אל תשמיט אף עובדה מהותית, ואל תוסיף שום מידע שלא מופיע בקטע.`
    : `## Part ${index}/${total} of study material: "${materialTitle}"\n\n${chunk}\n\n---\nThoroughly and precisely summarize all the facts, concepts, and important points that appear in this part only. Write a focused, factual bullet list — no headings, no preamble. Do not omit any substantive fact, and do not add information that isn't in this part.`;

  return callGeminiWithRetry({
    systemInstruction: isHe ? SMART_STUDENT_SYSTEM_HE : SMART_STUDENT_SYSTEM_EN,
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
      batchIndexes.map((i) => summarizeChunk(chunks[i], materialTitle, isHe, i + 1, chunks.length)),
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
};

function buildExcludeQuestionsBlock(existingQuestionTexts: string[], isHe: boolean): string {
  if (existingQuestionTexts.length === 0) return "";
  const list = existingQuestionTexts.slice(0, 50).map((q) => `- ${q}`).join("\n");
  return isHe
    ? `\n\nשאלות שכבר נוצרו בעבר עבור חומר זה — אסור לחזור עליהן או על וריאציות קרובות שלהן, צרו שאלות חדשות ושונות:\n${list}\n`
    : `\n\nQuestions already generated previously for this material — do not repeat these or close variations, create new and different questions:\n${list}\n`;
}

// Strict chunk-by-chunk pipeline used by generate-all.ts for large
// documents. Previously, generateSummary/generateFlashcardsAI/
// generateQuestionsAI each independently re-chunked and re-summarized the
// SAME raw document via their own buildAggregatedContent call -- on an
// 84-page document that tripled the number of Gemini calls a single run
// made, and the final flashcard/exam/question call still got the entire
// (now large) aggregated content in one shot, risking the truncation and
// 503s reported against that document. This collapses summary + flashcard
// generation into ONE pass: each ~15,000-char sub-chunk (roughly 5-8 pages)
// gets exactly one isolated Gemini call producing both its factual summary
// and its flashcards together, so no single call's input or output payload
// ever approaches the sizes that were triggering failures.
const SUBCHUNK_CHAR_LIMIT = 15000;
const CHUNK_COMBINED_MAX_OUTPUT_TOKENS = 3000;
const MAX_CARDS_PER_CHUNK = 6;

async function processSummaryAndFlashcardsChunk(
  chunk: string,
  materialTitle: string,
  isHe: boolean,
  index: number,
  total: number,
  cardsForChunk: number,
): Promise<{ summary: string; cards: Array<{ front: string; back: string; difficulty: string; cardType: string }> }> {
  const prompt = isHe
    ? `## חלק ${index}/${total} מחומר הלימוד: "${materialTitle}"

${chunk}

---
בצע שתי משימות על הקטע הזה בלבד -- אל תתייחס לחלקים אחרים של החומר:
1. summary: סכם בהרחבה ובמדויק את כל העובדות, המושגים והנקודות החשובות שמופיעות בקטע, כרשימת נקודות עובדתיות, בלי כותרות ובלי הקדמות. אל תשמיט אף עובדה מהותית, ואל תוסיף מידע שלא מופיע בקטע.
2. cards: צור עד ${cardsForChunk} כרטיסיות לימוד ייחודיות, מבוססות רק על עובדות מהקטע הזה. אם אין מספיק עובדות שונות -- צור פחות כרטיסיות, אסור לחזור על מושג.

החזר JSON בלבד במבנה הבא:
{"summary": "...", "cards": [{"front": "שאלה", "back": "תשובה", "difficulty": "medium", "cardType": "definition"}]}`
    : `## Part ${index}/${total} of study material: "${materialTitle}"

${chunk}

---
Do two tasks on this part only -- do not reference other parts:
1. summary: thoroughly and precisely summarize all facts, concepts, and important points in this part as a factual bullet list, no headings or preamble. Omit nothing substantive, add nothing not in this part.
2. cards: create up to ${cardsForChunk} unique flashcards based only on facts in this part. Create fewer if there aren't enough distinct facts -- never repeat a concept.

Return ONLY JSON matching this structure:
{"summary": "...", "cards": [{"front": "question", "back": "answer", "difficulty": "medium", "cardType": "definition"}]}`;

  return callGeminiJsonWithValidation(
    {
      systemInstruction: isHe ? SMART_STUDENT_SYSTEM_HE : SMART_STUDENT_SYSTEM_EN,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      temperature: 0.3,
      jsonMode: true,
      maxOutputTokens: CHUNK_COMBINED_MAX_OUTPUT_TOKENS,
    },
    (text) => {
      const parsed = safeJsonParse(text);
      const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
      const cards = Array.isArray(parsed.cards) ? parsed.cards : [];
      if (!summary && cards.length === 0) throw new Error("empty summary and cards");
      return { summary, cards };
    },
    `processSummaryAndFlashcardsChunk(${index}/${total})`,
  );
}

/**
 * Strict MapReduce pipeline for large documents: splits the raw material
 * into ~15,000-char sub-chunks and makes exactly one isolated Gemini call
 * per chunk for both its summary and its flashcards (see
 * processSummaryAndFlashcardsChunk above), processed strictly sequentially
 * with the same inter-chunk cooldown buildAggregatedContent uses. A chunk
 * that fails after every retry is replaced with a placeholder summary and
 * simply contributes no cards, instead of aborting the whole document --
 * the same "fail one part, not the run" guarantee buildAggregatedContent
 * already gives the rest of the pipeline. A confirmed rate-limit exhaustion
 * still aborts immediately rather than burning the rest of the budget on
 * chunks that would also fail.
 *
 * Short/unchunked documents fall through to the existing single-call
 * generateSummary/generateFlashcardsAI implementations unchanged, since
 * those already work reliably at that size.
 */
export async function generateSummaryAndFlashcards(
  opts: AIGenerationOptions & { summaryType: string; maxFlashcards: number; cardTypes: string[] }
): Promise<{
  summary: { content: string; keyPoints: string[] };
  flashcards: Array<{ front: string; back: string; difficulty: string; cardType: string }>;
  // Genuinely-summarized content only (no failure placeholders) -- the safe
  // input for any further AI call (e.g. question generation) made on top of
  // this result. Falls back to `summary.content` on the non-chunked path,
  // where there are no placeholders to begin with.
  cleanContent: string;
}> {
  const { language, materialContent, materialTitle, materialId, maxFlashcards } = opts;
  const isHe = language === "he";

  checkCircuitBreaker();

  try {
    if (materialContent.length <= CHUNK_TRIGGER_CHAR_LENGTH) {
      const [summary, flashcards] = await Promise.all([
        generateSummary(opts),
        generateFlashcardsAI({ ...opts, cardCount: maxFlashcards }),
      ]);
      return { summary, flashcards, cleanContent: summary.content };
    }

    const chunks = splitTextIntoChunks(materialContent, SUBCHUNK_CHAR_LIMIT);
    if (chunks.length <= 1) {
      const [summary, flashcards] = await Promise.all([
        generateSummary(opts),
        generateFlashcardsAI({ ...opts, cardCount: maxFlashcards }),
      ]);
      return { summary, flashcards, cleanContent: summary.content };
    }

    const cardsPerChunk = Math.max(1, Math.min(MAX_CARDS_PER_CHUNK, Math.ceil(maxFlashcards / chunks.length)));
    const chapterParts: string[] = new Array(chunks.length);
    // Only genuinely-generated summaries -- never placeholder failure text --
    // so downstream synthesis (keyPoints/executiveSummary) and question
    // generation are never fed back a description of our own failure.
    const successfulParts: string[] = [];
    const allCards: Array<{ front: string; back: string; difficulty: string; cardType: string }> = [];
    let failedChunkCount = 0;

    for (let i = 0; i < chunks.length; i++) {
      try {
        const { summary, cards } = await processSummaryAndFlashcardsChunk(chunks[i], materialTitle, isHe, i + 1, chunks.length, cardsPerChunk);
        const resolvedSummary = summary || (isHe
          ? "[לא נמצאו עובדות נוספות בחלק זה]"
          : "[No additional facts found in this part]");
        chapterParts[i] = resolvedSummary;
        if (summary) successfulParts.push(summary);
        allCards.push(...cards);
      } catch (err) {
        if (err instanceof RateLimitExhaustedError) throw err;
        console.error(`generateSummaryAndFlashcards: chunk ${i + 1}/${chunks.length} failed after retries:`, err);
        failedChunkCount++;
        chapterParts[i] = isHe
          ? "[לא ניתן היה לעבד חלק זה של החומר עקב תקלה זמנית]"
          : "[This part of the material could not be processed due to a temporary error]";
      }

      const completed = i + 1;
      const percentage = Math.round((completed / chunks.length) * 100);
      console.log(`generateSummaryAndFlashcards: processed ${completed}/${chunks.length} chunks (${percentage}%), ${allCards.length} cards so far.`);
      if (materialId !== undefined) {
        setGenerationProgress(materialId, { currentChunk: completed, totalChunks: chunks.length, percentage, stage: "chunking" });
      }
      if (completed < chunks.length) {
        await sleep(INTER_CHUNK_COOLDOWN_MS);
      }
    }

    // If every single chunk failed, there is nothing real to summarize or
    // quiz on -- surface a clear failure instead of silently returning a
    // "successful" result made entirely of failure-placeholder text (which
    // would otherwise get fed straight into question generation as source
    // material, producing quiz questions about our own error message).
    if (failedChunkCount === chunks.length) {
      throw new AIServiceError();
    }

    const seenFronts = new Set<string>();
    const flashcards = allCards
      .filter((c) => {
        const norm = normalizeQuestionText(c.front || "");
        if (!norm || seenFronts.has(norm)) return false;
        seenFronts.add(norm);
        return true;
      })
      .slice(0, maxFlashcards);

    const chapterBody = chapterParts
      .map((p, i) => (isHe ? `## פרק ${i + 1}\n${p}` : `## Chapter ${i + 1}\n${p}`))
      .join("\n\n");

    // Genuinely-summarized chunks only, joined without the failure-chapter
    // placeholders -- this is what the keyPoints/executiveSummary synthesis
    // below reads, and what generate-all.ts hands to question generation as
    // precomputedContent. chapterBody (above) keeps every chapter, including
    // placeholders, purely for the user-facing displayed summary.
    const cleanContent = successfulParts.join("\n\n");

    // A chunk can technically "succeed" (cards generated) while returning no
    // summary text at all -- that doesn't trip failedChunkCount above, but
    // still leaves nothing real to hand to question generation. Guard on the
    // actual content, not just the failure count, so a content-shaped but
    // empty result can never reach generate-all.ts's precomputedContent.
    if (!cleanContent.trim()) {
      throw new AIServiceError();
    }

    // Only the keyPoints + a short executive wrap-up come from one more,
    // lightweight, bounded-output Gemini call on top of the already-assembled
    // chapter body -- never the full chapter text fed through a second large
    // synthesis call. A failure here degrades to no keyPoints/executiveSummary
    // rather than losing the (already-assembled, much bigger) chapter body.
    let keyPoints: string[] = [];
    let executiveSummary = "";
    try {
      const synthPrompt = isHe
        ? `## סיכום מחולק לפרקים של חומר הלימוד "${materialTitle}":

${contentSlice(cleanContent)}

---
המשימה שלך: קרא את כל הפרקים מעלה וצור:
1. keyPoints — מערך של 5–8 משפטים קצרים, הכי חשובים מכל החומר (מה שהייתה רוצה לדעת לפני הבחינה).
2. executiveSummary — פסקת "סיכום מנהלים" חמה של 3-5 משפטים, כאילו אתה אומר לחבר "זה מה שחשוב שתזכור", המכסה את כל הפרקים.

החזר JSON בלבד במבנה הבא:
{
  "keyPoints": ["נקודה 1", "נקודה 2", "נקודה 3", "נקודה 4", "נקודה 5"],
  "executiveSummary": "פסקת סיכום מנהלים כאן"
}`
        : `## Chapter-by-chapter summary of study material "${materialTitle}":

${contentSlice(cleanContent)}

---
Your task: read every chapter above and produce:
1. keyPoints — an array of 5-8 short sentences, the most important things from the whole material (what you'd want to know before the exam).
2. executiveSummary — a warm 3-5 sentence "executive summary" wrap-up, written like you're telling a friend "here's what actually matters", covering all the chapters.

Return ONLY JSON matching this structure:
{
  "keyPoints": ["point 1", "point 2", "point 3", "point 4", "point 5"],
  "executiveSummary": "Executive summary paragraph here"
}`;

      const result = await callGeminiJsonWithValidation(
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
        "generateSummaryAndFlashcards(keyPoints)",
      );
      keyPoints = result.keyPoints;
      executiveSummary = result.executiveSummary;
    } catch (err) {
      console.error("generateSummaryAndFlashcards: keyPoints/executiveSummary synthesis failed, continuing without it:", err);
    }

    const execHeading = isHe ? "## סיכום מנהלים" : "## Executive Summary";
    const content = executiveSummary ? `${chapterBody}\n\n${execHeading}\n${executiveSummary}` : chapterBody;

    console.log(`generateSummaryAndFlashcards: assembled ${chapterParts.length}-chapter summary (${content.length} chars, ${keyPoints.length} key points) and ${flashcards.length} flashcards for material ${materialId ?? "?"}.`);

    return { summary: { content, keyPoints }, flashcards, cleanContent };
  } finally {
    if (materialId !== undefined) clearGenerationProgress(materialId);
  }
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
  const { parts, chunked } = await buildAggregatedContent(materialContent, materialTitle, isHe, materialId);

  // Large/chunked documents: rather than risk a single Gemini call silently
  // truncating its output once asked to comprehensively cover every chunk,
  // the chapter bodies are assembled deterministically from each chunk's
  // already-validated factual summary (one chapter per chunk, guaranteed to
  // cover the whole document since nothing is re-summarized or re-sliced
  // here). Only the keyPoints + a short executive wrap-up come from a single,
  // lightweight, bounded-output Gemini call on top of that.
  if (chunked) {
    const chapterBody = parts
      .map((p, i) => (isHe ? `## פרק ${i + 1}\n${p}` : `## Chapter ${i + 1}\n${p}`))
      .join("\n\n");

    const synthPrompt = isHe
      ? `## סיכום מחולק לפרקים של חומר הלימוד "${materialTitle}":

${contentSlice(chapterBody)}

---
המשימה שלך: קרא את כל הפרקים מעלה וצור:
1. keyPoints — מערך של 5–8 משפטים קצרים, הכי חשובים מכל החומר (מה שהייתה רוצה לדעת לפני הבחינה).
2. executiveSummary — פסקת "סיכום מנהלים" חמה של 3-5 משפטים, כאילו אתה אומר לחבר "זה מה שחשוב שתזכור", המכסה את כל הפרקים.

החזר JSON בלבד במבנה הבא:
{
  "keyPoints": ["נקודה 1", "נקודה 2", "נקודה 3", "נקודה 4", "נקודה 5"],
  "executiveSummary": "פסקת סיכום מנהלים כאן"
}`
      : `## Chapter-by-chapter summary of study material "${materialTitle}":

${contentSlice(chapterBody)}

---
Your task: read every chapter above and produce:
1. keyPoints — an array of 5-8 short sentences, the most important things from the whole material (what you'd want to know before the exam).
2. executiveSummary — a warm 3-5 sentence "executive summary" wrap-up, written like you're telling a friend "here's what actually matters", covering all the chapters.

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
    return { content, keyPoints };
  }

  const aggregatedContent = parts[0];

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
  return { content, keyPoints };
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

export async function generateQuestionsAI(
  opts: AIGenerationOptions & { questionCount: number; questionTypes: string[]; difficulty: string; excludeQuestions?: string[]; precomputedContent?: string }
): Promise<Array<{ question: string; answer: string; explanation: string; options: string[]; correctIndex: number; questionType: string; difficulty: string; modelAnswer?: string }>> {
  const { language, materialContent, materialTitle, questionCount, questionTypes, difficulty, materialId, excludeQuestions, precomputedContent } = opts;
  const isHe = language === "he";
  try {
  // generate-all.ts passes the already-assembled summary (small) here
  // instead of the raw document, so the question stage doesn't redundantly
  // re-chunk and re-summarize the same material a third time -- see
  // generateSummaryAndFlashcards above. Other callers (the standalone
  // practice-questions and exam routes) don't pass this, so they keep
  // chunking the raw material themselves as before.
  const { content: aggregatedContent } = precomputedContent !== undefined
    ? { content: precomputedContent }
    : await buildAggregatedContent(materialContent, materialTitle, isHe, materialId);
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
- מסיחים (distractors) חייבים להיות אמיתיים ומאתגרים: כל אפשרות שגויה צריכה להיות סבירה לחלוטין, מבוססת על טעות מושגית נפוצה או על בלבול בין מונחים קרובים מהחומר עצמו. אסור מסיחים מגוחכים, לא רלוונטיים, או כאלה שניתן לפסול מבלי לדעת את התוכן (כמו אורך שונה באופן בולט, או ניסוח שמסגיר את עצמו). תלמיד שלא הבין את החומר לעומק צריך להיות מסוגל לטעות.
- דיוק לשוני (חובה): כל מילה בכל אפשרות תשובה — נכונה כמו שגויה — חייבת להיות מילה עברית אמיתית, תקנית ומובנת. אסור בהחלט להשתמש במילים מומצאות, צירופי אותיות חסרי משמעות, או "גיבריש". לפני שמחזירים את ה-JSON, בדקו פנימית שכל מילה בכל אפשרות קיימת בשפה העברית והגיונית בהקשר השאלה. אם אינכם בטוחים שמונח מסוים הוא מילה עברית תקנית ונפוצה — אל תשתמשו בו; העדיפו ניסוח פשוט וברור על פני ניסוח מורכב או נדיר.
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
${excludeBlock}
---
Task: Create exactly ${questionCount} practice questions in English.
Question types: ${questionTypes.join(", ")}
Difficulty: ${difficulty}

Important rules:
- multiple_choice: 4 options in "options". "answer" is the exact text of the correct option. "correctIndex" is the 0-based index (0-3) of the correct option.
- Distractors must be realistic and challenging: every wrong option should be genuinely plausible, based on a common misconception or confusion between closely related terms/concepts from the material itself. No throwaway, irrelevant, or self-revealing distractors (e.g. obviously shorter/longer phrasing, or wording that gives away the answer). A student who only half-understood the material should be able to plausibly pick a wrong one.
- Linguistic accuracy (mandatory): every word in every answer option — correct and incorrect alike — must be a real, grammatically correct, commonly understood word or phrase in the target language. Never use made-up words, gibberish, or nonsensical letter combinations. Before returning the JSON, internally verify that every word in every option is a real word and makes sense in context. If you are unsure whether a term is valid and commonly understood, do not use it — prefer simple, clear phrasing over complex or obscure wording.
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

export async function generateExamAI(
  opts: AIGenerationOptions & { questionCount: number; examType: string; difficulty: string; topics?: string[]; excludeQuestions?: string[] }
): Promise<Array<{ question: string; answer: string; explanation: string; options: string[]; correctIndex: number; questionType: string; difficulty: string; modelAnswer?: string }>> {
  const { language, materialContent, materialTitle, questionCount, examType, difficulty, topics, materialId, excludeQuestions } = opts;
  const isHe = language === "he";
  try {
  const { content: aggregatedContent } = await buildAggregatedContent(materialContent, materialTitle, isHe, materialId);
  const excludeBlock = buildExcludeQuestionsBlock(excludeQuestions ?? [], isHe);

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
${excludeBlock}
---
המשימה: צור מבחן עם בדיוק ${questionCount} שאלות בעברית.
שלב סוגי שאלות: multiple_choice (70%), true_false (15%), open (15%).

כללי JSON:
- multiple_choice: 4 אפשרויות, correctIndex = אינדקס 0-3 של הנכונה.
- מסיחים (distractors) חייבים להיות אמיתיים ומאתגרים: כל אפשרות שגויה צריכה להיות סבירה לחלוטין, מבוססת על טעות מושגית נפוצה או בלבול בין מונחים קרובים מהחומר. אסור מסיחים מגוחכים או כאלה שניתן לפסול בלי לדעת את התוכן. ככל שרמת הקושי גבוהה יותר, כך המסיחים צריכים להיות דקים ומתוחכמים יותר.
- דיוק לשוני (חובה): כל מילה בכל אפשרות תשובה — נכונה כמו שגויה — חייבת להיות מילה עברית אמיתית, תקנית ומובנת. אסור בהחלט להשתמש במילים מומצאות, צירופי אותיות חסרי משמעות, או "גיבריש". לפני שמחזירים את ה-JSON, בדקו פנימית שכל מילה בכל אפשרות קיימת בשפה העברית והגיונית בהקשר השאלה. אם אינכם בטוחים שמונח מסוים הוא מילה עברית תקנית ונפוצה — אל תשתמשו בו; העדיפו ניסוח פשוט וברור על פני ניסוח מורכב או נדיר.
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
${excludeBlock}
---
Task: Create an exam with exactly ${questionCount} questions in English.
Mix question types: multiple_choice (70%), true_false (15%), open (15%).

JSON rules:
- multiple_choice: 4 options, correctIndex = 0-based index of the correct one.
- Distractors must be realistic and challenging: every wrong option should be genuinely plausible, based on a common misconception or confusion between closely related terms/concepts from the material. No throwaway distractors that can be ruled out without knowing the content. The higher the difficulty, the more subtle and sophisticated the distractors should be.
- Linguistic accuracy (mandatory): every word in every answer option — correct and incorrect alike — must be a real, grammatically correct, commonly understood word or phrase in the target language. Never use made-up words, gibberish, or nonsensical letter combinations. Before returning the JSON, internally verify that every word in every option is a real word and makes sense in context. If you are unsure whether a term is valid and commonly understood, do not use it — prefer simple, clear phrasing over complex or obscure wording.
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
      const result: GeneratedQuestion[] = Array.isArray(parsed.questions)
        ? parsed.questions.map((q: any) => ({ ...q, correctIndex: q.correctIndex ?? 0 }))
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
