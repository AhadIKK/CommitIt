/**
 * App seed data. Realistic enough that every screen can be read without a
 * backend: three repos, forty tasks with a few reopened, twenty-five digests,
 * twenty alerts, three chats, six secret findings and fifty webhook deliveries.
 *
 * Two invariants hold everywhere in this file:
 *   1. `commitCount` is activity and is never used to compute points.
 *   2. A SecretFinding has a PATH and a RULE. There is no field that could
 *      hold a secret value, because the product never has one.
 */

export type Weight = "S" | "M" | "L";
export const WEIGHT_POINTS: Record<Weight, number> = { S: 1, M: 3, L: 5 };

export type Repo = {
  id: string;
  fullName: string;
  defaultBranch: string;
  connected: boolean;
  pointsFinished: number;
  pointsTotal: number;
  commitCount: number;
  needsDecision: number;
  lastDigest: string | null;
  health: "VERIFIED" | "CHECK";
  weights: Array<1 | 3 | 5>;
  open: Array<1 | 3 | 5>;
};

export const REPOS: Repo[] = [
  {
    id: "r_syncura",
    fullName: "syncura/syncura",
    defaultBranch: "main",
    connected: true,
    pointsFinished: 34,
    pointsTotal: 60,
    commitCount: 412,
    needsDecision: 3,
    lastDigest: "2026-10-18T09:00:00Z",
    health: "VERIFIED",
    weights: [3, 5, 3, 1, 5, 5, 1, 3, 1, 3, 1, 3, 5, 1],
    open: [3, 1],
  },
  {
    id: "r_api",
    fullName: "syncura/api",
    defaultBranch: "main",
    connected: true,
    pointsFinished: 21,
    pointsTotal: 27,
    commitCount: 188,
    needsDecision: 1,
    lastDigest: "2026-10-18T09:00:00Z",
    health: "VERIFIED",
    weights: [1, 3, 3, 5, 3, 1, 5],
    open: [3, 3],
  },
  {
    id: "r_docs",
    fullName: "acme/design-system",
    defaultBranch: "main",
    connected: false,
    pointsFinished: 0,
    pointsTotal: 0,
    commitCount: 0,
    needsDecision: 0,
    lastDigest: null,
    health: "CHECK",
    weights: [],
    open: [],
  },
];

export type Task = {
  id: string;
  repoId: string;
  number: number;
  title: string;
  weight: Weight;
  overridden?: boolean;
  state: "open" | "closed";
  closedAt: string | null;
  reopenCount: number;
  pr?: number | null;
};

