// Pre-flight content checks run client-side before any upload/recording is
// sent to the backend -- catches empty/near-empty input early so we don't
// burn a beta action + Gemini/Whisper call on a request that was always
// going to produce a useless ("[Extraction failed]" or blank) result.

export const MIN_TEXT_CHARS = 50;

export const NO_CONTENT_MESSAGE_HE =
  "היי, לא נקלט תוכן בהעלאה. אנא בדוק את הקובץ או ההקלטה ונסה שוב 🙏";
export const NO_CONTENT_MESSAGE_EN =
  "Hey, no content was detected in your upload. Please check the file or recording and try again 🙏";

// Distinct from NO_CONTENT_MESSAGE_HE -- this one is specifically for a
// recording that *exists* but is too quiet/silent to transcribe, so the
// copy points the user at their mic/volume rather than at the file itself.
export const SILENT_AUDIO_MESSAGE_HE =
  "היי... ההקלטה שקטה או בקול חלש מדי לעיבוד. אנא נסו שוב 🎙️✨";
export const SILENT_AUDIO_MESSAGE_EN =
  "Hey... the recording is silent or too quiet to process. Please try again 🎙️✨";

export function noContentMessage(isRTL: boolean): string {
  return isRTL ? NO_CONTENT_MESSAGE_HE : NO_CONTENT_MESSAGE_EN;
}

export function silentAudioMessage(isRTL: boolean): string {
  return isRTL ? SILENT_AUDIO_MESSAGE_HE : SILENT_AUDIO_MESSAGE_EN;
}

// Decodes the audio and checks its RMS amplitude against a near-silence
// threshold. Best-effort: an undecodable blob (corrupt/unsupported codec)
// resolves to "not silent" so an inconclusive check never blocks a
// legitimate upload.
export async function isAudioSilent(blob: Blob): Promise<boolean> {
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtx) return false;
  let ctx: AudioContext | null = null;
  try {
    ctx = new AudioCtx();
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    let sumSquares = 0;
    let sampleCount = 0;
    for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
      const data = audioBuffer.getChannelData(ch);
      for (let i = 0; i < data.length; i++) sumSquares += data[i] * data[i];
      sampleCount += data.length;
    }
    if (sampleCount === 0) return true;
    const rms = Math.sqrt(sumSquares / sampleCount);
    return rms < 0.001;
  } catch {
    return false;
  } finally {
    ctx?.close();
  }
}

// Single hard-block gate for the recorder's save flow (manual save +
// 20-minute auto-stop save both route through this, instead of duplicating
// the size/duration/silence checks). There is no fallback to the title or
// any other metadata here -- a recording either has real, audible content
// or performSave (and therefore the API call) never fires.
export async function validateRecording(
  blob: Blob | null,
  durationSeconds: number,
): Promise<{ ok: true } | { ok: false; reason: "empty" | "silent" }> {
  if (!blob || blob.size === 0 || durationSeconds < 1) return { ok: false, reason: "empty" };
  if (await isAudioSilent(blob)) return { ok: false, reason: "silent" };
  return { ok: true };
}
