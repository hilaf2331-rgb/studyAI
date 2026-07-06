import { describe, expect, it } from "vitest";
import { computeChunkDurations } from "./audio-chunker";

// Pure arithmetic only -- actual ffmpeg execution (probeDurationSeconds,
// transcodeAndSegment) isn't exercised here since the ffmpeg/ffprobe
// binaries may not be available in every environment this suite runs in;
// this covers exactly the per-chunk duration bookkeeping that decides what
// each transcribeAudio() chunk call reports back as its approxDurationSeconds.
describe("computeChunkDurations", () => {
  it("gives every chunk but the last the full chunkSeconds, and the last one the remainder", () => {
    // 40 minutes total, 15-minute chunks -> 3 chunks of 15/15/10 minutes.
    expect(computeChunkDurations(2400, 900, 3)).toEqual([900, 900, 600]);
  });

  it("handles a total that divides evenly with no remainder", () => {
    expect(computeChunkDurations(1800, 900, 2)).toEqual([900, 900]);
  });

  it("handles a single chunk shorter than chunkSeconds", () => {
    expect(computeChunkDurations(500, 900, 1)).toEqual([500]);
  });

  it("clamps the last chunk to zero instead of going negative", () => {
    // Pathological input (totalSeconds smaller than chunkSeconds * (n-1))
    // should never produce a negative duration.
    expect(computeChunkDurations(100, 900, 3)).toEqual([900, 900, 0]);
  });

  it("returns an empty array for zero chunks", () => {
    expect(computeChunkDurations(1000, 900, 0)).toEqual([]);
  });
});
