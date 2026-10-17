import { beforeEach, describe, expect, it, vi } from "vitest";

// Lease-timeout reclaim + bounded retry: a job orphaned in `processing` when
// the instance dies (Render free sleep / deploy / crash) must return to the
// queue instead of sitting there forever; a job that keeps throwing must stop
// retrying instead of looping forever.
const updateMany = vi.fn();
const update = vi.fn();

vi.mock("../src/db.js", () => ({
  prisma: {
    job: {
      updateMany: (...args: unknown[]) => updateMany(...args),
      update: (...args: unknown[]) => update(...args),
    },
  },
}));

const { reclaimStuckJobs, failJob, abandonJob, JOB_STALE_MS, JOB_MAX_ATTEMPTS } =
  await import("../src/queue.js");

beforeEach(() => {
  updateMany.mockReset();
  update.mockReset();
});

describe("reclaimStuckJobs", () => {
  it("requeues only processing rows past the lease, clearing nextRetryAt", async () => {
    updateMany.mockResolvedValue({ count: 3 });
    const now = new Date("2026-10-17T12:00:00.000Z");

    await expect(reclaimStuckJobs(JOB_STALE_MS, now)).resolves.toBe(3);

    expect(updateMany).toHaveBeenCalledTimes(1);
    const arg = updateMany.mock.calls[0]![0] as {
      where: { status: string; updatedAt: { lt: Date } };
      data: { status: string; nextRetryAt: null };
    };
    expect(arg.where.status).toBe("processing");
    expect(arg.data).toEqual({ status: "queued", nextRetryAt: null });
    // cutoff is exactly now - staleMs
    expect(arg.where.updatedAt.lt.getTime()).toBe(now.getTime() - JOB_STALE_MS);
  });

  it("never touches queued or done rows (status filter is exact)", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    await reclaimStuckJobs();
    const arg = updateMany.mock.calls[0]![0] as { where: { status: string } };
    expect(arg.where.status).toBe("processing");
  });

  it("returns 0 instead of throwing when the DB is unreachable", async () => {
    updateMany.mockRejectedValue(new Error("db down"));
    await expect(reclaimStuckJobs()).resolves.toBe(0);
  });

  it("defaults to a 10 minute lease", () => {
    expect(JOB_STALE_MS).toBe(600_000);
  });
});

describe("failJob retry policy", () => {
  it("requeues with an explicit backoff before the cap", async () => {
    update.mockResolvedValue({});
    await failJob("j1", 2);
    const arg = update.mock.calls[0]![0] as {
      where: { id: string };
      data: { status: string; nextRetryAt: Date };
    };
    expect(arg.where.id).toBe("j1");
    expect(arg.data.status).toBe("queued");
    expect(arg.data.nextRetryAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("abandons (status failed) at the attempt cap instead of looping forever", async () => {
    update.mockResolvedValue({});
    await failJob("poison", JOB_MAX_ATTEMPTS);
    const arg = update.mock.calls[0]![0] as { data: { status: string; nextRetryAt?: Date } };
    expect(arg.data.status).toBe("failed");
    // never rescheduled — a cap that still requeues would be an infinite loop
    expect(arg.data.nextRetryAt).toBeUndefined();
  });

  it("abandonJob marks failed without rescheduling", async () => {
    update.mockResolvedValue({});
    await abandonJob("j9");
    expect(update.mock.calls[0]![0]).toEqual({
      where: { id: "j9" },
      data: { status: "failed" },
    });
  });

  it("swallows DB errors on abandon (never throws into the worker loop)", async () => {
    update.mockRejectedValue(new Error("db down"));
    await expect(abandonJob("j9")).resolves.toBeUndefined();
  });
});
