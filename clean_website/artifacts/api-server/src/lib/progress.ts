// Each field is populated the moment its own stage finishes and is persisted
// to the DB -- generate-all.ts now runs summary -> flashcards -> questions as
// three sequential stages instead of one merged blob, writing a cumulative
// result after each one so the frontend can show (e.g.) the summary the
// instant it's ready instead of waiting for flashcards/questions too.
export interface GenerateAllResult {
  summary?: { id: number; keyPointCount: number };
  deck?: { id: number; cardCount: number };
  questionSet?: { id: number; questionCount: number };
  // Populated by the (also background, also-polled) standalone exam
  // generation job -- reuses this same result shape/progress key rather than
  // inventing a parallel tracking mechanism for what's otherwise an
  // identical "long chunked AI job, poll for done" flow.
  exam?: { id: number; questionCount: number };
  partialFailure?: boolean;
}

export interface GenerationProgress {
  currentChunk: number;
  totalChunks: number;
  percentage: number;
  // "running" covers the whole background generate-all job, from the moment
  // the 202 is sent until the background work finishes -- it's set up front
  // so a poll that lands before the first Gemini call still sees something
  // other than "idle". "chunking"/"extracting" remain for the existing
  // per-call chunk tracking nested inside that job. "queued" is set by
  // lib/processing-queue.ts while a request is waiting its turn behind the
  // concurrency limit, before any extraction/generation work has started.
  stage: "queued" | "chunking" | "extracting" | "running" | "done" | "idle" | "error";
  // Populated only while stage is "queued" -- this request's 1-based
  // position behind the concurrency limit, so the frontend can show "X
  // uploads ahead of you" during exam-period traffic spikes instead of a
  // progress bar that looks stalled at 0%.
  queuePosition?: number;
  // Populated incrementally while stage is still "running" -- one stage's
  // worth of fields lands as soon as that stage's DB rows are committed, so
  // a poll mid-job can already see e.g. result.summary while result.deck and
  // result.questionSet are still absent. Fully populated (whichever stages
  // succeeded) once stage is "done".
  result?: GenerateAllResult;
  // Present once stage is "error" -- a user-facing failure message.
  error?: string;
}

// Key is either the numeric material id (post-creation chunked generation)
// or a client-generated uploadId string (in-flight extraction, before the
// material row -- and its id -- exists yet).
type ProgressKey = number | string;

// In-memory only -- the server runs as a single Render instance, and this
// data is short-lived (cleared right after each generation/extraction
// request finishes), so a DB column would be overkill for what's purely a
// "is this still working" signal for the frontend to poll.
const progressByKey = new Map<ProgressKey, GenerationProgress>();

export function setGenerationProgress(key: ProgressKey, progress: GenerationProgress): void {
  progressByKey.set(key, progress);
}

export function getGenerationProgress(key: ProgressKey): GenerationProgress | null {
  return progressByKey.get(key) ?? null;
}

export function clearGenerationProgress(key: ProgressKey): void {
  progressByKey.delete(key);
}
