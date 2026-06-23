export interface GenerateAllResult {
  summary: { id: number; keyPointCount: number };
  deck: { id: number; cardCount: number };
  questionSet: { id: number; questionCount: number };
  partialFailure: boolean;
}

export interface GenerationProgress {
  currentChunk: number;
  totalChunks: number;
  percentage: number;
  // "running" covers the whole background generate-all job, from the moment
  // the 202 is sent until the background work finishes -- it's set up front
  // so a poll that lands before the first Gemini call still sees something
  // other than "idle". "chunking"/"extracting" remain for the existing
  // per-call chunk tracking nested inside that job.
  stage: "chunking" | "extracting" | "running" | "done" | "idle" | "error";
  // Present once stage is "done".
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
