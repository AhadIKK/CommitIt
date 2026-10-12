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
