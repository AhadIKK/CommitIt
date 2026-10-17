// scheduler.ts — digest batching + quiet hours.
// Quiet hours reschedule (not drop). Pure helpers; persistence via
// notifications table (status queued/sent/skipped_quiet_hours/failed).
import { enqueueJob } from "./queue.js";

export function inQuietHours(
  now: Date,
  start: string | null | undefined,
  end: string | null | undefined,
): boolean {
  if (!start || !end) return false;
  const h = now.getUTCHours() + now.getUTCMinutes() / 60;
  const s = Number(start.split(":")[0]) ?? 0;
  const e = Number(end.split(":")[0]) ?? 0;
  if (s <= e) return h >= s && h < e;
  return h >= s || h < e; // overnight window
}

export function nextDigestAt(mode: string, now: Date): Date {
  const d = new Date(now);
  switch (mode) {
    case "instant":
      return d;
    case "hourly":
      d.setUTCMinutes(0, 0, 0);
      d.setUTCHours(d.getUTCHours() + 1);
      return d;
    case "weekly":
      d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7));
      d.setUTCHours(8, 0, 0, 0);
      return d;
    case "daily":
    default:
      d.setUTCDate(d.getUTCDate() + 1);
      d.setUTCHours(8, 0, 0, 0);
      return d;
  }
}

// End of the quiet window containing `now`. Same-day windows end today;
// overnight windows end tomorrow when `now` is on the evening side.
export function quietEndsAt(now: Date, start: string, end: string): Date {
  const d = new Date(now);
  const [eh = 0, em = 0] = end.split(":").map(Number);
  d.setUTCHours(eh, em, 0, 0);
  const h = now.getUTCHours() + now.getUTCMinutes() / 60;
  const s = Number(start.split(":")[0]) ?? 0;
  const e = Number(end.split(":")[0]) ?? 0;
  if (s > e && h >= s) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

const REPO_RE = /^[^/\s]+\/[^/\s]+$/;

/** Parse STALE_CHECK_REPOS (comma-separated owner/name). Pure, tested. */
export function parseStaleRepos(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => REPO_RE.test(s));
}

// Enqueues one `stale_check` job per configured repo, keyed by day so
// re-runs are idempotent (enqueueJob upserts on delivery_id). Ticks hourly
// so restarts self-correct. Returns null when unconfigured.
export function startStaleScheduler(
  log: { info: (o: object, m: string) => void; error: (o: object, m: string) => void },
  intervalMs = 3_600_000,
): NodeJS.Timeout | null {
  const repos = parseStaleRepos(process.env.STALE_CHECK_REPOS);
  if (repos.length === 0) {
    log.info({}, "STALE_CHECK_REPOS empty — stale scheduler disabled");
    return null;
  }
  const days = Number(process.env.STALE_DAYS ?? 6) || 6;
  const tick = async () => {
    const day = new Date().toISOString().slice(0, 10);
    for (const repo of repos) {
      try {
        await enqueueJob("stale_check", `stale-check:${repo}:${day}`, {
          repo,
          thresholdDays: days,
        });
      } catch (err) {
        log.error({ err, repo }, "stale enqueue failed");
      }
    }
  };
  void tick();
  const timer = setInterval(() => {
    void tick().catch((err) => log.error({ err }, "stale tick failed"));
  }, intervalMs);
  timer.unref?.();
  return timer;
}

/**
 * Interval for the automatic history re-sync, in hours. Empty/unset → 24.
 * `0` disables it; a bad value falls back to 24. Pure, tested.
 */
export function syncIntervalHours(raw?: string): number {
  if (raw === undefined || raw.trim() === "") return 24;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 24;
  return Math.floor(n);
}

/**
 * Automatic history re-sync. The install backfill is one-shot, so without
 * this a repo only ever shows pushes made after install. Every interval
 * bucket this enqueues one `backfill` job per known installation (idempotent
 * via the delivery id, so restarts and overlapping ticks never pile up). The
 * job re-runs issues + merged PRs + commit history for that install's repos.
 *
 * Runs inside the worker process (index.ts), so the same poller picks the
 * job up immediately — no wake ping needed. `sync-<id>-auto-<bucket>` also
 * matches the `sync-<id>-` prefix cancelQueuedBackfills() uses on uninstall.
 * Returns null when disabled (`SYNC_INTERVAL_HOURS=0`).
 */
export function startAutoSyncScheduler(
  log: { info: (o: object, m: string) => void; error: (o: object, m: string) => void },
  tickMs = 3_600_000,
): NodeJS.Timeout | null {
  const hours = syncIntervalHours(process.env.SYNC_INTERVAL_HOURS);
  if (hours <= 0) {
    log.info({}, "SYNC_INTERVAL_HOURS=0 — auto sync disabled");
    return null;
  }
  const bucketMs = hours * 3_600_000;
  const tick = async () => {
    let ids: bigint[] = [];
    try {
      const { prisma } = await import("./db.js");
      const rows = await prisma.installation.findMany({
        where: { suspendedAt: null },
        select: { id: true },
      });
      ids = rows.map((r) => r.id);
    } catch {
      return; // DB down: retry on the next tick
    }
    const bucket = Math.floor(Date.now() / bucketMs);
    for (const id of ids) {
      const sid = id.toString();
      try {
        await enqueueJob("backfill", `sync-${sid}-auto-${bucket}`, { installationId: sid });
      } catch (err) {
        log.error({ err, installationId: sid }, "auto-sync enqueue failed");
      }
    }
  };
  const run = () => void tick().catch((err) => log.error({ err }, "auto-sync tick failed"));
  run();
  const timer = setInterval(run, tickMs);
  timer.unref?.();
  return timer;
}
