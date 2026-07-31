import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Repo layout: clean_website/scripts/src/marketing/heygen-agent.ts -> repo
// root is four levels up.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const BACKLOG_PATH = join(REPO_ROOT, "marketing/ideas/backlog.json");
const QUEUE_PATH = join(REPO_ROOT, "marketing/heygen/queue.json");

const HEYGEN_API_BASE = "https://api.heygen.com";
// Caps how many videos one run submits, so a single invocation can't burn
// through the whole HeyGen credit balance at once.
const MAX_SUBMISSIONS_PER_RUN = 3;
// Portrait framing matches Reels/TikTok/Shorts -- every channel_hint:
// "heygen" idea in the backlog is written for one of those.
const VIDEO_DIMENSION = { width: 1080, height: 1920 };

interface BacklogIdea {
  id: string;
  title: string;
  channel_hint: string;
  // The exact words the avatar should speak -- see idea-agent.ts, which
  // writes this separately from script_or_caption_draft (the full
  // beat-by-beat production script, which also contains on-screen-text/
  // editing directions that must NOT be read aloud).
  voiceover_text?: string;
  status: string;
  [key: string]: unknown;
}

interface Backlog {
  schema: Record<string, string>;
  ideas: BacklogIdea[];
}

type QueueStatus = "pending_credits" | "generating" | "ready_for_review" | "published" | "failed";

interface QueueVideo {
  idea_id: string;
  heygen_video_id?: string;
  status: QueueStatus;
  submitted_at?: string;
  updated_at?: string;
  video_url?: string;
  error?: string;
}

