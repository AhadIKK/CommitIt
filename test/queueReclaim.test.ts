import { beforeEach, describe, expect, it, vi } from "vitest";

// Lease-timeout reclaim: a job orphaned in `processing` when the instance dies
// (Render free sleep / deploy / crash) must return to the queue instead of
// sitting there forever and silently losing its event.
const updateMany = vi.fn();

vi.mock("../src/db.js", () => ({
  prisma: { job: { updateMany: (...args: unknown[]) => updateMany(...args) } },
}));

const { reclaimStuckJobs, JOB_STALE_MS } = await import("../src/queue.js");

beforeEach(() => {
  updateMany.mockReset();
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
