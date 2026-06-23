import { YoutubeTranscript } from "youtube-transcript";
import { groq, AUDIO_MODEL } from "./ai";
import { Readable } from "stream";
import FormData from "form-data";
import fetch from "node-fetch";

export type ExtractedContent = {
  text: string;
  duration?: number;
};

export type ProgressCallback = (percentage: number) => void;

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

export async function extractYouTube(url: string, onProgress?: ProgressCallback): Promise<ExtractedContent> {
  const videoId = getYouTubeId(url);
  if (!videoId) throw new Error("Invalid YouTube URL");

  onProgress?.(20);
  const transcript = await YoutubeTranscript.fetchTranscript(videoId);
  if (!transcript || transcript.length === 0) {
    throw new Error("No transcript available for this video");
  }

  const text = transcript.map(t => t.text).join(" ").replace(/\s+/g, " ").trim();
  const duration = transcript.reduce((sum, t) => sum + (t.duration || 0), 0);

  onProgress?.(100);
  return { text, duration: Math.round(duration) };
}

export async function extractPDF(buffer: Buffer): Promise<ExtractedContent> {
  if (!buffer || buffer.length === 0) {
    throw new Error("Received an empty PDF file buffer");
  }
  console.log(`extractPDF: received buffer of ${buffer.length} bytes`);

  // pdf-parse v2 (pdfjs-dist under the hood) requires DOM canvas APIs
  // (DOMMatrix/ImageData/Path2D) that aren't available in our bundled Node
  // server and aren't installed as a native dependency — it was throwing
  // "DOMMatrix is not defined" on every PDF, which the caller's catch block
  // silently turned into placeholder text. `unpdf` wraps a canvas-free
  // pdfjs-dist build made specifically for serverless/edge Node runtimes.
  const { getDocumentProxy, extractText } = await import("unpdf");
  const doc = await getDocumentProxy(new Uint8Array(buffer));
  const { text: rawText, totalPages } = await extractText(doc, { mergePages: true });
  const text = rawText.replace(/\s+/g, " ").trim();

  console.log(`extractPDF: extracted ${text.length} chars from ${totalPages} pages`);
  if (!text) {
    throw new Error("PDF parsed successfully but contained no extractable text (likely a scanned/image-only PDF)");
  }

  return { text };
}

export async function transcribeAudio(
  buffer: Buffer,
  mimeType: string,
  filename: string,
  onProgress?: ProgressCallback
): Promise<ExtractedContent> {
  const form = new FormData();
  form.append("file", buffer, {
    filename,
    contentType: mimeType,
  });
  form.append("model", AUDIO_MODEL);
  form.append("response_format", "verbose_json");
  form.append("language", "he");

  onProgress?.(10);

  // Whisper's response only arrives once transcription is fully done -- there's
  // no native streaming progress -- so we simulate a smooth climb from 10% to
  // 90% while the request is in flight, and snap to 100% once it resolves.
  let simulatedPercentage = 10;
  const ticker = onProgress
    ? setInterval(() => {
        simulatedPercentage = Math.min(simulatedPercentage + 5, 90);
        onProgress(simulatedPercentage);
      }, 1500)
    : undefined;

  let response;
  try {
    response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        ...form.getHeaders(),
      },
      body: form,
    });
  } finally {
    if (ticker) clearInterval(ticker);
  }

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Whisper transcription failed: ${errText}`);
  }

  const result = (await response.json()) as { text: string; duration?: number };
  onProgress?.(100);
  return {
    text: result.text || "",
    duration: result.duration ? Math.round(result.duration) : undefined,
  };
}

// Tags that are essentially never part of the article body — nav bars,
// headers/footers, cookie banners, ads, embeds. Stripped before any other
// processing so they can never end up inside an <article>/<main> match
// either, since some sites nest a sidebar/ad block inside their <main>.
const BOILERPLATE_TAGS = ["script", "style", "noscript", "iframe", "svg", "form", "nav", "header", "footer", "aside", "button"];

export async function extractFromUrl(url: string, onProgress?: ProgressCallback): Promise<ExtractedContent> {
  onProgress?.(20);
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; StudyAI/1.0)" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Failed to fetch URL: ${res.status}`);
  const html = await res.text();
  onProgress?.(60);

  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, "");
  const withoutBoilerplate = BOILERPLATE_TAGS.reduce(
    (acc, tag) => acc.replace(new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi"), ""),
    withoutComments
  );

  // Most articles/blogs wrap their actual body copy in <article> or <main> —
  // preferring that (once boilerplate siblings are already gone) keeps the
  // extracted text to roughly just the content itself, instead of every
  // related-posts list and sidebar widget on the page, which otherwise
  // bloats the chunked-summarization token bill for no benefit.
  const mainMatch = withoutBoilerplate.match(/<(article|main)[^>]*>([\s\S]*?)<\/\1>/i);
  const contentHtml = mainMatch ? mainMatch[2] : withoutBoilerplate;

  const text = contentHtml
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20000);

  if (!text) {
    throw new Error("No readable text content found at this URL");
  }

  onProgress?.(100);
  return { text };
}
