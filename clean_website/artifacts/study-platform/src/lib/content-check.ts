// Pre-flight content checks run client-side before any upload/recording is
// sent to the backend -- catches empty/near-empty input early so we don't
// burn a beta action + Gemini/Whisper call on a request that was always
// going to produce a useless ("[Extraction failed]" or blank) result.

export const MIN_TEXT_CHARS = 50;

export const NO_CONTENT_MESSAGE_HE =
  "היי, לא נקלט תוכן בהעלאה. אנא בדוק את הקובץ או ההקלטה ונסה שוב 🙏";
export const NO_CONTENT_MESSAGE_EN =
  "Hey, no content was detected in your upload. Please check the file or recording and try again 🙏";

export function noContentMessage(isRTL: boolean): string {
  return isRTL ? NO_CONTENT_MESSAGE_HE : NO_CONTENT_MESSAGE_EN;
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
