import { YoutubeTranscript } from "youtube-transcript";
import {
  AUDIO_MODEL,
  extractTextFromImage,
  generateContentFromYouTubeVideo,
  generateContentFromVideoMetadata,
  RateLimitExhaustedError,
  SystemBlockedError,
} from "./ai";
import { Readable } from "stream";
import FormData from "form-data";
import fetch from "node-fetch";
import { sanitizeExtractedText } from "./sanitize";
import { probeDurationSeconds, transcodeAndSegment } from "./audio-chunker";

export type ExtractedContent = {
  text: string;
  duration?: number;
  // Set true when the recording was longer than the caller's
  // maxDurationSeconds (e.g. the user's token balance couldn't cover the
  // whole thing) and was cut short by transcodeAndSegment's ffmpeg `-t`
  // flag before ever reaching Whisper -- lets callers surface "we only
  // processed the first N minutes" to the user instead of silently
  // returning a shorter transcript than they might expect.
  truncated?: boolean;
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

// Mobile share sheets hand out youtu.be links with a `?si=...` tracking
// param attached (and users paste embed/shorts URLs too) -- once the 11-char
// ID is reliably extracted above, every downstream call (oEmbed existence
// check, Gemini's native video fetch) uses this canonical watch URL instead
// of whatever shape the user actually pasted, so neither has to guess how to
// handle a tracking param or short-link format it wasn't built to expect.
function canonicalYouTubeUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

// Thrown only as an absolute last resort in extractYouTube below, once
// transcript fetch, Gemini's native video analysis, AND a fresh oEmbed call
// have all independently failed -- a single oEmbed 404/401 alone is not
// trustworthy proof a video is gone, since YouTube's oEmbed endpoint
// routinely 401/404s requests from hosted IPs (Render, etc.) even for
// perfectly valid public videos, the same IP-based blocking that affects
// transcript scraping. Only when nothing at all has worked is it worth
// surfacing this specific message instead of a generic extraction failure.
export class YouTubeVideoNotFoundError extends Error {
  readonly code = "VIDEO_NOT_FOUND";
  constructor() {
    super("This YouTube video does not exist or is private. Please check the link and try again.");
    this.name = "YouTubeVideoNotFoundError";
  }
}

// Fetches a video's public title/channel via YouTube's oEmbed endpoint --
// no API key required, works for any public video.
async function fetchYouTubeOEmbed(url: string): Promise<{ title: string; author?: string }> {
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
  const res = await fetch(oembedUrl);
  if (res.status === 404 || res.status === 401) {
    throw new YouTubeVideoNotFoundError();
  }
  if (!res.ok) throw new Error(`YouTube oEmbed lookup failed: ${res.status}`);
  const data = (await res.json()) as { title?: string; author_name?: string };
  if (!data.title) throw new Error("YouTube oEmbed response had no title");
  return { title: data.title, author: data.author_name };
}

// During beta, a 40-minute lecture reliably blows past Render's free-tier
// request timeout mid-extraction and then burns through the Gemini rate
// limit on retry -- there's no hosting-tier fix for that without upgrading,
// so the video length itself is capped instead.
const MAX_YOUTUBE_DURATION_SECONDS = 25 * 60;

export class YouTubeTooLongError extends Error {
  readonly code = "VIDEO_TOO_LONG";
  constructor(language: "he" | "en") {
    super(
      language === "he"
        ? "סרטון ארוך מדי! בשלב הבטא אנו תומכים בסרטונים של עד 25 דקות בלבד."
        : "Video too long! During the beta we only support videos up to 25 minutes."
    );
    this.name = "YouTubeTooLongError";
  }
}

// oEmbed doesn't expose duration, and adding the YouTube Data API would mean
// a new API key/credential just for this -- the watch page's own
// ytInitialPlayerResponse blob (loaded into every page, no API key needed)
// already carries it as videoDetails.lengthSeconds, the same kind of public
// page-scrape youtube-transcript itself relies on for captions. Best-effort
// only: any fetch/parse failure returns null rather than throwing, since a
// duration check that can't run is not proof a video is too long.
async function fetchYouTubeDurationSeconds(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; StudyAI/1.0)" } });
    if (!res.ok) return null;
    const html = await res.text();
    const match = html.match(/"lengthSeconds":"(\d+)"/);
    return match ? Number(match[1]) : null;
  } catch (error) {
    console.warn("fetchYouTubeDurationSeconds: failed to determine duration, skipping length check:", error instanceof Error ? error.message : error);
    return null;
  }
}

