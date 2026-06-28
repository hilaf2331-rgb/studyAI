// Single Render instance, no horizontal scaling -- so a simple in-process
// semaphore is enough to cap how many heavy transcription+AI-generation
// pipelines run at once, instead of needing a real job queue (Redis/BullMQ)
// for what's ultimately one process's CPU/memory budget. Exam-period spikes
// of 10-20 simultaneous uploads now queue past this limit instead of all
// holding a 25MB+ buffer and racing Groq/Gemini concurrently, which is what
// was OOM-crashing the dyno.
const MAX_CONCURRENT_PROCESSING = Number(process.env.MAX_CONCURRENT_PROCESSING) || 3;

let available = MAX_CONCURRENT_PROCESSING;
const queue: Array<() => void> = [];

export function getQueueLength(): number {
  return queue.length;
}

// Resolves once a processing slot is free, synchronously claiming it in the
// same tick it's granted -- handing a released slot directly to the next
// waiter (rather than incrementing `available` and letting acquirers race
// for it) is what keeps this race-free without any locking.
function acquireSlot(): Promise<void> {
  return new Promise((resolve) => {
    const claim = () => {
      available--;
      resolve();
    };
    if (available > 0) claim();
    else queue.push(claim);
  });
}

function releaseSlot(): void {
  available++;
  const next = queue.shift();
  if (next) next();
}

// Runs `task` once a processing slot is available, calling `onQueued` first
// (with this caller's 1-based position) if it has to wait at all. Always
// releases its slot, even if `task` throws.
export async function runExclusive<T>(onQueued: (queuePosition: number) => void, task: () => Promise<T>): Promise<T> {
  if (available <= 0) onQueued(queue.length + 1);
  await acquireSlot();
  try {
    return await task();
  } finally {
    releaseSlot();
  }
}
