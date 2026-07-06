// Whisper hard-caps a single upload at 25MB, and the new 3-hour recording
// ceiling (see MAX_RECORDING_SECONDS in lib/validation.ts) would blow way
// past that regardless of how a browser/phone encodes it -- so every long
// recording needs to be trimmed to an affordable length AND cut into
// Whisper-sized pieces before it ever reaches OpenAI. ffmpeg-static /
// ffprobe-static each bundle a static, platform-specific binary (no system
// ffmpeg install required, which matters on Render's minimal runtime image),
// so this shells out to them directly via execFile rather than pulling in
// fluent-ffmpeg's abstraction layer for what's really just two well-defined
// command lines.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";
import ffprobePath from "ffprobe-static";

const execFileAsync = promisify(execFile);

// ffmpeg-static's typings mark the default export nullable for platforms it
// doesn't ship a binary for -- Render always runs linux/x64, which it does
// support, so a null here means something is broken in the deployed image
// rather than a case worth silently degrading around.
function requireFfmpegPath(): string {
  if (!ffmpegPath) {
    throw new Error("ffmpeg binary not available on this platform -- audio chunking/transcoding is unavailable");
  }
  return ffmpegPath;
}

// Best-effort duration probe used both to decide whether a recording needs
// chunking at all, and to size the last chunk's approxDurationSeconds below.
// Mirrors fetchYouTubeDurationSeconds in lib/extractor.ts's convention: a
// duration check that can't run (corrupt upload, exotic codec ffprobe can't
// sniff) must never itself throw and abort the whole pipeline -- it just
// means the caller falls back to treating the file as a single opaque chunk.
export async function probeDurationSeconds(buffer: Buffer, extension: string): Promise<number | null> {
  const dir = await mkdtemp(join(tmpdir(), "studyai-audio-"));
  const inputPath = join(dir, `input${normalizeExtension(extension)}`);
  try {
    await writeFile(inputPath, buffer);
    const { stdout } = await execFileAsync(ffprobePath.path, [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "json",
      inputPath,
    ]);
    const parsed = JSON.parse(stdout) as { format?: { duration?: string } };
    const value = parseFloat(parsed.format?.duration ?? "");
    if (!Number.isFinite(value)) return null;
    return Math.round(value);
  } catch (err) {
    console.warn("probeDurationSeconds: failed to determine duration, skipping length-aware chunking:", err instanceof Error ? err.message : err);
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export interface AudioChunk {
  buffer: Buffer;
  approxDurationSeconds: number;
}

function normalizeExtension(extension: string): string {
  return extension.startsWith(".") ? extension : `.${extension}`;
}

// Pure arithmetic core of transcodeAndSegment's per-chunk duration
// bookkeeping, split out so it can be unit-tested without actually invoking
// ffmpeg: every chunk except the last is exactly chunkSeconds long (that's
// what -segment_time guarantees), and the last one is whatever's left over
// after the others, clamped to zero in case of a rounding edge case (e.g.
// totalSeconds landing exactly on a chunk boundary).
export function computeChunkDurations(totalSeconds: number, chunkSeconds: number, chunkCount: number): number[] {
  if (chunkCount <= 0) return [];
  const durations = new Array(chunkCount).fill(chunkSeconds);
  durations[chunkCount - 1] = Math.max(0, totalSeconds - chunkSeconds * (chunkCount - 1));
  return durations;
}

// Transcodes the input to mono/16kHz/32kbps opus-in-ogg (a tiny, Whisper-
// friendly format that shrinks even a multi-hour lecture well under the
// 25MB-per-chunk ceiling), trims to maxTotalSeconds (if given, so the ffmpeg
// process itself enforces the token-affordability cutoff instead of relying
// on a post-hoc check after the Whisper cost is already spent), and segments
// the result into chunkSeconds-long pieces -- all as ONE ffmpeg invocation so
// a multi-hour file is only decoded/re-encoded once.
export async function transcodeAndSegment(
  buffer: Buffer,
  extension: string,
  opts: { chunkSeconds: number; maxTotalSeconds?: number; totalSeconds?: number },
): Promise<AudioChunk[]> {
  const ffmpeg = requireFfmpegPath();
  const dir = await mkdtemp(join(tmpdir(), "studyai-audio-"));
  const inputPath = join(dir, `input${normalizeExtension(extension)}`);
  const outPattern = join(dir, "chunk_%04d.ogg");

  try {
    await writeFile(inputPath, buffer);

    const args = ["-y", "-i", inputPath];
    if (opts.maxTotalSeconds != null) {
      args.push("-t", String(opts.maxTotalSeconds));
    }
    args.push(
      "-ac", "1",
      "-ar", "16000",
      "-c:a", "libopus",
      "-b:a", "32k",
      "-f", "segment",
      "-segment_time", String(opts.chunkSeconds),
      "-reset_timestamps", "1",
      outPattern,
    );

    try {
      await execFileAsync(ffmpeg, args);
    } catch (err: any) {
      const stderr = err?.stderr ? String(err.stderr) : (err instanceof Error ? err.message : String(err));
      throw new Error(`ffmpeg transcode/segment failed: ${stderr}`);
    }

    const files = (await readdir(dir))
      .filter((f) => f.startsWith("chunk_") && f.endsWith(".ogg"))
      .sort();
    if (files.length === 0) {
      throw new Error("ffmpeg transcode/segment produced zero output chunks");
    }

    const totalSeconds = opts.maxTotalSeconds ?? opts.totalSeconds ?? opts.chunkSeconds * files.length;
    const durations = computeChunkDurations(totalSeconds, opts.chunkSeconds, files.length);

    const chunks: AudioChunk[] = [];
    for (let i = 0; i < files.length; i++) {
      const chunkBuffer = await readFile(join(dir, files[i]));
      chunks.push({ buffer: chunkBuffer, approxDurationSeconds: durations[i] });
    }
    return chunks;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