// YouTube routinely blocks transcript-scraping requests coming from hosted
// server IPs (Render, etc.) with YoutubeTranscriptDisabledError -- even on
// videos that do have captions available to a normal browser -- so a thrown
// error here is never allowed to abort the whole pipeline. Each stage below
// is strictly more degraded than the last: real transcript -> Gemini
// watching the video directly -> Gemini reasoning from just the title.
// Only a genuine rate-limit/system cooldown, or every single stage having
// failed (the last-resort check at the very end), propagates past this
// function.
export async function extractYouTube(
  url: string,
  onProgress?: ProgressCallback,
  language: "he" | "en" = "he"
): Promise<ExtractedContent> {
  const videoId = getYouTubeId(url);
  if (!videoId) throw new Error("Invalid YouTube URL");
  const canonicalUrl = canonicalYouTubeUrl(videoId);

  // Reject oversized videos before doing any real work -- there's no point
  // starting a transcript fetch or a multi-minute Gemini video-watch call
  // only to time out on Render's free tier partway through. Best-effort: if
  // the duration can't be determined, this silently allows the video
  // through rather than blocking it on an inconclusive check.
  const durationSeconds = await fetchYouTubeDurationSeconds(canonicalUrl);
  if (durationSeconds !== null && durationSeconds > MAX_YOUTUBE_DURATION_SECONDS) {
    throw new YouTubeTooLongError(language);
  }

  onProgress?.(10);

  // Best-effort metadata fetch -- NOT an existence gate. A single oEmbed
  // 404/401 this early is indistinguishable from Render's IP being
  // bot-blocked, so any failure here (including YouTubeVideoNotFoundError)
  // is only logged; extraction always proceeds to the real fallback chain
  // below regardless of what this call returns.
  let metadata: { title: string; author?: string } | undefined;
  try {
    metadata = await fetchYouTubeOEmbed(canonicalUrl);
  } catch (error) {
    console.warn(
      `extractYouTube: oEmbed metadata fetch failed for ${videoId}, proceeding without it:`,
      error instanceof Error ? error.message : error,
    );
  }

  onProgress?.(20);

  try {
    const transcript = await YoutubeTranscript.fetchTranscript(videoId);
    if (transcript && transcript.length > 0) {
      const text = sanitizeExtractedText(transcript.map(t => t.text).join(" "));
      const duration = transcript.reduce((sum, t) => sum + (t.duration || 0), 0);
      onProgress?.(100);
      return { text, duration: Math.round(duration) };
    }
    console.warn(`extractYouTube: transcript for ${videoId} came back empty, falling back to Gemini video analysis.`);
  } catch (error) {
    console.warn(
      `extractYouTube: transcript fetch failed for ${videoId}, falling back to Gemini video analysis:`,
      error instanceof Error ? error.message : error,
    );
  }

  onProgress?.(50);

  try {
    const text = await generateContentFromYouTubeVideo(canonicalUrl, language);
    if (text && text.trim()) {
      onProgress?.(100);
      return { text: sanitizeExtractedText(text) };
    }
  } catch (error) {
    if (error instanceof RateLimitExhaustedError || error instanceof SystemBlockedError) throw error;
    console.warn(
      `extractYouTube: Gemini native video analysis failed for ${canonicalUrl}, falling back to metadata-only summary:`,
      error instanceof Error ? error.message : error,
    );
  }

  onProgress?.(75);

  // Every real extraction path (transcript, Gemini watching the video) has
  // now failed. metadata was already fetched during the best-effort step
  // above, unless that call itself failed -- in which case this is the
  // genuine last resort: if oEmbed STILL confirms 404/401 here, after
  // everything else has also come up empty, that's a much stronger signal
  // than a single early request, so YouTubeVideoNotFoundError is allowed to
  // propagate from this one spot only.
  const finalMetadata = metadata ?? (await fetchYouTubeOEmbed(canonicalUrl));
  const text = await generateContentFromVideoMetadata(finalMetadata, canonicalUrl, language);

  onProgress?.(100);
  return { text: sanitizeExtractedText(text) };
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
  const text = sanitizeExtractedText(rawText);

  console.log(`extractPDF: extracted ${text.length} chars from ${totalPages} pages`);
  if (!text) {
    throw new Error("PDF parsed successfully but contained no extractable text (likely a scanned/image-only PDF)");
  }

  return { text };
}

// Max pixel dimension sent to Gemini. Gemini bills inline images by 768×768
// tiles — a full-res 4K image costs ~16 tiles (4128 tokens) vs ~2 tiles (516
// tokens) for a 1024px image. For text-heavy study material, 1024px is more
// than enough for accurate OCR.
const IMAGE_MAX_PX = 1024;

