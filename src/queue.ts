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
  } catch {
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
      UPDATE "Job" SET status = 'processing', attempts = attempts + 1
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
