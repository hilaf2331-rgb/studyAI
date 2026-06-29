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

// OpenAI's TTS endpoint rejects input over 4096 characters; longer source
// material is truncated here rather than rejected outright, since a partial
// podcast summary is still useful to a student.
const MAX_TTS_INPUT_CHARS = 4096;

export interface GeneratedSpeech {
  buffer: Buffer;
  contentType: string;
  extension: string;
}

export function hashSourceText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export async function generateSpeech(text: string): Promise<GeneratedSpeech> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set -- audio generation is unavailable until it's configured");
  }

  const input = text.trim().slice(0, MAX_TTS_INPUT_CHARS);
  if (!input) {
    throw new Error("Cannot generate audio from empty text");
  }

  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: TTS_MODEL,
      voice: TTS_VOICE,
      input,
      response_format: "mp3",
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Speech generation failed: ${errText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), contentType: "audio/mpeg", extension: "mp3" };
}
