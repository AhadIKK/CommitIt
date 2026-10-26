/**
 * Seed data for the marketing site. One typed file, so the Goal Track is
 * data-driven rather than hand-drawn: every circle on the page is a task here,
 * and the totals in the copy are computed from these numbers, not typed in.
 *
 * Weight is the unit of meaning: S = 1 point, M = 3, L = 5. An unestimated
 * task counts as 1. Nothing in this file is a commit count used as progress —
 * `commitCount` exists only to render the deliberately subordinate activity line.
 */

export type Weight = "S" | "M" | "L";

export type LedgerTask = {
  id: string;
  number: number;
  title: string;
  weight: Weight;
  /** null = still open. ISO string = finished. */
  closedAt: string | null;
  /** set when the task was closed and then reopened; drives the signature moment */
  reopenedAt?: string | null;
  pr?: number | null;
};

export const WEIGHT_POINTS: Record<Weight, number> = { S: 1, M: 3, L: 5 };

/**
 * Circle RADIUS is proportional to √weight, so that AREA is proportional to
 * weight. Scaling by diameter is the common mistake and it makes an L look
 * about twice as heavy as an M when it is really five thirds as heavy.
 */
export const radiusFor = (w: Weight): number => {
  const k = 9;
  return k * Math.sqrt(WEIGHT_POINTS[w]);
};

/**
 * Closing order: finished tasks by when they closed, then everything that is not
 * currently finished.
 *
 * A reopened task counts as NOT finished, so it sorts to the open end. That is
 * the whole point: a task that was merged and then reopened must give its points
 * back rather than sit in the middle of the track still claiming them.
 */
export function closingOrder(tasks: LedgerTask[]): LedgerTask[] {
  return [...tasks].sort((a, b) => {
    const at = a.reopenedAt
      ? Number.POSITIVE_INFINITY
      : a.closedAt
        ? Date.parse(a.closedAt)
        : Number.POSITIVE_INFINITY;
    const bt = b.reopenedAt
      ? Number.POSITIVE_INFINITY
      : b.closedAt
        ? Date.parse(b.closedAt)
        : Number.POSITIVE_INFINITY;
    if (at !== bt) return at - bt;
    return a.number - b.number;
  });
}

export function isFinished(t: LedgerTask): boolean {
  return t.closedAt !== null && !t.reopenedAt;
}

export function pointsOf(t: LedgerTask): number {
  return WEIGHT_POINTS[t.weight];
}

export type LedgerTotals = {
  closedPoints: number;
  totalPoints: number;
  commitCount: number;
  /** the reopened task's weight, which is what the track gives back */
  reopenedPoints: number;
};

export function totals(tasks: LedgerTask[], commitCount: number): LedgerTotals {
  let closedPoints = 0;
  let totalPoints = 0;
  let reopenedPoints = 0;
  for (const t of tasks) {
    const p = pointsOf(t);
    totalPoints += p;
    if (isFinished(t)) closedPoints += p;
    if (t.reopenedAt) reopenedPoints += p;
  }
  return { closedPoints, totalPoints, commitCount, reopenedPoints };
}

/**
 * Fourteen tasks, a believable milestone: mostly small work with a few large
 * pieces, one L that was merged and then reopened the day before — which is
 * exactly the case the product exists to be honest about.
 */
export const TASKS: LedgerTask[] = [
  { id: "t01", number: 12, title: "Login form with inline validation", weight: "M", closedAt: "2026-10-06T09:12:00Z", pr: 41 },
  { id: "t02", number: 13, title: "Session store swap behind an interface", weight: "L", closedAt: "2026-10-06T16:40:00Z", pr: 42 },
  { id: "t03", number: 14, title: "Cover the auth middleware with three cases", weight: "S", closedAt: "2026-10-07T10:05:00Z", pr: 43 },
  { id: "t04", number: 15, title: "Refresh tokens without a silent logout", weight: "M", closedAt: "2026-10-08T11:20:00Z", pr: 44 },
  { id: "t05", number: 16, title: "Health route rewrite", weight: "L", closedAt: "2026-10-09T14:02:00Z", pr: 45 },
  { id: "t06", number: 17, title: "Session store", weight: "L", closedAt: "2026-10-09T14:02:00Z", reopenedAt: "2026-10-15T08:30:00Z", pr: 46 },
  { id: "t07", number: 18, title: "Rate limit the webhook", weight: "S", closedAt: "2026-10-10T09:44:00Z" },
  { id: "t08", number: 19, title: "Idempotency key on the delivery table", weight: "M", closedAt: "2026-10-10T15:18:00Z", pr: 47 },
  { id: "t09", number: 20, title: "Fix a typo in the readme", weight: "S", closedAt: "2026-10-11T08:02:00Z" },
  { id: "t10", number: 21, title: "Requeue jobs orphaned by a killed worker", weight: "M", closedAt: "2026-10-11T13:26:00Z", pr: 48 },
  { id: "t11", number: 22, title: "Digest renderer: cap at 3800 characters", weight: "S", closedAt: "2026-10-12T10:11:00Z", pr: 49 },
  { id: "t12", number: 23, title: "Link commits to issues in closing order", weight: "L", closedAt: "2026-10-13T17:55:00Z", pr: 50 },
  { id: "t13", number: 24, title: "Dashboard reads the weight from the label", weight: "M", closedAt: null },
  { id: "t14", number: 25, title: "Quiet hours for group chats", weight: "S", closedAt: null },
];

export const COMMIT_COUNT = 412;

/** The raw commit lines that collapse into one digest in §5. */
export const RAW_COMMITS: string[] = [
  "feat: login form with inline validation",
  "fix: null guard in the session reader",
  "chore: bump the lockfile",
  "test: cover the auth middleware",
  "refactor: split the verification step out",
  "docs: describe the auth flow",
  "fix: typo in the readme",
  "feat: attach the user to the request",
  "chore: wire up config",
  "perf: cache the token lookup",
  "fix: handle a missing header",
  "test: expired token case",
  "refactor: rename the store module",
  "chore: remove dead code",
  "feat: refresh token rotation",
  "fix: race in the session store",
  "docs: add a runbook",
  "test: valid token case",
  "chore: update the action",
  "fix: typo again",
  "refactor: drop the wrapper",
  "feat: sign the webhook",
  "fix: rate limit counter",
  "chore: tidy the imports",
  "test: idempotent delivery",
  "perf: trim the payload",
  "fix: timezone in the digest",
  "docs: note the quiet hours",
  "feat: group by author",
  "chore: pin the runner",
  "fix: null guard, again",
  "test: the burst case",
  "refactor: extract the formatter",
  "chore: lint fixes",
  "feat: telegram send",
  "fix: quiet hours boundary",
  "docs: screenshots",
  "chore: dependency bump",
  "test: the collapsed digest",
  "fix: digest ordering",
  "feat: reopen detection",
  "chore: cleanup",
  "test: weight arithmetic",
];

/** The eleven pipeline stations, drawn as one ledger line rather than a flowchart. */
export const PIPELINE: { label: string; note?: string }[] = [
  { label: "webhook" },
  { label: "hmac verify", note: "§ 3" },
  { label: "rate limit" },
  { label: "idempotent enqueue" },
  { label: "worker" },
  { label: "scan", note: "§ 7" },
  { label: "trim" },
  { label: "classify" },
  { label: "summarize" },
  { label: "link" },
  { label: "telegram" },
];
