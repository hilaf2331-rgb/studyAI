import { readFileSync, writeFileSync, existsSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { uploadMarketingVideo } from "./gcs";
import { buildSfxDataUris } from "./sfx";

// Repo layout: clean_website/scripts/src/marketing/video-agent.ts -> repo
// root is four levels up.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

// Loads secrets (ELEVENLABS_API_KEY, etc.) from clean_website/.env when
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

const ELEVENLABS_API_BASE = "https://api.elevenlabs.io";
// eleven_multilingual_v2 (ElevenLabs' older broad-coverage model) does not
// actually cover Hebrew despite being "multilingual" -- it renders Hebrew
// input as Arabic-sounding speech instead. Confirmed via ElevenLabs' own
// Speech Synthesis playground: only eleven_v3 produced clean Hebrew for the
// same voice/text. Requires a Starter-tier ($5-6/mo) subscription or above
// for commercial-use rights -- the free tier is non-commercial only.
const DEFAULT_ELEVENLABS_MODEL_ID = "eleven_v3";
// Caps how many videos one run renders (TTS + a full Remotion render each),
// so a single invocation can't burn through ElevenLabs credits or take
// forever locally.
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

// Words ElevenLabs mispronounces from plain Hebrew script (which has no
// niqqud/vowel marks, so any TTS engine is just guessing) -- keyed by the
// exact spelling as written in voiceover_text, valued as the IPA reading
// that was actually confirmed correct by ear. This list only ever grows
// reactively: write voiceover_text normally, listen to a render, and if a
// specific word comes out wrong, add ONE entry here for it. There is no way
// to pre-guess which slang will need this, so don't try.
const PRONUNCIATION_FIXES: Record<string, string> = {
  // "AHYOS" with a light/almost-silent opening ה, sh at the end -- default
  // Hebrew reading (with a tzere) came out as "האיוש" instead. Confirmed
  // working when the word sits mid-sentence -- as a standalone word right
  // before a trailing "!", ElevenLabs stuttered and read it twice (once
  // wrong, once right).
  "היוש": "ahˈjoʃ",
};

// ElevenLabs v3's inline pronunciation syntax is `/IPA/word` (no classic
// XML <phoneme> tag support on v3). Applied only to the text sent to TTS --
// buildWords() strips the "/ipa/" prefix back off before anything reaches
// the screen, so captions still show plain Hebrew.
function applyPronunciationFixes(text: string): string {
  let result = text;
  for (const [word, ipa] of Object.entries(PRONUNCIATION_FIXES)) {
    const pattern = new RegExp(`(?<![\\u0590-\\u05FF])${word}(?![\\u0590-\\u05FF])`, "g");
    result = result.replace(pattern, `/${ipa}/${word}`);
  }
  return result;
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
  // Exact substring of `title` to underline with the rough.js highlighter
  // stroke during MarketingReel's HighlightBeat (Technique 4 of the
  // remotion-video-editing skill). Optional and never auto-picked -- an
  // idea with no real key_phrase just skips the beat (see renderReel
  // below), per that skill's authenticity gate.
  key_phrase?: string;
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

interface ElevenLabsAlignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

interface ElevenLabsResponse {
  audio_base64: string;
  alignment: ElevenLabsAlignment;
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

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} environment variable is required but was not provided.`);
  return value;
}

// Calls ElevenLabs' with-timestamps endpoint (rather than the plain TTS
// endpoint) specifically to get character-level timing back alongside the
// audio -- that's what lets the on-screen captions in MarketingReel.tsx
// track the narration instead of guessing at a flat reading speed.
async function synthesizeNarration(
  apiKey: string,
  voiceId: string,
  modelId: string,
  text: string,
): Promise<{ audioBuffer: Buffer; alignment: ElevenLabsAlignment }> {
  const response = await fetch(`${ELEVENLABS_API_BASE}/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ text, model_id: modelId }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`ElevenLabs with-timestamps failed (${response.status}): ${body ? JSON.stringify(body) : response.statusText}`);
  }
  const parsed = body as ElevenLabsResponse | null;
  if (!parsed?.audio_base64 || !parsed.alignment?.characters?.length) {
    throw new Error("ElevenLabs response did not include audio + alignment data.");
  }
  return { audioBuffer: Buffer.from(parsed.audio_base64, "base64"), alignment: parsed.alignment };
}

// Undoes applyPronunciationFixes() for display purposes: a word ElevenLabs
// received as "/ahˈjoʃ/היוש" comes back through the alignment as that same
// literal string (no internal whitespace, so buildWords treats it as one
// word) -- strip the "/ipa/" prefix so captions show only "היוש".
function stripPronunciationAnnotation(word: string): string {
  const match = /^\/[^/]+\/(.+)$/.exec(word);
  return match ? match[1] : word;
}

