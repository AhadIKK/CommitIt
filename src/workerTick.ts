/**
 * One bounded pass of the worker, callable from an HTTP request.
 *
 * The worker used to be a 5-second interval inside a long-lived process on a
 * host that slept between visits. Nothing about the work needs that process:
 * the queue is claimed with `SELECT … FOR UPDATE SKIP LOCKED`, and both
 * schedulers key their enqueues by day/bucket. So the same steps run from a
 * single call, and Supabase pg_cron calls `POST /api/worker/tick` once a minute
 * (see prisma/sql/worker-tick-cron.sql).
 *
 * Overlap is impossible by construction: the function is capped at 45 s
 * (vercel.json) and the schedule fires every 60 s, so a tick is always finished
 * before the next one starts. That matters because `dispatchDueNotifications`
 * is not itself atomic — two ticks running at once could send the same digest
 * twice. The residual risk is a tick that is killed mid-send, which would send
 * that one digest again on the next tick; a 30 s budget keeps the drain well
 * inside the cap.
 *
 * Work that cannot fit in one call is the remaining problem, and it is handled
 * per job: every job gets the tick's deadline, and a job that would overrun it
 * stops between units and continues as a fresh job (a backfill carries its repo
 * cursor in the payload). Nothing is lost, and the next tick picks it up.
 */
import { dispatchDueNotifications } from "./delivery.js";
import { claimNextJob, reclaimStuckJobs } from "./queue.js";
import { enqueueAutoSync, enqueueStaleChecks } from "./scheduler.js";
import { runClaimedJob, type WorkerLog } from "./worker.js";

export type WorkerTickResult = {
  /** Jobs that were orphaned `processing` rows and went back to the queue. */
  reclaimed: number;
  /** Jobs claimed and run in this pass. */
  jobs: number;
  /** Digest messages sent in this pass. */
  sent: number;
  /** True when the pass stopped on its budget/job cap with work possibly left. */
  stoppedEarly: boolean;
};

/** Leave headroom inside the function's 45 s cap for the response. */
export const TICK_BUDGET_MS = 30_000;
/** A tick drains in batches; the next minute picks up anything left. */
export const TICK_MAX_JOBS = 10;

export async function runWorkerTick(
  log: WorkerLog,
  opts: { budgetMs?: number; maxJobs?: number } = {},
): Promise<WorkerTickResult> {
  const budgetMs = opts.budgetMs ?? TICK_BUDGET_MS;
  const maxJobs = opts.maxJobs ?? TICK_MAX_JOBS;
  // Everything below shares one deadline, so a job that is still running when
  // the budget is gone can stop between units instead of being killed mid-way.
  const deadline = Date.now() + budgetMs;

  // A tick that was killed mid-job (deploy, timeout) leaves the row
  // `processing`; nothing else would ever pick it up.
  const reclaimed = await reclaimStuckJobs();
  if (reclaimed > 0) log.info({ count: reclaimed }, "jobs_reclaimed_stale");

  // Digests first: they are the time-sensitive part (a digest is "on time"
  // because of this call, not because of the next push), and a long job must
  // never push them past their slot.
  const sent = await dispatchDueNotifications();
  if (sent > 0) log.info({ digests: sent }, "digests_sent");

  // Both are no-ops unless their window is new (day / SYNC_INTERVAL_HOURS), so
  // the work they enqueue is picked up by the drain right below.
  await enqueueStaleChecks(log);
  await enqueueAutoSync(log);

  let jobs = 0;
  let stoppedEarly = false;
  for (;;) {
    if (jobs >= maxJobs || Date.now() >= deadline) {
      stoppedEarly = true;
      break;
    }
    const job = await claimNextJob();
    if (!job) break;
    await runClaimedJob(job, log, { deadline });
    jobs += 1;
  }

  return { reclaimed, jobs, sent, stoppedEarly };
}
