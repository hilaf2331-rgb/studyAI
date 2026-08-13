// Thin wrapper around Google Cloud Storage for hosting rendered marketing
// videos -- reuses the same bucket and credentials as the API server's own
// course-media storage (clean_website/artifacts/api-server/src/lib/storage.ts),
// just under a separate "marketing-video/" prefix, so no second bucket needs
// to be provisioned for this to work.
//
// Unlike course media, these signed URLs aren't meant to stay secret -- Meta
// only needs to fetch the video once (video_url/file_url in publish-agent.ts)
// -- but a public-read bucket isn't required either: a signed URL that
// outlives the review-then-publish window is enough, and never having to
// flip any object to public-read is one less thing that can be misconfigured.
import { Storage } from "@google-cloud/storage";

// GCS V4 signed URLs cap out at 7 days when signed with a service-account
// key -- long enough to review a rendered reel and run publish-agent by hand
// without the link going stale first.
const SIGNED_URL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

let storageClient: Storage | undefined;

// GCS_CREDENTIALS_JSON holds the full service-account key as a JSON string
// (same var the API server reads) so no key file needs to be checked into
// the repo. GOOGLE_APPLICATION_CREDENTIALS (a file path) is also honored for
// local/dev setups that prefer a key file.
function getStorageClient(): Storage {
  if (storageClient) return storageClient;
  const credentialsJson = process.env.GCS_CREDENTIALS_JSON;
  storageClient = credentialsJson ? new Storage({ credentials: JSON.parse(credentialsJson) }) : new Storage();
  return storageClient;
}

function getBucketName(): string {
  const bucketName = process.env.GCS_BUCKET_NAME;
  if (!bucketName) {
    throw new Error("GCS_BUCKET_NAME is not set -- required to host the rendered video somewhere Meta can fetch it from.");
  }
  return bucketName;
}

export async function mintSignedVideoUrl(storagePath: string): Promise<string> {
  const file = getStorageClient().bucket(getBucketName()).file(storagePath);
  const [url] = await file.getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + SIGNED_URL_TTL_MS,
  });
  return url;
}

// Uploads a rendered mp4 from local disk and returns both its storage path
// (so a fresh signed URL can be re-minted later if the first one expires
// before publish-agent gets to it) and a ready-to-use signed URL.
export async function uploadMarketingVideo(
  ideaId: string,
  localFilePath: string,
): Promise<{ storagePath: string; signedUrl: string }> {
  const storagePath = `marketing-video/${ideaId}.mp4`;
  await getStorageClient().bucket(getBucketName()).upload(localFilePath, {
    destination: storagePath,
    contentType: "video/mp4",
  });
  const signedUrl = await mintSignedVideoUrl(storagePath);
  return { storagePath, signedUrl };
}
