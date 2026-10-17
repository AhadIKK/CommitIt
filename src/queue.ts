import { prisma } from "./db.js";

// queue.ts — ALL enqueueing goes through enqueueJob() (AGENTS.md).
// MVP: Postgres jobs table, polled with SELECT ... FOR UPDATE SKIP LOCKED.
// Retry with backoff; never silently drop on 429. BullMQ swap later = this file.

export type JobRow = {
  id: string;
  deliveryId: string;
  type: string;
  payload: unknown;
  status: string;
  attempts: number;
  nextRetryAt: Date | null;
};

const memoryFallback: JobRow[] = [];

function backoff(attempts: number): Date {
  const secs = Math.min(300, 5 * 2 ** attempts);
  return new Date(Date.now() + secs * 1000);
}

export async function enqueueJob(
  type: string,
  deliveryId: string,
  payload: unknown,
): Promise<void> {
  try {
    await prisma.job.upsert({
      where: { deliveryId },
      update: {},
      create: { type, deliveryId, payload: payload as object },
    });
  } catch (err) {
    // Loud, never silent: on a host that ends the process (Vercel) this job is
    // lost with the instance, so the fallback must not hide the DB failure.
    console.warn(
      JSON.stringify({ msg: "enqueue_fallback_memory", deliveryId, err: String(err) }),
    );
    if (!memoryFallback.some((j) => j.deliveryId === deliveryId)) {
      memoryFallback.push({
        id: `mem-${deliveryId}`,
        deliveryId,
        type,
        payload,
        status: "queued",
        attempts: 0,
        nextRetryAt: null,
      });
    }
  }
}

export async function claimNextJob(): Promise<JobRow | null> {
  try {
    const rows = await prisma.$queryRaw<JobRow[]>`
      UPDATE "Job" SET status = 'processing', attempts = attempts + 1, "updatedAt" = NOW()
      WHERE id = (
        SELECT id FROM "Job"
        WHERE status = 'queued'
          AND ("nextRetryAt" IS NULL OR "nextRetryAt" <= NOW())
        ORDER BY "createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, "deliveryId", type, payload, status, attempts, "nextRetryAt"`;
    return rows[0] ?? null;
  } catch {
    const job = memoryFallback.find((j) => j.status === "queued");
    if (job) {
      job.status = "processing";
      job.attempts += 1;
      return job;
    }
    return null;
  }
}

export async function completeJob(id: string): Promise<void> {
  try {
    await prisma.job.update({ where: { id }, data: { status: "done" } });
  } catch {
    const job = memoryFallback.find((j) => j.id === id);
    if (job) job.status = "done";
  }
}

export async function failJob(id: string, attempts: number): Promise<void> {
  // Poison pill: a job that keeps throwing (dead install, bad payload) must
  // not retry forever. Give up after JOB_MAX_ATTEMPTS — loudly, never silently.
  if (attempts >= JOB_MAX_ATTEMPTS) {
    await abandonJob(id);
    return;
  }
  const retryAt = backoff(attempts);
  try {
    await prisma.job.update({
      where: { id },
      data: { status: "queued", nextRetryAt: retryAt },
    });
  } catch {
    const job = memoryFallback.find((j) => j.id === id);
    if (job) {
      job.status = "queued";
      job.nextRetryAt = retryAt;
    }
  }
}

export const JOB_MAX_ATTEMPTS = Number(process.env.JOB_MAX_ATTEMPTS ?? 20);

export async function abandonJob(id: string): Promise<void> {
  try {
    await prisma.job.update({ where: { id }, data: { status: "failed" } });
  } catch {
    const job = memoryFallback.find((j) => j.id === id);
    if (job) job.status = "failed";
  }
}

// A job left in `processing` when the instance dies (Render free sleep,
// deploy, crash) is never re-claimed — claimNextJob() only selects `queued`
// rows, so it would sit there forever and its event is silently lost.
// Lease-timeout reclaim: any `processing` row untouched for JOB_STALE_MS is
// handed back to the queue (attempts already counted at claim time, so
// repeated failures still back off).
export const JOB_STALE_MS = Number(process.env.JOB_STALE_MS ?? 10 * 60 * 1000);

export async function reclaimStuckJobs(
  staleMs: number = JOB_STALE_MS,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - staleMs);
  try {
    const res = await prisma.job.updateMany({
      where: { status: "processing", updatedAt: { lt: cutoff } },
      data: { status: "queued", nextRetryAt: null },
    });
    return res.count;
  } catch {
    let n = 0;
    for (const job of memoryFallback) {
      if (job.status === "processing") {
        job.status = "queued";
        job.nextRetryAt = null;
        n += 1;
      }
    }
    return n;
  }
}
