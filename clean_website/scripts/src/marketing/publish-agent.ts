import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Repo layout: clean_website/scripts/src/marketing/publish-agent.ts -> repo
// root is four levels up.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const BACKLOG_PATH = join(REPO_ROOT, "marketing/ideas/backlog.json");
const QUEUE_PATH = join(REPO_ROOT, "marketing/heygen/queue.json");

const GRAPH_API_BASE = "https://graph.facebook.com";
const DEFAULT_GRAPH_API_VERSION = "v25.0";
// Every video that reaches this queue came from a HeyGen-produced idea (see
// heygen-agent.ts), which only ever tags ideas channel_hint:"heygen" -- so
// there's no per-idea signal for "Instagram vs Facebook", and a finished
// vertical reel is natural to cross-post to both by default.
const MAX_VIDEOS_PER_RUN = 5;
// Instagram containers process asynchronously (30s to a few minutes per
// Meta's docs) -- this bounds how long a single run waits before giving up
// and remembering the container id to resume polling on the next run,
// rather than blocking indefinitely or creating a duplicate container.
const IG_POLL_ATTEMPTS = 6;
const IG_POLL_DELAY_MS = 5000;

interface BacklogIdea {
  id: string;
  title: string;
  caption?: string;
  [key: string]: unknown;
}

interface Backlog {
  schema: Record<string, string>;
  ideas: BacklogIdea[];
}

interface PlatformPublishResult {
  status: "container_processing" | "published" | "failed";
  container_id?: string;
  media_id?: string;
  error?: string;
  attempted_at: string;
  published_at?: string;
}

