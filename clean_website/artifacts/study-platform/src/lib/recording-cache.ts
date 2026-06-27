// Native IndexedDB wrapper (no extra dependency) that durably caches a
// just-stopped recording's audio Blob before the upload pipeline runs, so a
// network/server failure during upload never loses the take -- the "נסה
// שנית" retry path reads from here instead of forcing a re-record.

const DB_NAME = "focusstudy-recorder";
const DB_VERSION = 1;
const STORE_NAME = "pending-recording";
const RECORD_KEY = "current";

export interface CachedRecording {
  blob: Blob;
  title: string;
  courseId: string;
  elapsed: number;
  recordedAt: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveCachedRecording(record: CachedRecording): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(record, RECORD_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Local caching is a best-effort safety net, not the source of truth --
    // a failure here must never block the actual upload attempt.
  }
}

export async function getCachedRecording(): Promise<CachedRecording | null> {
  try {
    const db = await openDb();
    const result = await new Promise<CachedRecording | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(RECORD_KEY);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return result;
  } catch {
    return null;
  }
}

export async function clearCachedRecording(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(RECORD_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Nothing to do if clearing fails -- worst case a stale entry is
    // overwritten by the next recording's cache write.
  }
}