export const TASKS: Task[] = [
  { id: "t01", repoId: "r_syncura", number: 12, title: "Login form with inline validation", weight: "M", state: "closed", closedAt: "2026-10-06T09:12:00Z", reopenCount: 0, pr: 41 },
  { id: "t02", repoId: "r_syncura", number: 13, title: "Session store behind an interface", weight: "L", state: "closed", closedAt: "2026-10-06T16:40:00Z", reopenCount: 0, pr: 42 },
  { id: "t03", repoId: "r_syncura", number: 14, title: "Cover the auth middleware", weight: "S", state: "closed", closedAt: "2026-10-07T10:05:00Z", reopenCount: 0, pr: 43 },
  { id: "t04", repoId: "r_syncura", number: 15, title: "Refresh tokens without a silent logout", weight: "M", state: "closed", closedAt: "2026-10-08T11:20:00Z", reopenCount: 0, pr: 44 },
  { id: "t05", repoId: "r_syncura", number: 16, title: "Health route rewrite", weight: "L", state: "closed", closedAt: "2026-10-09T14:02:00Z", reopenCount: 0, pr: 45 },
  { id: "t06", repoId: "r_syncura", number: 17, title: "Session store rollback", weight: "L", state: "open", closedAt: null, reopenCount: 1, pr: 46 },
  { id: "t07", repoId: "r_syncura", number: 18, title: "Rate limit the webhook", weight: "S", state: "closed", closedAt: "2026-10-10T09:44:00Z", reopenCount: 0, pr: null },
  { id: "t08", repoId: "r_syncura", number: 19, title: "Idempotency key on delivery", weight: "M", state: "closed", closedAt: "2026-10-10T15:18:00Z", reopenCount: 0, pr: 47 },
  { id: "t09", repoId: "r_syncura", number: 20, title: "Requeue orphaned jobs", weight: "M", state: "closed", closedAt: "2026-10-11T13:26:00Z", reopenCount: 0, pr: 48 },
  { id: "t10", repoId: "r_syncura", number: 21, title: "Digest renderer 3800-char cap", weight: "S", state: "closed", closedAt: "2026-10-12T10:11:00Z", reopenCount: 0, pr: 49 },
  { id: "t11", repoId: "r_syncura", number: 22, title: "Link commits in closing order", weight: "L", state: "closed", closedAt: "2026-10-13T17:55:00Z", reopenCount: 0, pr: 50 },
  { id: "t12", repoId: "r_syncura", number: 23, title: "Dashboard reads weight from label", weight: "M", state: "open", closedAt: null, reopenCount: 0, pr: null },
  { id: "t13", repoId: "r_syncura", number: 24, title: "Quiet hours for group chats", weight: "S", state: "open", closedAt: null, reopenCount: 0, pr: null },
  { id: "t14", repoId: "r_syncura", number: 25, title: "Token purge on disconnect", weight: "S", overridden: true, state: "closed", closedAt: "2026-10-14T08:30:00Z", reopenCount: 0, pr: 51 },
  { id: "t15", repoId: "r_api", number: 4, title: "Cursor pagination on the issues read", weight: "M", state: "closed", closedAt: "2026-10-09T10:00:00Z", reopenCount: 0, pr: 12 },
  { id: "t16", repoId: "r_api", number: 5, title: "Backfill commit history", weight: "L", state: "closed", closedAt: "2026-10-10T12:00:00Z", reopenCount: 0, pr: 13 },
  { id: "t17", repoId: "r_api", number: 6, title: "ETag guard on sync", weight: "M", state: "closed", closedAt: "2026-10-11T09:20:00Z", reopenCount: 0, pr: 14 },
  { id: "t18", repoId: "r_api", number: 7, title: "Delete a repo from GitHub", weight: "L", state: "closed", closedAt: "2026-10-14T11:00:00Z", reopenCount: 0, pr: 15 },
  { id: "t19", repoId: "r_api", number: 8, title: "Document the 403 case", weight: "S", state: "closed", closedAt: "2026-10-15T08:00:00Z", reopenCount: 0, pr: null },
  { id: "t20", repoId: "r_api", number: 9, title: "Rate-limit the backoff", weight: "M", state: "closed", closedAt: "2026-10-16T09:00:00Z", reopenCount: 0, pr: 16 },
  { id: "t21", repoId: "r_api", number: 10, title: "Sleep-safe worker claim", weight: "M", state: "open", closedAt: null, reopenCount: 0, pr: null },
  { id: "t22", repoId: "r_api", number: 11, title: "Queue depth metric", weight: "S", state: "open", closedAt: null, reopenCount: 0, pr: null },
];

/* Progress is derived, never authored.
   The repo rows above carry hand-written numbers for readability, but the
   invariant that matters is that progress always equals the sum of finished
   task weights — so it is recomputed from TASKS here. Authoring both means
   they eventually disagree, and when they do the headline number lies. */
for (const repo of REPOS) {
  const tasks = TASKS.filter((t) => t.repoId === repo.id);
  const finished = tasks.filter((t) => t.closedAt !== null && t.reopenCount === 0);
  const open = tasks.filter((t) => t.closedAt === null);

  repo.weights = finished.map((t) => WEIGHT_POINTS[t.weight] as 1 | 3 | 5);
  repo.open = open.map((t) => WEIGHT_POINTS[t.weight] as 1 | 3 | 5);
  repo.pointsFinished = repo.weights.reduce((a, b) => a + b, 0);
  repo.pointsTotal = [...repo.weights, ...repo.open].reduce((a, b) => a + b, 0);
  repo.needsDecision = tasks.filter(
    (t) => t.reopenCount > 0 || t.overridden === true,
  ).length;
}

