const DEFAULT_CHUNK_TOKEN_LIMIT = 2000;

// Word counts are a useless proxy for token budget once Hebrew (or any
// non-Latin script) is involved -- Groq's BPE tokenizer breaks Hebrew text
// into roughly one token per 1-1.5 characters, versus ~4 characters per
// token for plain ASCII. A 600-word Hebrew chunk that looked safe by word
// count was actually blowing past Groq's free-tier 6000 TPM limit. Estimate
// per-character instead, weighted by script, so the limit holds regardless
// of language.
export function estimateTokenCount(text: string): number {
  const nonAsciiCount = (text.match(/[^\x00-\x7F]/g) ?? []).length;
  const asciiCount = text.length - nonAsciiCount;
  return Math.ceil(nonAsciiCount / 1.5 + asciiCount / 4);
}

/**
 * Splits text into segments of at most ~chunkTokenLimit estimated tokens
 * without cutting mid-sentence. Sentences are kept whole; a single sentence
 * longer than the limit is kept intact in its own chunk rather than
 * truncated.
 */
export function splitTextIntoChunks(
  text: string,
  chunkTokenLimit: number = DEFAULT_CHUNK_TOKEN_LIMIT
): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const sentences = normalized.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) ?? [normalized];

  const chunks: string[] = [];
  let currentSentences: string[] = [];
  let currentTokenCount = 0;

  for (const sentence of sentences) {
    const sentenceTokenCount = estimateTokenCount(sentence.trim());

    if (currentTokenCount > 0 && currentTokenCount + sentenceTokenCount > chunkTokenLimit) {
      chunks.push(currentSentences.join(" ").trim());
      currentSentences = [];
      currentTokenCount = 0;
    }

    currentSentences.push(sentence.trim());
    currentTokenCount += sentenceTokenCount;
  }

  if (currentSentences.length > 0) {
    chunks.push(currentSentences.join(" ").trim());
  }

  return chunks;
}
