import { beforeEach, describe, expect, it, vi } from "vitest";

let queue: string[] = [];
const claimed: string[] = [];
let reclaimCount = 0;
let sentCount = 0;
let staleCalls = 0;
let syncCalls = 0;
/** Ordering probe: digests must go out before the queue can eat the budget. */
let events: string[] = [];
let deadlineSeen: number | undefined;

vi.mock("../src/queue.js", () => ({
  reclaimStuckJobs: async () => reclaimCount,
  claimNextJob: async () => {
    const id = queue.shift();
    if (!id) return null;
    return {
      id,
      deliveryId: id,
      type: "push",
      payload: {},
      status: "queued",
      attempts: 0,
      nextRetryAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  },
}));

vi.mock("../src/worker.js", () => ({
  runClaimedJob: async (job: { id: string }, _log: unknown, opts?: { deadline?: number }) => {
    events.push(`job:${job.id}`);
    deadlineSeen = opts?.deadline;
    claimed.push(job.id);
  },
}));

vi.mock("../src/delivery.js", () => ({
  dispatchDueNotifications: async () => {
    events.push("digests");
    return sentCount;
  },
}));

vi.mock("../src/scheduler.js", () => ({
  enqueueStaleChecks: async () => {
    staleCalls += 1;
  },
  enqueueAutoSync: async () => {
    syncCalls += 1;
  },
}));

import { runWorkerTick } from "../src/workerTick.js";

const log = { info: () => {}, error: () => {} };

beforeEach(() => {
  queue = [];
  claimed.length = 0;
  reclaimCount = 0;
  sentCount = 0;
  staleCalls = 0;
  syncCalls = 0;
  events = [];
  deadlineSeen = undefined;
});

describe("runWorkerTick", () => {
  it("drains the queue, then reports what it did", async () => {
    queue = ["a", "b", "c"];
    sentCount = 2;

    const result = await runWorkerTick(log);

    expect(claimed).toEqual(["a", "b", "c"]);
    expect(result).toMatchObject({ jobs: 3, sent: 2, stoppedEarly: false });
    // Both schedulers run on every tick; they are no-ops inside their window.
    expect(staleCalls).toBe(1);
    expect(syncCalls).toBe(1);
  });

  it("sends due digests even when the queue is empty", async () => {
    sentCount = 1;

    const result = await runWorkerTick(log);

    expect(claimed).toEqual([]);
    expect(result).toMatchObject({ jobs: 0, sent: 1, stoppedEarly: false });
  });

  it("sends digests before draining, so a long job cannot delay them", async () => {
    queue = ["a", "b"];

    await runWorkerTick(log);

    expect(events[0]).toBe("digests");
    expect(events.slice(1)).toEqual(["job:a", "job:b"]);
  });

  it("reclaims orphaned jobs before claiming, and reports the count", async () => {
    reclaimCount = 4;
    queue = ["a"];

    const result = await runWorkerTick(log);

    expect(result.reclaimed).toBe(4);
    expect(claimed).toEqual(["a"]);
  });

  it("stops at the job cap and says so, leaving the rest for the next tick", async () => {
    queue = ["a", "b", "c", "d"];

    const result = await runWorkerTick(log, { maxJobs: 2 });

    expect(claimed).toEqual(["a", "b"]);
    expect(result).toMatchObject({ jobs: 2, stoppedEarly: true });
  });

  it("stops when the time budget is gone", async () => {
    queue = ["a", "b"];

    const result = await runWorkerTick(log, { budgetMs: 0 });

    expect(claimed).toEqual([]);
    expect(result).toMatchObject({ jobs: 0, stoppedEarly: true });
  });

  it("hands each job a deadline inside the budget, so it can stop and resume", async () => {
    queue = ["a"];

    const before = Date.now();
    await runWorkerTick(log, { budgetMs: 5_000 });

    expect(deadlineSeen).toBeGreaterThanOrEqual(before);
    expect(deadlineSeen).toBeLessThanOrEqual(Date.now() + 5_000);
  });
});