// First pass of buildCaptions: turns ElevenLabs' per-character timing into
// per-word timing (splitting on whitespace) -- this is what lets
// MarketingReel.tsx pop each word in individually, in sync with when it's
// actually spoken, instead of fading a whole line in at once.
function buildWords(alignment: ElevenLabsAlignment): Word[] {
  const words: Word[] = [];
  let buffer = "";
  let wordStart = 0;
  let lastEnd = 0;

  for (let i = 0; i < alignment.characters.length; i++) {
    const ch = alignment.characters[i];
    if (buffer.length === 0) wordStart = alignment.character_start_times_seconds[i];
    lastEnd = alignment.character_end_times_seconds[i];

    if (/\s/.test(ch)) {
      if (buffer) words.push({ text: stripPronunciationAnnotation(buffer), startSeconds: wordStart, endSeconds: lastEnd });
      buffer = "";
    } else {
      buffer += ch;
    }
  }
  if (buffer) words.push({ text: stripPronunciationAnnotation(buffer), startSeconds: wordStart, endSeconds: lastEnd });
  return words;
}

// Groups words into short on-screen caption lines (~CAPTION_CHUNK_MAX_CHARS
// each), keeping each word's own timing so a line's words can pop in one at
// a time as they're spoken, rather than the whole line appearing at once.
function buildCaptions(alignment: ElevenLabsAlignment): Caption[] {
  const words = buildWords(alignment);
  const captions: Caption[] = [];
  let line: Word[] = [];
  let lineChars = 0;

  for (const word of words) {
    line.push(word);
    lineChars += word.text.length + 1;
    if (lineChars >= CAPTION_CHUNK_MAX_CHARS) {
      captions.push({
        text: line.map((w) => w.text).join(" "),
        startSeconds: line[0].startSeconds,
        endSeconds: line[line.length - 1].endSeconds,
        words: line,
      });
      line = [];
      lineChars = 0;
    }
  }
  if (line.length > 0) {
    captions.push({
      text: line.map((w) => w.text).join(" "),
      startSeconds: line[0].startSeconds,
      endSeconds: line[line.length - 1].endSeconds,
      words: line,
    });
  }
  return captions;
}

async function renderReel(
  serveUrl: string,
  idea: BacklogIdea,
  audioBuffer: Buffer,
  alignment: ElevenLabsAlignment,
  broll: string | undefined,
  outputPath: string,
): Promise<void> {
  const durationInSeconds = alignment.character_end_times_seconds.at(-1) ?? 0;
  const visualMotif: VisualMotif = VISUAL_MOTIFS.includes(idea.visual_motif as VisualMotif)
    ? (idea.visual_motif as VisualMotif)
    : "generic";
  const inputProps = {
    title: idea.title,
    captions: buildCaptions(alignment),
    // Embedding the narration as a data URI skips needing a Remotion
    // public/ dir per render -- the audio never touches disk except as part
    // of the final rendered mp4.
    audioSrc: `data:audio/mpeg;base64,${audioBuffer.toString("base64")}`,
    durationInSeconds,
    visualMotif,
    colorTheme: pickColorTheme(idea.id),
    broll,
    sfx: buildSfxDataUris(),
    keyPhrase: idea.key_phrase,
  };

  const composition = await selectComposition({ serveUrl, id: "MarketingReel", inputProps });
  await renderMedia({ composition, serveUrl, codec: "h264", outputLocation: outputPath, inputProps });
}

async function main() {
  const elevenLabsApiKey = requireEnv("ELEVENLABS_API_KEY");
  const voiceId = requireEnv("ELEVENLABS_VOICE_ID");
  // `||` (not `??`) so an empty string -- e.g. ELEVENLABS_MODEL_ID= left
  // blank in .env, as .env.example itself invites -- also falls back to
  // the default, instead of sending ElevenLabs an empty model_id.
  const modelId = process.env.ELEVENLABS_MODEL_ID || DEFAULT_ELEVENLABS_MODEL_ID;

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
      const spokenText = applyPronunciationFixes(idea.voiceover_text);
      const { audioBuffer, alignment } = await synthesizeNarration(elevenLabsApiKey, voiceId, modelId, spokenText);

      const broll = pickBrollClip();
      console.log(`Rendering "${idea.title}" (${idea.id})${broll ? ` with broll clip "${broll}"` : ""}...`);
      await renderReel(serveUrl, idea, audioBuffer, alignment, broll, outputPath);

      console.log(`Uploading "${idea.title}" (${idea.id})...`);
      const { storagePath, signedUrl } = await uploadMarketingVideo(idea.id, outputPath);

      queue.videos.push({
        idea_id: idea.id,
        status: "ready_for_review",
        narration_provider: "elevenlabs",
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