interface QueueVideo {
  idea_id: string;
  status: string;
  video_url?: string;
  updated_at?: string;
  instagram_publish?: PlatformPublishResult;
  facebook_publish?: PlatformPublishResult;
  [key: string]: unknown;
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function nowIso(): string {
  return new Date().toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function graphFetch(
  version: string,
  path: string,
  params: URLSearchParams,
  method: "GET" | "POST",
): Promise<any> {
  const url = new URL(`${GRAPH_API_BASE}/${version}${path}`);
  const response =
    method === "GET"
      ? await fetch((() => {
          for (const [key, value] of params) url.searchParams.set(key, value);
          return url;
        })())
      : await fetch(url, { method: "POST", body: params });

  const body: any = await response.json().catch(() => null);
  if (!response.ok || body?.error) {
    throw new Error(`Graph API ${path} failed: ${body ? JSON.stringify(body.error ?? body) : response.statusText}`);
  }
  return body;
}

// Step 1 of Instagram's 3-step Reels publishing flow: creates a media
// container from the (already publicly hosted, HeyGen-provided) video URL.
async function startInstagramContainer(
  version: string,
  accessToken: string,
  igUserId: string,
  videoUrl: string,
  caption: string,
): Promise<string> {
  const body = await graphFetch(
    version,
    `/${igUserId}/media`,
    new URLSearchParams({ media_type: "REELS", video_url: videoUrl, caption, access_token: accessToken }),
    "POST",
  );
  const containerId = body?.id;
  if (!containerId) throw new Error("Instagram media container response did not include an id.");
  return containerId;
}

// Step 2: poll until Instagram's own video processing finishes.
async function pollInstagramContainer(
  version: string,
  accessToken: string,
  containerId: string,
): Promise<{ statusCode: string; errorDetail?: unknown }> {
  const body = await graphFetch(
    version,
    `/${containerId}`,
    new URLSearchParams({ fields: "status_code", access_token: accessToken }),
    "GET",
  );
  return { statusCode: body?.status_code, errorDetail: body?.status };
}

// Step 3: publish the finished container as an actual Reel.
async function publishInstagramContainer(
  version: string,
  accessToken: string,
  igUserId: string,
  containerId: string,
): Promise<string> {
  const body = await graphFetch(
    version,
    `/${igUserId}/media_publish`,
    new URLSearchParams({ creation_id: containerId, access_token: accessToken }),
    "POST",
  );
  const mediaId = body?.id;
  if (!mediaId) throw new Error("Instagram media_publish response did not include an id.");
  return mediaId;
}

async function processInstagram(
  version: string,
  accessToken: string,
  igUserId: string,
  video: QueueVideo,
  idea: BacklogIdea,
): Promise<void> {
  let containerId = video.instagram_publish?.container_id;
  if (!containerId) {
    try {
      containerId = await startInstagramContainer(version, accessToken, igUserId, video.video_url!, idea.caption!);
    } catch (error) {
      video.instagram_publish = { status: "failed", error: errorMessage(error), attempted_at: nowIso() };
      return;
    }
  }

  for (let attempt = 0; attempt < IG_POLL_ATTEMPTS; attempt++) {
    let polled: { statusCode: string; errorDetail?: unknown };
    try {
      polled = await pollInstagramContainer(version, accessToken, containerId);
    } catch (error) {
      video.instagram_publish = { status: "failed", container_id: containerId, error: errorMessage(error), attempted_at: nowIso() };
      return;
    }

    if (polled.statusCode === "FINISHED") {
      try {
        const mediaId = await publishInstagramContainer(version, accessToken, igUserId, containerId);
        video.instagram_publish = {
          status: "published",
          container_id: containerId,
          media_id: mediaId,
          attempted_at: nowIso(),
          published_at: nowIso(),
        };
      } catch (error) {
        video.instagram_publish = { status: "failed", container_id: containerId, error: errorMessage(error), attempted_at: nowIso() };
      }
      return;
    }
    if (polled.statusCode === "ERROR") {
      video.instagram_publish = {
        status: "failed",
        container_id: containerId,
        error: `Instagram container reported an error (status ${JSON.stringify(polled.errorDetail)}).`,
        attempted_at: nowIso(),
      };
      return;
    }
    if (attempt < IG_POLL_ATTEMPTS - 1) await sleep(IG_POLL_DELAY_MS);
  }

  video.instagram_publish = { status: "container_processing", container_id: containerId, attempted_at: nowIso() };
  console.log(`Instagram container ${containerId} for idea ${video.idea_id} still processing -- will resume next run.`);
}

// Uses the file_url form (the video is already hosted at a public HTTPS URL
// via HeyGen) rather than the resumable chunked-upload flow -- simpler, but
// less exercised in Meta's current docs than the Instagram Reels flow above.
// If a Page/App combination rejects file_url, Graph API's error response is
// surfaced verbatim in facebook_publish.error for diagnosis.
async function processFacebook(
  version: string,
  accessToken: string,
  pageId: string,
  video: QueueVideo,
  idea: BacklogIdea,
): Promise<void> {
  try {
    const body = await graphFetch(
      version,
      `/${pageId}/videos`,
      new URLSearchParams({ file_url: video.video_url!, description: idea.caption!, access_token: accessToken }),
      "POST",
    );
    const videoId = body?.id;
    if (!videoId) throw new Error("Facebook /videos response did not include an id.");
    video.facebook_publish = { status: "published", media_id: videoId, attempted_at: nowIso(), published_at: nowIso() };
  } catch (error) {
    video.facebook_publish = { status: "failed", error: errorMessage(error), attempted_at: nowIso() };
  }
}

async function main() {
  const accessToken = requireEnv("META_ACCESS_TOKEN");
  const igUserId = requireEnv("IG_USER_ID");
  const pageId = requireEnv("FB_PAGE_ID");
  const version = process.env.GRAPH_API_VERSION ?? DEFAULT_GRAPH_API_VERSION;

  const backlog = loadJson<Backlog>(BACKLOG_PATH);
  const queue = loadJson<Queue>(QUEUE_PATH);
  const ideaById = new Map(backlog.ideas.map((i) => [i.id, i]));

  let processed = 0;
  for (const video of queue.videos) {
    if (processed >= MAX_VIDEOS_PER_RUN) break;

    const resumingInstagram = video.instagram_publish?.status === "container_processing";
    const freshlyReady = video.status === "ready_for_review" && (!video.instagram_publish || !video.facebook_publish);
    if (!resumingInstagram && !freshlyReady) continue;

    const idea = ideaById.get(video.idea_id);
    if (!idea) {
      console.warn(`No backlog idea found for queued video ${video.idea_id}, skipping.`);
      continue;
    }
    if (!idea.caption) {
      console.warn(`Skipping "${idea.title}" (${idea.id}): no caption -- re-run the idea agent to backfill it, or add it manually.`);
      continue;
    }
    if (!video.video_url) {
      console.warn(`Skipping ${video.idea_id}: queue entry has no video_url yet.`);
      continue;
    }

    if (resumingInstagram || !video.instagram_publish) {
      await processInstagram(version, accessToken, igUserId, video, idea);
    }
    if (!video.facebook_publish) {
      await processFacebook(version, accessToken, pageId, video, idea);
    }

    const instagramSettled = video.instagram_publish && video.instagram_publish.status !== "container_processing";
    if (instagramSettled && video.facebook_publish) {
      video.status = "published";
      video.updated_at = nowIso();
    }
    processed++;
  }

  if (processed === 0) {
    console.log("No videos ready to publish (or resume) this run.");
  }

  saveJson(QUEUE_PATH, queue);
}

main().catch((error) => {
  console.error("publish-agent failed:", errorMessage(error));
  process.exitCode = 1;
});