interface Queue {
  schema: Record<string, string>;
  videos: QueueVideo[];
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

// Thrown when HeyGen's own error response indicates the account is out of
// credits (rather than a generic/transient failure) -- lets the submit loop
// stop trying further ideas this run instead of burning through all of them
// on the same known-dead cause, and lets the queue entry get the more
// accurate "pending_credits" status instead of "failed".
class InsufficientCreditsError extends Error {}

async function heygenFetch(apiKey: string, path: string, init: RequestInit = {}): Promise<any> {
  const response = await fetch(`${HEYGEN_API_BASE}${path}`, {
    ...init,
    headers: { "X-Api-Key": apiKey, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body ? JSON.stringify(body) : response.statusText;
    if (/credit|quota/i.test(message)) throw new InsufficientCreditsError(message);
    throw new Error(`HeyGen ${path} failed (${response.status}): ${message}`);
  }
  return body;
}

async function getRemainingQuota(apiKey: string): Promise<number> {
  const body = await heygenFetch(apiKey, "/v2/user/remaining_quota");
  const quota = body?.data?.remaining_quota;
  if (typeof quota !== "number") throw new Error("Unexpected remaining_quota response shape from HeyGen.");
  return quota;
}

async function submitVideo(
  apiKey: string,
  avatarId: string,
  voiceId: string,
  idea: BacklogIdea,
): Promise<string> {
  const body = await heygenFetch(apiKey, "/v2/video/generate", {
    method: "POST",
    body: JSON.stringify({
      title: idea.title,
      video_inputs: [
        {
          character: { type: "avatar", avatar_id: avatarId, avatar_style: "normal" },
          voice: { type: "text", input_text: idea.voiceover_text, voice_id: voiceId },
          background: { type: "color", value: process.env.HEYGEN_BACKGROUND_COLOR ?? "#0B1220" },
        },
      ],
      dimension: VIDEO_DIMENSION,
    }),
  });
  const videoId = body?.data?.video_id;
  if (!videoId) throw new Error("HeyGen generate response did not include a video_id.");
  return videoId;
}

async function fetchVideoStatus(
  apiKey: string,
  videoId: string,
): Promise<{ status: string; video_url?: string; error?: unknown }> {
  const body = await heygenFetch(apiKey, `/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`);
  return body?.data;
}

async function submitNewIdeas(
  apiKey: string,
  avatarId: string,
  voiceId: string,
  backlog: Backlog,
  queue: Queue,
): Promise<void> {
  const queuedIdeaIds = new Set(queue.videos.map((v) => v.idea_id));
  const candidates = backlog.ideas.filter(
    (i) => i.channel_hint === "heygen" && i.status === "new" && !queuedIdeaIds.has(i.id),
  );

  if (candidates.length === 0) {
    console.log("No new HeyGen-flagged ideas waiting to be submitted.");
    return;
  }

  const quota = await getRemainingQuota(apiKey);
  if (quota <= 0) {
    console.warn(`HeyGen quota exhausted (remaining_quota=${quota}) -- marking candidates as pending_credits instead of submitting.`);
    for (const idea of candidates.slice(0, MAX_SUBMISSIONS_PER_RUN)) {
      queue.videos.push({ idea_id: idea.id, status: "pending_credits", updated_at: new Date().toISOString() });
      idea.status = "claimed";
    }
    return;
  }

  let submitted = 0;
  for (const idea of candidates) {
    if (submitted >= MAX_SUBMISSIONS_PER_RUN) break;

    if (!idea.voiceover_text) {
      console.warn(`Skipping "${idea.title}" (${idea.id}): no voiceover_text -- re-run the idea agent to backfill it, or add it manually.`);
      continue;
    }

    try {
      const videoId = await submitVideo(apiKey, avatarId, voiceId, idea);
      queue.videos.push({
        idea_id: idea.id,
        heygen_video_id: videoId,
        status: "generating",
        submitted_at: new Date().toISOString(),
      });
      idea.status = "claimed";
      submitted++;
      console.log(`Submitted "${idea.title}" (${idea.id}) -> HeyGen video ${videoId}`);
    } catch (error) {
      if (error instanceof InsufficientCreditsError) {
        console.warn(`HeyGen reported insufficient credits while submitting "${idea.title}" (${idea.id}) -- stopping further submissions this run.`);
        queue.videos.push({ idea_id: idea.id, status: "pending_credits", updated_at: new Date().toISOString() });
        idea.status = "claimed";
        break;
      }
      console.error(`Failed to submit "${idea.title}" (${idea.id}):`, error instanceof Error ? error.message : error);
      queue.videos.push({
        idea_id: idea.id,
        status: "failed",
        updated_at: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });
      idea.status = "claimed";
    }
  }
}

async function pollGeneratingVideos(apiKey: string, queue: Queue): Promise<void> {
  const pending = queue.videos.filter((v) => v.status === "generating" && v.heygen_video_id);
  if (pending.length === 0) return;

  for (const video of pending) {
    try {
      const status = await fetchVideoStatus(apiKey, video.heygen_video_id!);
      if (status.status === "completed") {
        video.status = "ready_for_review";
        video.video_url = status.video_url;
        video.updated_at = new Date().toISOString();
        console.log(`Video for idea ${video.idea_id} is ready for review: ${status.video_url}`);
      } else if (status.status === "failed") {
        video.status = "failed";
        video.error = status.error ? JSON.stringify(status.error) : "HeyGen reported failure.";
        video.updated_at = new Date().toISOString();
        console.error(`Video for idea ${video.idea_id} failed:`, video.error);
      } else {
        console.log(`Video for idea ${video.idea_id} still ${status.status}.`);
      }
    } catch (error) {
      console.error(`Failed to check status for idea ${video.idea_id}:`, error instanceof Error ? error.message : error);
    }
  }
}

async function main() {
  const apiKey = requireEnv("HEYGEN_API_KEY");
  const avatarId = requireEnv("HEYGEN_AVATAR_ID");
  const voiceId = requireEnv("HEYGEN_VOICE_ID");

  const backlog = loadJson<Backlog>(BACKLOG_PATH);
  const queue = loadJson<Queue>(QUEUE_PATH);

  await pollGeneratingVideos(apiKey, queue);
  await submitNewIdeas(apiKey, avatarId, voiceId, backlog, queue);

  saveJson(QUEUE_PATH, queue);
  saveJson(BACKLOG_PATH, backlog);
}

main().catch((error) => {
  console.error("heygen-agent failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
