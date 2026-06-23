export interface GenerationProgress {
  currentChunk: number;
  totalChunks: number;
  stage: "chunking" | "done" | "idle";
}

// In-memory only -- the server runs as a single Render instance, and this
// data is short-lived (cleared right after each generation request
// finishes), so a DB column would be overkill for what's purely a
// "is this still working" signal for the frontend to poll.
const progressByMaterialId = new Map<number, GenerationProgress>();

export function setGenerationProgress(materialId: number, progress: GenerationProgress): void {
  progressByMaterialId.set(materialId, progress);
}

export function getGenerationProgress(materialId: number): GenerationProgress | null {
  return progressByMaterialId.get(materialId) ?? null;
}

export function clearGenerationProgress(materialId: number): void {
  progressByMaterialId.delete(materialId);
}
