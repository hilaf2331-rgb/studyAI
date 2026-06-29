// Thin wrapper around Google Cloud Storage (also the backing store behind
// Firebase Storage buckets) for the Course Media / audio-podcast feature.
// Audio binaries never touch Postgres -- only the storagePath/storageUrl
// this module returns gets persisted in courseAssetsTable. Credentials and
// bucket name come exclusively from environment variables (never hardcoded)
// so the same code runs unmodified across environments.
import { Storage } from "@google-cloud/storage";
import { randomUUID } from "crypto";

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
  storageUrl: string;
}

// Uploads an already-compressed audio buffer (MP3/AAC) under a per-course
// prefix so a course's media is easy to locate/bulk-delete, and makes the
// object publicly readable via a uniform bucket-level access rule (set on
// the bucket itself) rather than per-object ACLs -- the cheaper, simpler
// option for a free-tier/pay-as-you-go bucket.
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
  const storageUrl = `https://storage.googleapis.com/${getBucketName()}/${storagePath}`;
  return { storagePath, storageUrl };
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
