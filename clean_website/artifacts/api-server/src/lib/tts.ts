// Text-to-speech generation for the Course Media / audio-podcast feature.
// Reuses the same OPENAI_API_KEY already configured for Whisper
// transcription (extractor.ts) and mirrors its fetch/key-handling
// conventions. OpenAI's TTS endpoint natively outputs MP3, which already
// satisfies the "compress before upload" requirement without needing a
// separate ffmpeg transcoding step.
import fetch from "node-fetch";
import { createHash } from "crypto";

const TTS_MODEL = "tts-1";
const TTS_VOICE = "alloy";

// OpenAI's TTS endpoint rejects input over 4096 characters per request.
// Previously, longer source material was silently truncated here -- a
// student converting a long material would get a podcast that just stops
// partway through with no indication anything was cut. Instead, text over
// the cap is now split into multiple TTS calls (see splitTextForTts below)
// and the resulting MP3 buffers are concatenated into one continuous file,
// so the full source material is always covered.
export const MAX_TTS_INPUT_CHARS = 4096;

export interface GeneratedSpeech {
  buffer: Buffer;
  contentType: string;
  extension: string;
}

export function hashSourceText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

// Breaks text into chunks that each fit under MAX_TTS_INPUT_CHARS, preferring
// sentence boundaries (so a chunk never cuts off mid-sentence) and falling
// back to a hard slice only for the rare single "sentence" that's itself
// longer than the cap (e.g. text with no punctuation at all).
export function splitTextForTts(text: string, maxChars: number = MAX_TTS_INPUT_CHARS): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxChars) return [trimmed];

  const sentences = trimmed.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      for (let i = 0; i < sentence.length; i += maxChars) {
        chunks.push(sentence.slice(i, i + maxChars));
      }
      continue;
    }
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length > maxChars) {
      chunks.push(current);
      current = sentence;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export async function generateSpeech(text: string): Promise<GeneratedSpeech> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set -- audio generation is unavailable until it's configured");
  }

  const chunks = splitTextForTts(text);
  if (chunks.length === 0) {
    throw new Error("Cannot generate audio from empty text");
  }

  const buffers: Buffer[] = [];
  for (const chunk of chunks) {
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: TTS_MODEL,
        voice: TTS_VOICE,
        input: chunk,
        response_format: "mp3",
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Speech generation failed: ${errText}`);
    }

    buffers.push(Buffer.from(await response.arrayBuffer()));
  }

  return { buffer: Buffer.concat(buffers), contentType: "audio/mpeg", extension: "mp3" };
}