export type DigestStatus = "DELIVERED" | "BATCHED" | "RESCHEDULED" | "FAILED";
export type Digest = {
  id: string;
  repoId: string;
  chatTitle: string;
  sentAt: string;
  cadence: "instant" | "hourly" | "daily";
  pointsFinished: number;
  status: DigestStatus;
  messageCount: number;
  needsDecision: number;
};

export const DIGESTS: Digest[] = Array.from({ length: 25 }, (_, i) => {
  const r = REPOS[i % 2]!;
  const status: DigestStatus =
    i === 7 ? "FAILED" : i % 6 === 3 ? "RESCHEDULED" : i % 3 === 0 ? "BATCHED" : "DELIVERED";
  const day = 18 - Math.floor(i / 2);
  return {
    id: `d${String(i + 1).padStart(2, "0")}`,
    repoId: r.id,
    chatTitle: i % 4 === 0 ? "syncura · team" : "syncura · dm",
    sentAt: `2026-10-${String(day).padStart(2, "0")}T09:00:00Z`,
    cadence: i % 5 === 0 ? "hourly" : "daily",
    pointsFinished: [8, 0, 3, 0, 11, 0][i % 6]!,
    status,
    messageCount: i % 3 === 0 ? 4 : 1,
    needsDecision: i % 4 === 0 ? 1 : 0,
  };
});

export type AlertKind =
  | "PR opened"
  | "PR merged"
  | "CI failed"
  | "CI recovered"
  | "Stale branch"
  | "Force-push";

export type Alert = {
  id: string;
  kind: AlertKind;
  repoId: string;
  actor: string;
  at: string;
  detail: string;
  delivered: boolean;
};

export const ALERTS: Alert[] = Array.from({ length: 20 }, (_, i) => {
  const kinds: AlertKind[] = [
    "PR merged",
    "CI failed",
    "PR opened",
    "Stale branch",
    "CI recovered",
    "Force-push",
  ];
  return {
    id: `a${String(i + 1).padStart(2, "0")}`,
    kind: kinds[i % 6]!,
    repoId: REPOS[i % 2]!.id,
    actor: ["ahadikk", "fizan", "dependabot", "renovate"][i % 4]!,
    at: `2026-10-${String(18 - Math.floor(i / 3)).padStart(2, "0")}T${String(9 + (i % 9)).padStart(2, "0")}:00:00Z`,
    detail: [
      "merged PR #50 · chore: drop the old route",
      "build #1142 failed on main",
      "opened PR #52 · fix: null guard in the reader",
      "feat/session-store · no activity 11d",
      "build #1143 back to green",
      "main rewritten · excluded from activity",
    ][i % 6]!,
    delivered: i % 5 !== 0,
  };
});

export type Chat = {
  id: string;
  title: string;
  kind: "group" | "dm";
  members: number | null;
  linkedRepos: number;
  lastMessage: string | null;
  status: "VERIFIED" | "CHECK";
};

export const CHATS: Chat[] = [
  { id: "c1", title: "syncura · team", kind: "group", members: 14, linkedRepos: 2, lastMessage: "2026-10-18T09:00:00Z", status: "VERIFIED" },
  { id: "c2", title: "syncura · dm", kind: "dm", members: 1, linkedRepos: 2, lastMessage: "2026-10-18T09:00:00Z", status: "VERIFIED" },
  { id: "c3", title: "release room", kind: "group", members: 6, linkedRepos: 0, lastMessage: "2026-10-11T16:00:00Z", status: "CHECK" },
];

