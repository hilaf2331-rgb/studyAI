// Thin wrapper around Google Cloud Storage (also the backing store behind
// Firebase Storage buckets) for the Course Media / audio-podcast feature.
// Audio binaries never touch Postgres -- only the storagePath this module
// returns gets persisted in courseAssetsTable. Credentials and bucket name
// come exclusively from environment variables (never hardcoded) so the same
// code runs unmodified across environments.
//
// The bucket is kept fully private (no allUsers/public-read grant) for user
// privacy -- playback URLs are short-lived V4 signed URLs minted per-request
// by getSignedAudioUrl(), never a permanent public link.
//
// The bucket still needs a CORS config applied even though it's private:
// CORS governs which origins may read a *successful* cross-origin response,
// which is a separate browser check from GCS's own request authorization.
// A signed URL satisfies authorization but the <audio> element's range
// request will still be blocked client-side (most strictly by Safari/iOS)
// without it. See ../../gcs-cors.json and apply with:
//   gsutil cors set gcs-cors.json gs://<GCS_BUCKET_NAME>
import { Storage } from "@google-cloud/storage";
import { randomUUID } from "crypto";

// How long a signed playback URL stays valid once minted. Long enough to
// listen through a full lecture/podcast without needing a mid-playback
// refresh, short enough that a leaked URL is only a temporary exposure.
const SIGNED_URL_TTL_MS = 60 * 60 * 1000;

let storageClient: Storage | undefined;

// GCS_CREDENTIALS_JSON holds the full service-account key as a JSON string
// (set via the hosting platform's secret manager) so no key file needs to
// be checked into the repo or mounted on disk -- GOOGLE_APPLICATION_CREDENTIALS
// (a file path) is also honored for local/dev setups that prefer a key file.
function getStorageClient(): Storage {
  if (storageClient) return storageClient;
  const credentialsJson = process.env.GCS_CREDENTIALS_JSON;
  storageClient = credentialsJson ? new Storage({ credentials: JSON.parse(credentialsJson) }) : new Storage();
  return storageClient;
}

function getBucketName(): string {
  const bucketName = process.env.GCS_BUCKET_NAME;
  if (!bucketName) {
    throw new Error("GCS_BUCKET_NAME is not set -- course media storage is unavailable until it's configured");
  }
  return bucketName;
}

export interface UploadedAudio {
  storagePath: string;
  // A gs:// URI for record-keeping/debugging only -- never used to serve
  // the file to a client. The bucket has no public-read grant, so this URL
  // does not resolve directly; playback always goes through
  // getSignedAudioUrl() instead.
  storageUrl: string;
}

// Uploads an already-compressed audio buffer (MP3/AAC) under a per-course
// prefix so a course's media is easy to locate/bulk-delete. The bucket is
// private -- no per-object or bucket-level public-read grant -- so nothing
// here makes the object reachable without a signed URL.
export async function uploadCourseAudio(
  courseId: number,
  buffer: Buffer,
  contentType: string,
  extension: string,
): Promise<UploadedAudio> {
  const bucket = getStorageClient().bucket(getBucketName());
  const storagePath = `course-media/${courseId}/${randomUUID()}.${extension}`;
  const file = bucket.file(storagePath);
  await file.save(buffer, { contentType, resumable: false });
  const storageUrl = `gs://${getBucketName()}/${storagePath}`;
  return { storagePath, storageUrl };
}

// Mints a short-lived V4 signed URL granting temporary read access to one
// object, without making the bucket or object public. Requires either a
// service-account key (GCS_CREDENTIALS_JSON / GOOGLE_APPLICATION_CREDENTIALS)
// so the SDK can sign locally, or a runtime identity with the
// "iam.serviceAccounts.signBlob" permission if using attached/ambient
// credentials (e.g. Workload Identity) instead of a key file.
export async function getSignedAudioUrl(storagePath: string): Promise<string> {
  const file = getStorageClient().bucket(getBucketName()).file(storagePath);
  const [url] = await file.getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + SIGNED_URL_TTL_MS,
  });
  return url;
}

// Best-effort delete -- called whenever a course_asset row (or its parent
// course) is removed so the bucket never accumulates objects nobody can
// reach anymore and paying for orphaned storage. A missing object (already
// deleted, or never successfully uploaded) is not an error worth failing
// the surrounding request over.
export async function deleteCourseAudio(storagePath: string): Promise<void> {
  try {
    await getStorageClient().bucket(getBucketName()).file(storagePath).delete({ ignoreNotFound: true });
  } catch (err) {
    console.error(`Failed to delete course media object "${storagePath}" from storage`, err);
  }
}
