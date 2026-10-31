import { afterEach, describe, expect, it, vi } from "vitest";

const jobs: { type: string; deliveryId: string }[] = [];
let installIds: bigint[] = [77n, 88n];
let repoNames: bigint[] = [77n, 88n];

vi.mock("../src/db.js", () => ({
  prisma: {
    installation: {
      findMany: async () => installIds.map((id) => ({ id })),
    },
    repo: {
      findMany: async () => repoNames.map((installationId) => ({ installationId })),
    },
    job: {
      upsert: async (args: { create: { type: string; deliveryId: string } }) => {
        jobs.push(args.create);
        return {};
      },
    },
  },
}));

import { enqueueAutoSync, startAutoSyncScheduler, syncIntervalHours } from "../src/scheduler.js";

const log = { info: () => {}, error: () => {} };

describe("syncIntervalHours", () => {
  it("defaults to 24h and honors explicit values", () => {
    expect(syncIntervalHours(undefined)).toBe(24);
    expect(syncIntervalHours("")).toBe(24);
    expect(syncIntervalHours("  ")).toBe(24);
    expect(syncIntervalHours("6")).toBe(6);
    expect(syncIntervalHours("0")).toBe(0);
    expect(syncIntervalHours("bad")).toBe(24);
    expect(syncIntervalHours("-1")).toBe(24);
  });
});

describe("startAutoSyncScheduler", () => {
  afterEach(() => {
    delete process.env.SYNC_INTERVAL_HOURS;
    jobs.length = 0;
    installIds = [77n, 88n];
    repoNames = [77n, 88n];
  });

  it("stays off when SYNC_INTERVAL_HOURS=0", () => {
    process.env.SYNC_INTERVAL_HOURS = "0";
    expect(startAutoSyncScheduler(log)).toBeNull();
  });

  it("enqueues one idempotent backfill per installation", async () => {
    process.env.SYNC_INTERVAL_HOURS = "24";
    const timer = startAutoSyncScheduler(log, 3_600_000);
    expect(timer).not.toBeNull();
    clearInterval(timer as NodeJS.Timeout);
    await new Promise((r) => setTimeout(r, 25));
    expect(jobs.map((j) => j.type)).toEqual(["backfill", "backfill"]);
    // delivery id matches the sync-<id>- prefix uninstall cancellation uses
    expect(jobs[0]?.deliveryId).toMatch(/^sync-77-auto-\d+$/);
    expect(jobs[1]?.deliveryId).toMatch(/^sync-88-auto-\d+$/);
  });

  it("skips an installation that has no repository", async () => {
    process.env.SYNC_INTERVAL_HOURS = "24";
    installIds = [77n, 88n, 99n];

    await enqueueAutoSync(log);

    expect(jobs.map((j) => j.deliveryId)).toEqual([
      expect.stringMatching(/^sync-77-auto-\d+$/),
      expect.stringMatching(/^sync-88-auto-\d+$/),
    ]);
  });
});
