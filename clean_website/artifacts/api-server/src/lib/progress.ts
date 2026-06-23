export interface GenerationProgress {
  currentChunk: number;
  totalChunks: number;
  percentage: number;
  stage: "chunking" | "extracting" | "done" | "idle" | "error";
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
