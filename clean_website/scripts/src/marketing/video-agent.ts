import { readFileSync, writeFileSync, existsSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { v1beta1 as textToSpeechV1beta1, protos as textToSpeechProtos } from "@google-cloud/text-to-speech";
import { uploadMarketingVideo } from "./gcs";

// Repo layout: clean_website/scripts/src/marketing/video-agent.ts -> repo
// root is four levels up.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

// Loads secrets (GCS_CREDENTIALS_JSON, etc.) from clean_website/.env when
// present, so running this script locally doesn't require exporting every
// var by hand each time. Never overrides a var already set in the shell/CI
// environment.
const ENV_PATH = join(REPO_ROOT, "clean_website/.env");
if (existsSync(ENV_PATH)) process.loadEnvFile(ENV_PATH);

const BACKLOG_PATH = join(REPO_ROOT, "marketing/ideas/backlog.json");
const QUEUE_PATH = join(REPO_ROOT, "marketing/video/queue.json");
const VIDEO_RENDERER_ENTRY = join(REPO_ROOT, "clean_website/artifacts/video-renderer/src/index.ts");
// Real footage the user drops in herself (e.g. clips made in Google Flow) --
// see marketing/assets/broll/README.md. Entirely optional: renders fall
// back to the plain animated background when this is empty or missing.
const BROLL_DIR = join(REPO_ROOT, "marketing/assets/broll");
const BROLL_EXTENSIONS = /\.(mp4|mov|webm|mkv)$/i;

const TIMEPOINT_TYPE = textToSpeechProtos.google.cloud.texttospeech.v1beta1.SynthesizeSpeechRequest.TimepointType;

// Caps how many videos one run renders (TTS + a full Remotion render each),
// so a single invocation can't run forever locally or burn through Google
// Cloud TTS's free tier in one go.
const MAX_RENDERS_PER_RUN = 3;
// Roughly how many characters a caption line holds on screen before
// wrapping to the next one -- kept short so a vertical-video line never
// crowds the frame.
const CAPTION_CHUNK_MAX_CHARS = 42;

// Keep in sync with visualMotifSchema in
// clean_website/artifacts/video-renderer/src/compositions/MarketingReel.tsx.
const VISUAL_MOTIFS = ["chat", "recording", "flashcards", "summary", "exam", "podcast", "generic"] as const;
type VisualMotif = (typeof VISUAL_MOTIFS)[number];

// Keep in sync with colorThemeSchema in MarketingReel.tsx.
const COLOR_THEMES = ["violet", "sunrise", "ocean", "forest", "berry"] as const;
type ColorTheme = (typeof COLOR_THEMES)[number];

// Words Google mispronounces from plain Hebrew script (which has no
// niqqud/vowel marks, so any TTS engine is just guessing) -- keyed by the
// exact spelling as written in voiceover_text, valued as the IPA reading
// that was actually confirmed correct by ear. This list only ever grows
// reactively: write voiceover_text normally, listen to a render, and if a
// specific word comes out wrong, add ONE entry here for it. There is no way
// to pre-guess which slang will need this, so don't try.
const PRONUNCIATION_FIXES: Record<string, string> = {
  // "AHYOS" with a light/almost-silent opening ה, sh at the end -- default
  // Hebrew reading (with a tzere) came out as "האיוש" instead. Confirmed
  // correct via Google's standard SSML <phoneme> tag (unlike ElevenLabs'
  // v3 inline syntax, this doesn't stutter/repeat the word).
  "היוש": "ahˈjoʃ",
};

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Wraps a word token in an SSML <phoneme> tag if its core Hebrew spelling
// matches a known PRONUNCIATION_FIXES entry, leaving any attached
// punctuation (e.g. the trailing "?" in "עליהן?") outside the tag so Google
// still reads it as sentence punctuation rather than part of the word.
function applyPronunciationFix(token: string): string {
  for (const [word, ipa] of Object.entries(PRONUNCIATION_FIXES)) {
    const pattern = new RegExp(`(?<![\\u0590-\\u05FF])${word}(?![\\u0590-\\u05FF])`);
    if (pattern.test(token)) {
      return token.replace(pattern, `<phoneme alphabet="ipa" ph="${ipa}">${word}</phoneme>`);
    }
  }
  return escapeXml(token);
}

// Deterministically picks a background palette from the idea's own id, so
// different ideas naturally render with different-feeling backgrounds
// instead of every video sharing the exact same colors -- without needing
// anyone (a person or the idea-writing routine) to hand-assign one.
function pickColorTheme(ideaId: string): ColorTheme {
  let hash = 0;
  for (let i = 0; i < ideaId.length; i++) hash = (hash * 31 + ideaId.charCodeAt(i)) >>> 0;
  return COLOR_THEMES[hash % COLOR_THEMES.length];
}

// Picks a random real clip from marketing/assets/broll/ if the user has
// saved any there -- undefined (no broll layer) if the folder is missing or
// empty, which is the expected state until she starts filling it.
function pickBrollClip(): string | undefined {
  if (!existsSync(BROLL_DIR)) return undefined;
  const files = readdirSync(BROLL_DIR).filter((f) => BROLL_EXTENSIONS.test(f));
  if (files.length === 0) return undefined;
  return files[Math.floor(Math.random() * files.length)];
}

interface BacklogIdea {
  id: string;
  title: string;
  channel_hint: string;
  // The exact words to narrate -- written separately from
  // script_or_caption_draft (the full beat-by-beat production script, which
  // also contains on-screen-text/editing directions that must NOT be read
  // aloud).
  voiceover_text?: string;
  // Which floating icon/bubble the reel shows -- see VISUAL_MOTIFS above.
  // Falls back to "generic" if absent or unrecognized.
  visual_motif?: string;
  status: string;
  [key: string]: unknown;
}

interface Backlog {
  schema: Record<string, string>;
  ideas: BacklogIdea[];
}

type QueueStatus = "ready_for_review" | "published" | "failed";

interface QueueVideo {
  idea_id: string;
  status: QueueStatus;
  narration_provider?: string;
  rendered_at?: string;
  updated_at?: string;
  storage_path?: string;
  video_url?: string;
  error?: string;
}

interface Queue {
  schema: Record<string, string>;
  videos: QueueVideo[];
}

interface Word {
  text: string;
  startSeconds: number;
  endSeconds: number;
}

interface Caption {
  text: string;
  startSeconds: number;
  endSeconds: number;
  words: Word[];
}

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function saveJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function getTtsClient(): textToSpeechV1beta1.TextToSpeechClient {
  // Same service-account credentials as gcs.ts -- one fewer thing to set up,
  // as long as the "Cloud Text-to-Speech API" is enabled for that project
  // (Cloud Console -> APIs & Services -> Library).
  const credentialsJson = process.env.GCS_CREDENTIALS_JSON;
  return credentialsJson
    ? new textToSpeechV1beta1.TextToSpeechClient({ credentials: JSON.parse(credentialsJson) })
    : new textToSpeechV1beta1.TextToSpeechClient();
}

// Picks which Hebrew voice to render with: GOOGLE_TTS_VOICE_NAME if set,
// otherwise the best quality tier Google's own catalog currently offers for
// he-IL on this project (Chirp3-HD > Neural2 > Wavenet > Standard). Resolved
// via listVoices() instead of a hardcoded name so this doesn't silently
// break (or silently stay stuck on an older tier) as Google's Hebrew
// lineup changes.
async function resolveVoiceName(client: textToSpeechV1beta1.TextToSpeechClient): Promise<string> {
  const override = process.env.GOOGLE_TTS_VOICE_NAME;
  if (override) return override;

  const [result] = await client.listVoices({ languageCode: "he-IL" });
  const voices = result.voices ?? [];
  // Deliberately does NOT prefer Chirp3-HD (Google's newest, most natural
  // tier) despite it sounding best: Chirp/Journey voices don't support SSML
  // at all, and even Studio voices that do support SSML drop <mark> tags
  // specifically -- either way, the <mark> timepoints this whole pipeline
  // depends on for caption/duration timing get silently dropped, which is
  // what produced a 3-second video (INTRO+OUTRO padding only, durationInSeconds
  // came back as 0) the first time this ran with an auto-picked Chirp3-HD
  // voice. Neural2/Wavenet reliably support classic SSML including <mark>.
  const tier = (name: string): number => (/Neural2/.test(name) ? 0 : /Wavenet/.test(name) ? 1 : 2);
  const [best] = [...voices].sort((a, b) => tier(a.name ?? "") - tier(b.name ?? ""));

  if (!best?.name) {
    throw new Error(
      "Google Cloud Text-to-Speech returned no he-IL voices -- check that the Text-to-Speech API is enabled for this GCP project.",
    );
  }
  return best.name;
}

function tokenizeWords(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

// Builds per-word start/end times from Google's SSML <mark> timepoints
// (one "w{index}" mark placed right before each word, plus a trailing
// "wEnd" mark after the last one) -- Google only reports each mark's start
// time, so a word's end is just the next word's start (or, for the last
// word, the wEnd mark).
function buildWordsFromTimepoints(
  tokens: string[],
  timepoints: textToSpeechProtos.google.cloud.texttospeech.v1beta1.ITimepoint[],
): { words: Word[]; totalDurationSeconds: number } {
  const starts = new Array(tokens.length).fill(0);
  let totalDurationSeconds = 0;

  for (const tp of timepoints) {
    if (tp.markName === "wEnd") {
      totalDurationSeconds = tp.timeSeconds ?? totalDurationSeconds;
      continue;
    }
    const match = /^w(\d+)$/.exec(tp.markName ?? "");
    if (!match) continue;
    const index = Number(match[1]);
    if (index >= 0 && index < tokens.length) starts[index] = tp.timeSeconds ?? 0;
  }

  const words = tokens.map((text, i) => ({
    text,
    startSeconds: starts[i],
    endSeconds: i + 1 < tokens.length ? starts[i + 1] : totalDurationSeconds,
  }));
  return { words, totalDurationSeconds };
}

// Calls Google Cloud Text-to-Speech's v1beta1 synthesizeSpeech with
// enableTimePointing -- that's the (v1beta1-only) feature that returns back
// when each <mark> in the SSML was reached, which is what lets the
// on-screen captions in MarketingReel.tsx track the narration instead of
// guessing at a flat reading speed.
async function synthesizeNarration(
  client: textToSpeechV1beta1.TextToSpeechClient,
  voiceName: string,
  text: string,
): Promise<{ audioBuffer: Buffer; words: Word[]; totalDurationSeconds: number }> {
  const tokens = tokenizeWords(text);
  if (tokens.length === 0) throw new Error("voiceover_text has no words to synthesize.");

  const marked = tokens.map((token, i) => `<mark name="w${i}"/>${applyPronunciationFix(token)}`);
  const ssml = `<speak>${marked.join(" ")}<mark name="wEnd"/></speak>`;

  const [response] = await client.synthesizeSpeech({
    input: { ssml },
    voice: { languageCode: "he-IL", name: voiceName },
    audioConfig: { audioEncoding: "MP3" },
    enableTimePointing: [TIMEPOINT_TYPE.SSML_MARK],
  });

  if (!response.audioContent) {
    throw new Error("Google Cloud Text-to-Speech response did not include audio.");
  }
  const { words, totalDurationSeconds } = buildWordsFromTimepoints(tokens, response.timepoints ?? []);
  // A voice that doesn't support SSML <mark> (Chirp/Journey, or Studio
  // specifically for <mark>) silently returns zero/no timepoints instead of
  // erroring -- catch that here instead of rendering a video sized to just
  // the intro/outro padding while the full narration plays underneath and
  // gets cut off. If this fires, GOOGLE_TTS_VOICE_NAME is likely set (or
  // will resolve) to an unsupported voice; use a Neural2/Wavenet voice.
  if (totalDurationSeconds <= 0) {
    throw new Error(
      `Google Cloud TTS returned no usable <mark> timepoints for voice "${voiceName}" -- it likely doesn't support SSML marks (Chirp3-HD/Journey/Studio voices don't). Use a Neural2 or Wavenet he-IL voice instead.`,
    );
  }
  return { audioBuffer: Buffer.from(response.audioContent as Uint8Array), words, totalDurationSeconds };
}

// Groups words into short on-screen caption lines (~CAPTION_CHUNK_MAX_CHARS
// each), keeping each word's own timing so a line's words can pop in one at
// a time as they're spoken, rather than the whole line appearing at once.
function buildCaptions(words: Word[]): Caption[] {
  const captions: Caption[] = [];
  let line: Word[] = [];
  let lineChars = 0;

  const flush = () => {
    if (line.length === 0) return;
    captions.push({
      text: line.map((w) => w.text).join(" "),
      startSeconds: line[0].startSeconds,
      endSeconds: line[line.length - 1].endSeconds,
      words: line,
    });
    line = [];
    lineChars = 0;
  };

  for (const word of words) {
    line.push(word);
    lineChars += word.text.length + 1;
    if (lineChars >= CAPTION_CHUNK_MAX_CHARS) flush();
  }
  flush();
  return captions;
}

async function renderReel(
  serveUrl: string,
  idea: BacklogIdea,
  audioBuffer: Buffer,
  words: Word[],
  totalDurationSeconds: number,
  broll: string | undefined,
  outputPath: string,
): Promise<void> {
  const visualMotif: VisualMotif = VISUAL_MOTIFS.includes(idea.visual_motif as VisualMotif)
    ? (idea.visual_motif as VisualMotif)
    : "generic";
  const inputProps = {
    title: idea.title,
    captions: buildCaptions(words),
    // Embedding the narration as a data URI skips needing a Remotion
    // public/ dir per render -- the audio never touches disk except as part
    // of the final rendered mp4.
    audioSrc: `data:audio/mpeg;base64,${audioBuffer.toString("base64")}`,
    durationInSeconds: totalDurationSeconds,
    visualMotif,
    colorTheme: pickColorTheme(idea.id),
    broll,
  };

  const composition = await selectComposition({ serveUrl, id: "MarketingReel", inputProps });
  await renderMedia({ composition, serveUrl, codec: "h264", outputLocation: outputPath, inputProps });
}

async function main() {
  const ttsClient = getTtsClient();
  const voiceName = await resolveVoiceName(ttsClient);
  console.log(`Using Google Cloud TTS voice: ${voiceName}`);

  const backlog = loadJson<Backlog>(BACKLOG_PATH);
  const queue = loadJson<Queue>(QUEUE_PATH);
  const queuedIdeaIds = new Set(queue.videos.map((v) => v.idea_id));

  const candidates = backlog.ideas.filter(
    (i) => i.channel_hint === "video" && i.status === "new" && !queuedIdeaIds.has(i.id),
  );

  if (candidates.length === 0) {
    console.log("No new video-flagged ideas waiting to be rendered.");
    return;
  }

  console.log("Bundling the Remotion composition...");
  const publicDir = existsSync(BROLL_DIR) ? BROLL_DIR : null;
  // symlinkPublicDir is safe here (not just faster): this bundle is a
  // throwaway used for one script run and never deployed anywhere, so there
  // is no need for it to be a self-contained copy.
  const serveUrl = await bundle({ entryPoint: VIDEO_RENDERER_ENTRY, publicDir, symlinkPublicDir: true });

  let rendered = 0;
  for (const idea of candidates) {
    if (rendered >= MAX_RENDERS_PER_RUN) break;

    if (!idea.voiceover_text) {
      console.warn(`Skipping "${idea.title}" (${idea.id}): no voiceover_text -- re-run the idea agent to backfill it, or add it manually.`);
      continue;
    }

    const tempDir = mkdtempSync(join(tmpdir(), "focusstudy-video-"));
    const outputPath = join(tempDir, `${idea.id}.mp4`);

    try {
      console.log(`Synthesizing narration for "${idea.title}" (${idea.id})...`);
      const { audioBuffer, words, totalDurationSeconds } = await synthesizeNarration(ttsClient, voiceName, idea.voiceover_text);

      const broll = pickBrollClip();
      console.log(`Rendering "${idea.title}" (${idea.id})${broll ? ` with broll clip "${broll}"` : ""}...`);
      await renderReel(serveUrl, idea, audioBuffer, words, totalDurationSeconds, broll, outputPath);

      console.log(`Uploading "${idea.title}" (${idea.id})...`);
      const { storagePath, signedUrl } = await uploadMarketingVideo(idea.id, outputPath);

      queue.videos.push({
        idea_id: idea.id,
        status: "ready_for_review",
        narration_provider: "google-cloud-tts",
        rendered_at: new Date().toISOString(),
        storage_path: storagePath,
        video_url: signedUrl,
      });
      idea.status = "claimed";
      rendered++;
      console.log(`"${idea.title}" (${idea.id}) is ready for review: ${signedUrl}`);
    } catch (error) {
      console.error(`Failed to render "${idea.title}" (${idea.id}):`, error instanceof Error ? error.message : error);
      queue.videos.push({
        idea_id: idea.id,
        status: "failed",
        updated_at: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });
      idea.status = "claimed";
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  saveJson(QUEUE_PATH, queue);
  saveJson(BACKLOG_PATH, backlog);
}

main().catch((error) => {
  console.error("video-agent failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