async function resizeForAI(buffer: Buffer, mimeType: string): Promise<{ buffer: Buffer; mimeType: string }> {
  try {
    const { default: sharp } = await import("sharp");
    const meta = await sharp(buffer).metadata();
    const { width = 0, height = 0 } = meta;
    if (width <= IMAGE_MAX_PX && height <= IMAGE_MAX_PX) {
      return { buffer, mimeType };
    }
    const resized = await sharp(buffer)
      .resize({ width: IMAGE_MAX_PX, height: IMAGE_MAX_PX, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    return { buffer: resized, mimeType: "image/jpeg" };
  } catch {
    return { buffer, mimeType };
  }
}

// Routes a photo (e.g. a phone snapshot of handwritten or printed notes) to
// Gemini 1.5 Flash's native vision support for transcription, so a future
// camera/gallery upload button on the frontend can plug straight into the
// existing extraction pipeline without any backend changes.
export async function extractImage(buffer: Buffer, mimeType: string, onProgress?: ProgressCallback): Promise<ExtractedContent> {
  if (!buffer || buffer.length === 0) {
    throw new Error("Received an empty image file buffer");
  }

  onProgress?.(20);
  const resized = await resizeForAI(buffer, mimeType);
  onProgress?.(35);
  const rawText = await extractTextFromImage(resized.buffer, resized.mimeType);
  const text = sanitizeExtractedText(rawText);

  if (!text) {
    throw new Error("Image processed successfully but contained no extractable text");
  }

  onProgress?.(100);
  return { text };
}

const OFFICE_FILE_TYPES = ["docx", "pptx", "xlsx"] as const;
type OfficeFileType = (typeof OFFICE_FILE_TYPES)[number];

// officeparser reads the OOXML zip structure with pure JS (no native deps,
// no macro execution) and never touches embedded VBA/scripts -- it only
// walks the document/slide/sheet XML for text nodes.
export async function extractOffice(buffer: Buffer, fileType: OfficeFileType, onProgress?: ProgressCallback): Promise<ExtractedContent> {
  if (!buffer || buffer.length === 0) {
    throw new Error(`Received an empty ${fileType.toUpperCase()} file buffer`);
  }

  onProgress?.(20);
  const { OfficeParser } = await import("officeparser");
  const ast = await OfficeParser.parseOffice(buffer, { fileType, ocr: false });
  onProgress?.(70);
  const { value: rawText } = await ast.to("text");
  const text = sanitizeExtractedText(rawText);

  if (!text) {
    throw new Error(`${fileType.toUpperCase()} parsed successfully but contained no extractable text`);
  }

  onProgress?.(100);
  return { text };
}

// Single Whisper HTTP call over one already-Whisper-sized buffer -- extracted
// out of transcribeAudio below so the chunking branch there can call this
// once per ~15-minute segment instead of duplicating the FormData/fetch/
// response-parsing logic. No duration check here anymore: truncation now
// happens BEFORE this ever runs (transcodeAndSegment's ffmpeg `-t` flag), so
// there's nothing left to reject after the fact for a duration reason.
async function transcribeSingleChunk(
  buffer: Buffer,
  mimeType: string,
  filename: string,
  onProgress: ProgressCallback | undefined,
  glossaryHint: string | undefined,
): Promise<{ text: string; duration?: number }> {
  // Fail fast with a clear message if the key is unset, rather than letting
  // the request go out with an "Authorization: Bearer undefined" header and
  // surfacing as an opaque 401 from OpenAI deep inside the fetch call below.
  // Never hardcode the key here -- it must only ever come from this env var.
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set -- audio transcription is unavailable until it's configured");
  }

  const form = new FormData();
  form.append("file", buffer, {
    filename,
    contentType: mimeType,
  });
  form.append("model", AUDIO_MODEL);
  form.append("response_format", "verbose_json");
  form.append("language", "he");
  // Whisper's "prompt" field doesn't instruct the model -- it only biases
  // word-recognition/spelling toward vocabulary that appears in it (per
  // OpenAI's docs), so feeding it the course's own glossary terms here makes
  // Whisper itself more likely to correctly hear/spell course-specific
  // acronyms and jargon, instead of only correcting them after the fact in
  // the Gemini summary stage. Capped well under Whisper's ~224-token prompt
  // limit so a huge glossary can't silently get truncated mid-term.
  if (glossaryHint) {
    form.append("prompt", glossaryHint.slice(0, 800));
  }

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
    response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
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
  const duration = result.duration ? Math.round(result.duration) : undefined;
  return {
    text: sanitizeExtractedText(result.text || ""),
    duration,
  };
}

// Chunk size for the segmented-transcription path below. 15 minutes keeps
// each chunk's ogg/opus output comfortably under Whisper's 25MB cap (mono/
// 16kHz/32kbps opus runs well under 1MB/minute) with plenty of headroom for
// unusually dense audio, while still keeping the number of sequential
// Whisper calls for a full 3-hour recording (the new MAX_RECORDING_SECONDS
// ceiling) to a manageable dozen or so.
export const AUDIO_CHUNK_SECONDS = 15 * 60;

// Derives a filename extension ffmpeg/ffprobe can use to sniff the input
// container from the browser/upload-supplied MIME type -- best-effort, since
// an unrecognized MIME still falls back to a sane default rather than
// blocking the probe/transcode step outright. Exported so routes/materials.ts
// can reuse it for its own pre-transcription probeDurationSeconds() call.
export function extensionFromMimeType(mimeType: string): string {
  const base = mimeType.split(";")[0].trim().toLowerCase();
  const map: Record<string, string> = {
    "audio/webm": ".webm",
    "video/webm": ".webm",
    "audio/mp4": ".mp4",
    "video/mp4": ".mp4",
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/ogg": ".ogg",
    "audio/m4a": ".m4a",
    "audio/x-m4a": ".m4a",
  };
  return map[base] ?? ".webm";
}

// Transcribes a recording of essentially any length by trimming/segmenting it
// with ffmpeg BEFORE it ever reaches Whisper, instead of the old approach of
// calling Whisper over the whole buffer and only checking the duration
// afterward (which spent the OpenAI cost on audio that was going to be
// rejected anyway). options.maxDurationSeconds is the token-affordability
// cutoff negotiated with the user up front (see lib/tokens.ts's
// getAudioAffordability) -- when the probed duration exceeds it, ffmpeg's
// `-t` flag trims the file to exactly that many seconds before any
// transcription call is made, so nothing is ever billed or rejected after
// the fact for this reason anymore.
export async function transcribeAudio(
  buffer: Buffer,
  mimeType: string,
  filename: string,
  onProgress?: ProgressCallback,
  options?: { maxDurationSeconds?: number; glossaryHint?: string; onChunkProgress?: (current: number, total: number) => void }
): Promise<ExtractedContent> {
  const extension = extensionFromMimeType(mimeType);
  const probedSeconds = await probeDurationSeconds(buffer, extension);

  // Duration couldn't be determined at all (exotic codec, corrupt upload) --
  // fall back to the pre-chunking behavior of just handing the whole buffer
  // to Whisper directly, exactly as before this feature existed. There is no
  // safe way to enforce maxDurationSeconds without a known duration to trim
  // against.
  if (probedSeconds == null) {
    return transcribeSingleChunk(buffer, mimeType, filename, onProgress, options?.glossaryHint);
  }

  const effectiveSeconds = options?.maxDurationSeconds != null
    ? Math.min(probedSeconds, options.maxDurationSeconds)
    : probedSeconds;
  const needsTrimming = options?.maxDurationSeconds != null && probedSeconds > options.maxDurationSeconds;

  // Cheapest path: short recording that doesn't need trimming -- skip the
  // transcode entirely and hand the original buffer straight to Whisper,
  // exactly like before chunking existed. This keeps the common case (a
  // normal-length lecture) exactly as fast/cheap as it always was.
  if (effectiveSeconds <= AUDIO_CHUNK_SECONDS && !needsTrimming) {
    const result = await transcribeSingleChunk(buffer, mimeType, filename, onProgress, options?.glossaryHint);
    return { ...result, truncated: false };
  }

  const chunks = await transcodeAndSegment(buffer, extension, {
    chunkSeconds: AUDIO_CHUNK_SECONDS,
    maxTotalSeconds: effectiveSeconds,
  });

  // Sequential, not parallel -- keeps OpenAI rate-limit exposure identical to
  // today's one-call-at-a-time model instead of firing a dozen Whisper
  // requests at once for a long recording.
  const texts: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunkResult = await transcribeSingleChunk(
      chunks[i].buffer,
      "audio/ogg",
      `chunk_${i}.ogg`,
      undefined,
      options?.glossaryHint,
    );
    texts.push(chunkResult.text.trim());
    options?.onChunkProgress?.(i + 1, chunks.length);
    onProgress?.(Math.round(((i + 1) / chunks.length) * 100));
  }

  return {
    text: sanitizeExtractedText(texts.join(" ")),
    duration: Math.round(effectiveSeconds),
    truncated: needsTrimming,
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

  // Strip tags first, then sanitize the decoded entities (&lt;script&gt; etc.
  // unescape to literal "<script>" text below) so anything that round-trips
  // back into tag-shaped text is stripped again rather than stored verbatim.
  const text = sanitizeExtractedText(
    contentHtml
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
  ).slice(0, 20000);

  if (!text) {
    throw new Error("No readable text content found at this URL");
  }

  onProgress?.(100);
  return { text };
}
