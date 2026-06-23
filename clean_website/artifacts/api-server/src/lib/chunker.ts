const DEFAULT_CHUNK_WORD_LIMIT = 4000;

/**
 * Splits text into ~chunkWordLimit-word segments without cutting mid-sentence.
 * Sentences are kept whole; a single sentence longer than the limit is kept
 * intact in its own chunk rather than truncated.
 */
export function splitTextIntoChunks(
  text: string,
  chunkWordLimit: number = DEFAULT_CHUNK_WORD_LIMIT
): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const sentences = normalized.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) ?? [normalized];

  const chunks: string[] = [];
  let currentSentences: string[] = [];
  let currentWordCount = 0;

  for (const sentence of sentences) {
    const sentenceWordCount = sentence.trim().split(/\s+/).filter(Boolean).length;

    if (currentWordCount > 0 && currentWordCount + sentenceWordCount > chunkWordLimit) {
      chunks.push(currentSentences.join(" ").trim());
      currentSentences = [];
      currentWordCount = 0;
    }

    currentSentences.push(sentence.trim());
    currentWordCount += sentenceWordCount;
  }

  if (currentSentences.length > 0) {
    chunks.push(currentSentences.join(" ").trim());
  }

  return chunks;
}