/** A finding has a path and a rule. It has no value field, by design. */
export type SecretFinding = {
  id: string;
  path: string;
  rule: string;
  repoId: string;
  commitSha: string;
  at: string;
  status: "SKIPPED" | "ACKNOWLEDGED";
};

export const FINDINGS: SecretFinding[] = [
  { id: "f1", path: "config/prod.env", rule: "assignment to a secret-named key", repoId: "r_api", commitSha: "4b7a22e", at: "2026-10-18T07:12:00Z", status: "SKIPPED" },
  { id: "f2", path: "scripts/deploy.sh", rule: "AWS access key pattern", repoId: "r_syncura", commitSha: "9c1d0aa", at: "2026-10-17T19:40:00Z", status: "SKIPPED" },
  { id: "f3", path: "src/telegram/token.ts", rule: "Telegram bot token pattern", repoId: "r_syncura", commitSha: "1f8e44b", at: "2026-10-17T11:02:00Z", status: "ACKNOWLEDGED" },
  { id: "f4", path: "infra/terraform.tfvars", rule: "assignment to a secret-named key", repoId: "r_api", commitSha: "77b0c31", at: "2026-10-16T22:15:00Z", status: "SKIPPED" },
  { id: "f5", path: "test/fixtures/key.pem", rule: "private key header", repoId: "r_syncura", commitSha: "2ae9f77", at: "2026-10-15T08:30:00Z", status: "ACKNOWLEDGED" },
  { id: "f6", path: "docs/example.env", rule: "assignment to a secret-named key", repoId: "r_api", commitSha: "d4120aa", at: "2026-10-14T17:55:00Z", status: "ACKNOWLEDGED" },
];

export type Stage = { key: string; count: number; p50: number; p95: number };
export const STAGES: Stage[] = [
  { key: "webhook", count: 1842, p50: 41, p95: 210 },
  { key: "hmac verify", count: 1842, p50: 2, p95: 4 },
  { key: "rate limit", count: 1842, p50: 1, p95: 2 },
  { key: "idempotent enqueue", count: 1841, p50: 8, p95: 31 },
  { key: "worker claim", count: 1841, p50: 5, p95: 19 },
  { key: "scan", count: 1839, p50: 12, p95: 48 },
  { key: "trim", count: 1839, p50: 6, p95: 22 },
  { key: "classify", count: 1839, p50: 3, p95: 11 },
  { key: "summarize", count: 1838, p50: 940, p95: 2600 },
  { key: "link", count: 1838, p50: 18, p95: 74 },
  { key: "telegram", count: 1837, p50: 120, p95: 480 },
];

export type Job = { id: string; kind: string; status: "queued" | "running" | "retrying" | "dead"; attempts: number };
export const JOBS: Job[] = [
  { id: "j1", kind: "push", status: "queued", attempts: 0 },
  { id: "j2", kind: "push", status: "running", attempts: 1 },
  { id: "j3", kind: "backfill", status: "retrying", attempts: 3 },
  { id: "j4", kind: "check_run", status: "dead", attempts: 5 },
];

export type Delivery = {
  id: string;
  at: string;
  event: string;
  signature: "VERIFIED" | "ERR";
  rateLimited: boolean;
  key: string;
  outcome: string;
};
export const DELIVERIES: Delivery[] = Array.from({ length: 50 }, (_, i) => ({
  id: `w${String(i + 1).padStart(3, "0")}`,
  at: `2026-10-18T${String(6 + (i % 14)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00Z`,
  event: ["push", "pull_request", "check_run", "issues"][i % 4]!,
  signature: i === 23 ? "ERR" : "VERIFIED",
  rateLimited: i === 41,
  key: `d${(1000 + i).toString(16)}`,
  outcome: i === 23 ? "rejected 401" : i === 41 ? "rejected 429" : "queued",
}));

export function repoById(id: string): Repo {
  return REPOS.find((r) => r.id === id) ?? REPOS[0]!;
}

export function pointsOf(w: Weight): number {
  return WEIGHT_POINTS[w];
}
