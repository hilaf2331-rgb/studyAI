import { YoutubeTranscript } from "youtube-transcript";
import { groq, AUDIO_MODEL } from "./ai";
import { Readable } from "stream";
import FormData from "form-data";
import fetch from "node-fetch";

export type ExtractedContent = {
  text: string;
  duration?: number;
};

function getYouTubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&?/\s]{11})/,
    /youtube\.com\/shorts\/([^&?/\s]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

export async function extractYouTube(url: string): Promise<ExtractedContent> {
  const videoId = getYouTubeId(url);
  if (!videoId) throw new Error("Invalid YouTube URL");

  const transcript = await YoutubeTranscript.fetchTranscript(videoId);
  if (!transcript || transcript.length === 0) {
    throw new Error("No transcript available for this video");
  }

  const text = transcript.map(t => t.text).join(" ").replace(/\s+/g, " ").trim();
  const duration = transcript.reduce((sum, t) => sum + (t.duration || 0), 0);

  return { text, duration: Math.round(duration) };
}

export async function extractPDF(buffer: Buffer): Promise<ExtractedContent> {
  const pdfParse = (await import("pdf-parse")).default;
  const data = await pdfParse(buffer);
  const text = data.text.replace(/\s+/g, " ").trim();
  return { text };
}

export async function transcribeAudio(
  buffer: Buffer,
  mimeType: string,
  filename: string
): Promise<ExtractedContent> {
  const form = new FormData();
  form.append("file", buffer, {
    filename,
    contentType: mimeType,
  });
  form.append("model", AUDIO_MODEL);
  form.append("response_format", "verbose_json");
  form.append("language", "he");

  const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      ...form.getHeaders(),
    },
    body: form,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Whisper transcription failed: ${errText}`);
  }

  const result = (await response.json()) as { text: string; duration?: number };
  return {
    text: result.text || "",
    duration: result.duration ? Math.round(result.duration) : undefined,
  };
}

export async function extractFromUrl(url: string): Promise<ExtractedContent> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; StudyAI/1.0)" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Failed to fetch URL: ${res.status}`);
  const html = await res.text();
  const text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20000);
  return { text };
}
