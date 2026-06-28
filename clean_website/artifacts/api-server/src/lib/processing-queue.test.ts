import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// processing-queue.ts reads MAX_CONCURRENT_PROCESSING from the environment
// at module-load time, so every test resets modules and re-imports after
// setting the env var, to get a fresh queue pinned to a known concurrency
// limit (3, matching production's default) instead of sharing state across
// tests or depending on whatever happened to be set in the shell.
function createDeferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function flushMicrotasks() {
  await new Promise((r) => setTimeout(r, 0));
}

describe("processing-queue", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.MAX_CONCURRENT_PROCESSING = "3";
  });

  afterEach(() => {
    delete process.env.MAX_CONCURRENT_PROCESSING;
  });

  it("runs at most 3 jobs concurrently out of 10 simultaneous requests", async () => {
    const { runExclusive, getQueueLength } = await import("./processing-queue");

    let active = 0;
    let maxActive = 0;
    const started: number[] = [];
    const deferreds = Array.from({ length: 10 }, () => createDeferred<void>());

    const runs = deferreds.map((d, i) =>
      runExclusive(
        () => {},
        async () => {
          active++;
          maxActive = Math.max(maxActive, active);
          started.push(i);
          await d.promise;
          active--;
        },
      ),
    );

    await flushMicrotasks();
    // Exactly 3 slots, so 3 jobs running and 7 waiting behind them.
    expect(active).toBe(3);
    expect(maxActive).toBe(3);
    expect(getQueueLength()).toBe(7);

    // Release jobs one at a time; concurrency must never exceed 3, and the
    // queue must drain by exactly one entry each time a slot frees up.
    for (let i = 0; i < 10; i++) {
      deferreds[i].resolve();
      await flushMicrotasks();
      expect(active).toBeLessThanOrEqual(3);
    }

    await Promise.all(runs);
    expect(started.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(maxActive).toBe(3);
    expect(getQueueLength()).toBe(0);
  });

  it("reports correct 1-based queue positions in FIFO order for free-tier jobs", async () => {
    const { runExclusive } = await import("./processing-queue");

    const deferreds = Array.from({ length: 10 }, () => createDeferred<void>());
    const positions: Array<number | undefined> = new Array(10);

    const runs = deferreds.map((d, i) =>
      runExclusive(
        (queuePosition) => {
          positions[i] = queuePosition;
        },
        async () => {
          await d.promise;
        },
      ),
    );

    await flushMicrotasks();
    // The first 3 requests claim a slot immediately, so onQueued is never
    // called for them -- only requests 4-10 (indices 3-9) actually wait.
    expect(positions.slice(0, 3)).toEqual([undefined, undefined, undefined]);
    expect(positions.slice(3)).toEqual([1, 2, 3, 4, 5, 6, 7]);

    deferreds.forEach((d) => d.resolve());
    await Promise.all(runs);
  });

  it("lets paying users jump ahead of free-tier jobs already waiting", async () => {
    const { runExclusive } = await import("./processing-queue");

    const order: string[] = [];

    // Fill all 3 slots with long-running free-tier jobs so every later
    // submission has to queue behind them.
    const blockers = Array.from({ length: 3 }, () => createDeferred<void>());
    const blockerRuns = blockers.map((d) => runExclusive(() => {}, () => d.promise));
    await flushMicrotasks();

    // 4 more free-tier jobs queue up FIFO, at positions 1-4.
    const freeDeferreds = Array.from({ length: 4 }, () => createDeferred<void>());
    const freeRuns = freeDeferreds.map((d, i) =>
      runExclusive(
        () => {},
        async () => {
          order.push(`free-${i}`);
          await d.promise;
        },
      ),
    );
    await flushMicrotasks();

    // 2 paying users submit after those 4 free jobs are already queued.
    const payDeferreds = Array.from({ length: 2 }, () => createDeferred<void>());
    const payPositions: number[] = [];
    const payRuns = payDeferreds.map((d, i) =>
      runExclusive(
        (pos) => payPositions.push(pos),
        async () => {
          order.push(`pay-${i}`);
          await d.promise;
        },
        { isPriority: true },
      ),
    );
    await flushMicrotasks();

    // Both paying jobs jump straight to positions 1 and 2, ahead of all 4
    // free-tier jobs that were already waiting.
    expect(payPositions).toEqual([1, 2]);

    // Free up the 3 blocked slots -- the next 3 jobs to start should be the
    // 2 paying jobs first, then the first free-tier job, not free-0..2.
    blockers.forEach((d) => d.resolve());
    await flushMicrotasks();
    expect(order).toEqual(["pay-0", "pay-1", "free-0"]);

    freeDeferreds.forEach((d) => d.resolve());
    payDeferreds.forEach((d) => d.resolve());
    await Promise.all([...blockerRuns, ...freeRuns, ...payRuns]);
  });

  it("queues a second paying user behind the first, still ahead of free-tier jobs", async () => {
    const { runExclusive } = await import("./processing-queue");

    const blockers = Array.from({ length: 3 }, () => createDeferred<void>());
    const blockerRuns = blockers.map((d) => runExclusive(() => {}, () => d.promise));
    await flushMicrotasks();

    const firstPay = createDeferred<void>();
    const firstPayPosition: number[] = [];
    const firstPayRun = runExclusive(
      (pos) => firstPayPosition.push(pos),
      () => firstPay.promise,
      { isPriority: true },
    );
    await flushMicrotasks();
    expect(firstPayPosition).toEqual([1]);

    const freeDeferred = createDeferred<void>();
    const freePosition: number[] = [];
    const freeRun = runExclusive(
      (pos) => freePosition.push(pos),
      () => freeDeferred.promise,
    );
    await flushMicrotasks();
    expect(freePosition).toEqual([2]);

    // A second paying user splices in ahead of the already-queued free job,
    // but behind the first paying user (FIFO within the priority tier).
    const secondPay = createDeferred<void>();
    const secondPayPosition: number[] = [];
    const secondPayRun = runExclusive(
      (pos) => secondPayPosition.push(pos),
      () => secondPay.promise,
      { isPriority: true },
    );
    await flushMicrotasks();
    expect(secondPayPosition).toEqual([2]);
    expect(freePosition).toEqual([2]); // unchanged; only reported once, at queue time

    firstPay.resolve();
    secondPay.resolve();
    freeDeferred.resolve();
    blockers.forEach((d) => d.resolve());
    await Promise.all([...blockerRuns, firstPayRun, freeRun, secondPayRun]);
  });
});
