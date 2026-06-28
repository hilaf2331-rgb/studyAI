// Single Render instance, no horizontal scaling -- so a simple in-process
// semaphore is enough to cap how many heavy transcription+AI-generation
// pipelines run at once, instead of needing a real job queue (Redis/BullMQ)
// for what's ultimately one process's CPU/memory budget. Exam-period spikes
// of 10-20 simultaneous uploads now queue past this limit instead of all
// holding a 25MB+ buffer and racing Groq/Gemini concurrently, which is what
// was OOM-crashing the dyno.
const MAX_CONCURRENT_PROCESSING = Number(process.env.MAX_CONCURRENT_PROCESSING) || 3;

interface QueueEntry {
  claim: () => void;
  // Paying users (and admins) jump ahead of every still-waiting free-tier
  // entry -- see acquireSlot below -- as a marketing/retention upsell for
  // exam-period traffic spikes.
  isPriority: boolean;
}

let available = MAX_CONCURRENT_PROCESSING;
const queue: QueueEntry[] = [];

export function getQueueLength(): number {
  return queue.length;
}

// Resolves once a processing slot is free, synchronously claiming it in the
// same tick it's granted -- handing a released slot directly to the next
// waiter (rather than incrementing `available` and letting acquirers race
// for it) is what keeps this race-free without any locking.
//
// A priority entry is spliced in just ahead of the first free-tier entry
// already in line (or appended, if every other waiter is also priority),
// so paying users queue FIFO among themselves but always ahead of free
// users, while free users keep their own FIFO order behind them.
function acquireSlot(isPriority: boolean, onQueued: (queuePosition: number) => void): Promise<void> {
  return new Promise((resolve) => {
    const claim = () => {
      available--;
      resolve();
    };
    if (available > 0) {
      claim();
      return;
    }
    const entry: QueueEntry = { claim, isPriority };
    let insertAt = queue.length;
    if (isPriority) {
      const firstFreeTierIndex = queue.findIndex((e) => !e.isPriority);
      if (firstFreeTierIndex !== -1) insertAt = firstFreeTierIndex;
    }
    queue.splice(insertAt, 0, entry);
    onQueued(insertAt + 1);
  });
}

function releaseSlot(): void {
  available++;
  const next = queue.shift();
  if (next) next.claim();
}

// Runs `task` once a processing slot is available, calling `onQueued` first
// (with this caller's 1-based position) if it has to wait at all. Always
// releases its slot, even if `task` throws. Pass `isPriority: true` for
// paying users/admins so they cut ahead of free-tier waiters already queued.
export async function runExclusive<T>(
  onQueued: (queuePosition: number) => void,
  task: () => Promise<T>,
  options?: { isPriority?: boolean },
): Promise<T> {
  await acquireSlot(options?.isPriority ?? false, onQueued);
  try {
    return await task();
  } finally {
    releaseSlot();
  }
}
