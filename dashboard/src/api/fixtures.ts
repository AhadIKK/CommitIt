/**
 * Fixtures. These are the hard cases from brief section 10 on purpose: "fix",
 * "update" and "final final" as commit subjects, work linked to nothing with a
 * suggestion, a reopened task, an unestimated task, an empty goal, a failed
 * build, a stale branch, a leaked-secret alert, a 100-commit burst, very long
 * messages, and a digest that hits the 3 800-character limit.
 *
 * Timestamps are relative to load so "3 hours ago" stays true.
 */
import type {
  Alert,
  Author,
  Commit,
  Issue,
  Me,
  Milestone,
  PullRequest,
  Repo,
  RepoId,
  Subscription,
  TodaySnapshot,
  GoalDetail,
  PersonSummary,
  DigestSettings,
  RepoSettings,
} from "./types.js";
import { DIGEST_MODE_LABEL, DIGEST_CHAR_LIMIT, renderDigest } from "../lib/digest.js";

const T0 = Date.now();
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

const ago = (ms: number) => new Date(T0 - ms).toISOString();
const ahead = (ms: number) => new Date(T0 + ms).toISOString();

export const NOW = () => new Date();

/* ---------------------------------------------------------------- authors */

export const authors: Record<string, Author> = {
  fizan: { id: "u_fizan", login: "fizan", name: "Fizan Rahman" },
  ahad: { id: "u_ahad", login: "ahad", name: "Ahad I K" },
  mira: { id: "u_mira", login: "mira", name: "Mira Chen" },
  // A commit with no GitHub account: attribution falls back to the display name.
  unlinked: { id: "u_ghost", login: "Dev Laptop" },
};

/* ------------------------------------------------------------------ repos */

export const repos: Repo[] = [
  {
    id: "r_syncura",
    owner: "syncurateam",
    name: "syncura",
    fullName: "syncurateam/syncura",
    defaultBranch: "main",
    aiEnabled: true,
    webhook: {
      ok: true,
      lastDeliveryAt: ago(12 * MIN),
      lastDeliveryStatus: "ok",
      expectedUrl: "https://commitit.app/api/webhook",
    },
  },
  {
    id: "r_capstone",
    owner: "student-team",
    name: "capstone",
    fullName: "student-team/capstone",
    defaultBranch: "main",
    aiEnabled: false,
    webhook: {
      ok: false,
      lastDeliveryAt: ago(2 * DAY),
      lastDeliveryStatus: "failed",
      expectedUrl: "https://commitit.app/api/webhook",
    },
  },
  {
    id: "r_commitit",
    owner: "ahadikk",
    name: "commitit",
    fullName: "ahadikk/commitit",
    defaultBranch: "main",
    aiEnabled: true,
    webhook: {
      ok: true,
      lastDeliveryAt: ago(4 * HOUR),
      lastDeliveryStatus: "ok",
      expectedUrl: "https://commitit.app/api/webhook",
    },
  },
];

export const defaultRepo = repos[0];

/* ------------------------------------------------------------- milestones */

export const milestones: Record<RepoId, Milestone[]> = {
  r_syncura: [
    {
      id: "m_auth",
      title: "Auth",
      dueDate: ahead(6 * DAY),
      state: "open",
      weightedClosed: 8,
      weightedTotal: 13,
      issueCount: 7,
      closedCount: 4,
    },
    {
      id: "m_realtime",
      title: "Realtime",
      dueDate: ahead(20 * DAY),
      state: "open",
      weightedClosed: 4,
      weightedTotal: 8,
      issueCount: 4,
      closedCount: 2,
    },
    {
      id: "m_profile",
      title: "Profile",
      dueDate: null,
      state: "open",
      weightedClosed: 0,
      weightedTotal: 0,
      issueCount: 0,
      closedCount: 0,
    },
    {
      id: "m_polish",
      title: "Polish",
      dueDate: ago(3 * DAY),
      state: "open",
      weightedClosed: 3,
      weightedTotal: 9,
      issueCount: 3,
      closedCount: 1,
    },
  ],
  r_capstone: [
    {
      id: "m_demo",
      title: "Demo day",
      dueDate: ahead(9 * DAY),
      state: "open",
      weightedClosed: 22,
      weightedTotal: 40,
      issueCount: 14,
      closedCount: 6,
    },
  ],
  r_commitit: [
    {
      id: "m_mvp",
      title: "MVP",
      dueDate: ahead(30 * DAY),
      state: "open",
      weightedClosed: 31,
      weightedTotal: 55,
      issueCount: 18,
      closedCount: 10,
    },
  ],
};

/* ----------------------------------------------------------------- issues */

export const issues: Record<RepoId, Issue[]> = {
  r_syncura: [
    // Auth: 8 of 13 points â€” 4 closed (3+3+1+1), 3 open (1+1+3)
    {
      number: 12,
      title: "Login form",
      sizeWeight: 3,
      state: "closed",
      milestoneId: "m_auth",
      assigneeId: "u_fizan",
      closedAt: ago(6 * DAY),
    },
    {
      number: 11,
      title: "Login route",
      sizeWeight: 3,
      state: "closed",
      milestoneId: "m_auth",
      assigneeId: "u_fizan",
      closedAt: ago(5 * DAY),
    },
    {
      number: 13,
      title: "Token expiry",
      sizeWeight: 1,
      state: "closed",
      milestoneId: "m_auth",
      assigneeId: "u_ahad",
      closedAt: ago(3 * DAY),
    },
    {
      number: 18,
      title: "Rate limit on the login route",
      sizeWeight: 1,
      state: "closed",
      milestoneId: "m_auth",
      assigneeId: "u_mira",
      // closed inside the current digest window: this is the node that shows
      // the one teal dot, "new since you last looked"
      closedAt: ago(4 * HOUR),
    },
    {
      // unestimated: a dashed node, counts as 1 point
      number: 16,
      title: "Health route",
      sizeWeight: null,
      state: "open",
      milestoneId: "m_auth",
      assigneeId: null,
    },
    {
      number: 15,
      title: "Refresh tokens",
      sizeWeight: 1,
      state: "open",
      milestoneId: "m_auth",
      assigneeId: "u_ahad",
    },
    {
      number: 17,
      title: "Session store",
      sizeWeight: 3,
      state: "open",
      milestoneId: "m_auth",
      assigneeId: null,
    },
    // Realtime: includes a reopened task, so the filled line moves back
    {
      number: 21,
      title: "WebSocket connect",
      sizeWeight: 3,
      state: "closed",
      milestoneId: "m_realtime",
      assigneeId: "u_ahad",
      closedAt: ago(8 * DAY),
    },
    {
      number: 22,
      title: "Presence indicator",
      sizeWeight: 1,
      state: "closed",
      milestoneId: "m_realtime",
      assigneeId: "u_mira",
      closedAt: ago(7 * DAY),
    },
    {
      number: 23,
      title: "Reconnect logic",
      sizeWeight: 3,
      state: "open",
      milestoneId: "m_realtime",
      assigneeId: "u_ahad",
      reopenedAt: ago(4 * DAY),
      closedAt: null,
    },
    {
      number: 24,
      title: "Message queue",
      sizeWeight: null,
      state: "open",
      milestoneId: "m_realtime",
      assigneeId: null,
    },
    // Polish
    {
      number: 31,
      title: "Empty states",
      sizeWeight: 3,
      state: "closed",
      milestoneId: "m_polish",
      assigneeId: "u_mira",
      closedAt: ago(2 * DAY),
    },
    {
      number: 32,
      title: "Copy pass",
      sizeWeight: 1,
      state: "open",
      milestoneId: "m_polish",
      assigneeId: "u_fizan",
    },
    {
      number: 33,
      title: "Motion pass",
      sizeWeight: 5,
      state: "open",
      milestoneId: "m_polish",
      assigneeId: null,
    },
    // Not in a goal at all: shows up as unlinked work
    {
      number: 41,
      title: "Rename the staging project",
      sizeWeight: 1,
      state: "open",
      milestoneId: null,
      assigneeId: null,
    },
  ],
  r_capstone: [
    { number: 201, title: "Report layout", sizeWeight: 3, state: "closed", milestoneId: "m_demo", closedAt: ago(4 * DAY) },
    { number: 202, title: "Export to CSV", sizeWeight: 1, state: "closed", milestoneId: "m_demo", closedAt: ago(3 * DAY) },
    { number: 203, title: "Login for the demo", sizeWeight: 3, state: "closed", milestoneId: "m_demo", closedAt: ago(2 * DAY) },
    { number: 204, title: "Seed data", sizeWeight: null, state: "closed", milestoneId: "m_demo", closedAt: ago(2 * DAY) },
    { number: 205, title: "Slides", sizeWeight: 1, state: "closed", milestoneId: "m_demo", closedAt: ago(1 * DAY) },
    { number: 206, title: "Rehearsal", sizeWeight: 1, state: "closed", milestoneId: "m_demo", closedAt: ago(6 * HOUR) },
    { number: 207, title: "Search", sizeWeight: 5, state: "open", milestoneId: "m_demo" },
    { number: 208, title: "Charts", sizeWeight: 5, state: "open", milestoneId: "m_demo" },
    { number: 209, title: "Offline mode", sizeWeight: 3, state: "open", milestoneId: "m_demo" },
  ],
  r_commitit: [
    { number: 51, title: "Webhook verification", sizeWeight: 3, state: "closed", milestoneId: "m_mvp", closedAt: ago(9 * DAY) },
    { number: 52, title: "Queue poller", sizeWeight: 3, state: "closed", milestoneId: "m_mvp", closedAt: ago(8 * DAY) },
    { number: 53, title: "Goal track", sizeWeight: 5, state: "open", milestoneId: "m_mvp" },
  ],
};

/* ---------------------------------------------------------------- commits */

const C = (
  sha: string,
  message: string,
  category: Commit["category"],
  authorId: string,
  branch: string,
  committedAt: string,
  extra: Partial<Commit> = {},
): Commit => ({
  sha,
  message,
  category,
  authorId,
  branch,
  additions: 24,
  deletions: 4,
  committedAt,
  isMerge: false,
  secretFlag: false,
  aiSummary: null,
  issueNumber: null,
  ...extra,
});

export const LONG_SUBJECT =
  "refactor: split the auth middleware into a pure verification step and a thin request wrapper so the token path can be tested without a request object, and so the session store can be swapped for the Redis one later without touching the route handlers or the tests that already cover the happy path";

type Group = { author: Author; commits: Commit[] };

/** Commits since the last digest for SynCura â€” the Today screen's main list. */
export const syncuraGroups: Group[] = [
  {
    author: authors.fizan,
    commits: [
      C("a3f9c1d7e5b2", "feat: login form with inline validation", "feat", "u_fizan", "feat/auth", ago(5 * HOUR), {
        issueNumber: 12,
        aiSummary: "Adds the login form and validates the email field on blur.",
        additions: 128,
        deletions: 9,
      }),
      // "fix" on its own is normal. So is "update" and "final final".
      C("7bd021aa4c19", "fix", "fix", "u_fizan", "feat/auth", ago(4 * HOUR), {
        issueNumber: 12,
        additions: 6,
        deletions: 3,
      }),
      C("c41e88bb17f0", "test: cover the auth middleware", "test", "u_fizan", "feat/auth", ago(3 * HOUR), {
        issueNumber: 14,
        aiSummary: "Covers the middleware with three cases: missing header, expired token, valid token.",
        additions: 74,
        deletions: 2,
      }),
    ],
  },
  {
    author: authors.ahad,
    commits: [
      C("91aa30cd5e84", "feat: JWT middleware", "feat", "u_ahad", "main", ago(2 * HOUR), {
        issueNumber: 14,
        aiSummary: "Verifies the signature and attaches the user to the request.",
        additions: 88,
        deletions: 4,
      }),
      // "update" linked to nothing, with a suggestion that is never auto-applied
      C("e2f6d4f0a9b1", "update", "chore", "u_ahad", "main", ago(90 * MIN), {
        suggestedIssueNumber: 16,
        additions: 5,
        deletions: 1,
      }),
    ],
  },
  {
    author: authors.mira,
    commits: [
      C("55c1a0e3d7f4", "docs: describe the auth flow", "docs", "u_mira", "docs/auth", ago(70 * MIN), {
        additions: 41,
        deletions: 0,
      }),
      C("1f9e0ab8c2d5", "final final", "fix", "u_mira", "docs/auth", ago(48 * MIN), {
        suggestedIssueNumber: 15,
        additions: 3,
        deletions: 3,
      }),
      C("4b7a22e1f8c3", "chore: wire up config", "chore", "u_mira", "main", ago(20 * MIN), {
        secretFlag: true,
        aiSummary: null,
        additions: 12,
        deletions: 2,
      }),
      C("aa10bb22cc33", LONG_SUBJECT, "refactor", "u_ahad", "main", ago(14 * MIN), {
        additions: 210,
        deletions: 190,
        issueNumber: null,
        suggestedIssueNumber: 17,
      }),
      C("ff00ee11dd22", "Merge pull request #42 from syncurateam/feat/auth", "other", "u_ahad", "main", ago(12 * MIN), {
        isMerge: true,
        additions: 0,
        deletions: 0,
      }),
    ],
  },
  {
    author: authors.unlinked,
    commits: [
      // no GitHub account resolved: attribution falls back to the display name
      C("dead00beef11", "fix: typo in the readme", "fix", "u_ghost", "main", ago(30 * MIN), {
        additions: 1,
        deletions: 1,
      }),
    ],
  },
];

export function burstCommits(count = 100): Commit[] {
  const out: Commit[] = [];
  for (let i = 0; i < count; i += 1) {
    const long = i % 7 === 0;
    out.push(
      C(
        `${(0xabcdef00 + i).toString(16).padStart(10, "0")}${i.toString(16).padStart(2, "0")}`.slice(0, 12),
        long
          ? `${LONG_SUBJECT} (pass ${i + 1})`
          : i % 9 === 0
            ? "update"
            : `feat: wire up module ${i + 1}`,
        i % 5 === 0 ? "chore" : "feat",
        i % 3 === 0 ? "u_fizan" : "u_ahad",
        "main",
        ago(MIN * (count - i)),
        { additions: 10 + i, deletions: i % 20 },
      ),
    );
  }
  return out;
}

export const capstoneBurst: Group[] = [
  { author: authors.fizan, commits: burstCommits(60) },
  { author: authors.ahad, commits: burstCommits(40) },
];

/* ------------------------------------------------------------------- PRs */

export const pullRequests: PullRequest[] = [
  { number: 42, title: "Auth middleware", state: "merged", mergedAt: ago(12 * MIN), authorId: "u_ahad", issueNumber: 14 },
  { number: 43, title: "Docs for the auth flow", state: "open", mergedAt: null, authorId: "u_mira", issueNumber: null },
];

/* --------------------------------------------------------------- alerts */

export const alerts: Record<RepoId, Alert[]> = {
  r_syncura: [
    {
      id: "al_secret",
      kind: "secret",
      severity: "danger",
      title: "A possible key was pushed to main",
      detail: "Commit 4b7a22e touched one file.",
      // file path only â€” a secret value must never reach the client
      file: "src/config/keys.ts",
      commitSha: "4b7a22e1f8c3",
      at: ago(20 * MIN),
      advice: "Rotate this key, then remove it from the repository history.",
      href: "https://github.com/syncurateam/syncura/commit/4b7a22e1f8c3",
    },
    {
      id: "al_build",
      kind: "build_failed",
      severity: "danger",
      title: "Build failed on main",
      detail: "Commit 91aa30 failed the test job.",
      commitSha: "91aa30cd5e84",
      at: ago(2 * HOUR + 5 * MIN),
      advice: "Open the failed run, fix it, and push again.",
      href: "https://github.com/syncurateam/syncura/actions/runs/9182",
    },
    {
      id: "al_force",
      kind: "force_push",
      severity: "danger",
      title: "A force-push rewrote main",
      detail: "2 commits were replaced. Their work no longer appears in the history.",
      branch: "main",
      commitSha: "7bd021aa4c19",
      at: ago(3 * HOUR),
      advice: "Check with whoever pushed before re-running anything.",
    },
    {
      id: "al_direct",
      kind: "direct_push",
      severity: "danger",
      title: "4 commits went straight to main",
      detail: "No pull request was opened for them.",
      branch: "main",
      at: ago(90 * MIN),
      advice: "Open a pull request next time so the change gets a review.",
    },
    {
      id: "al_stale",
      kind: "stale_branch",
      severity: "warn",
      title: "Branch feat/profile: no activity for 6 days",
      detail: "It has 3 commits that are not on main.",
      branch: "feat/profile",
      at: ago(6 * DAY),
      advice: "Either open a pull request or delete the branch.",
    },
  ],
  r_capstone: [
    {
      id: "al_inactive",
      kind: "inactivity",
      severity: "warn",
      title: "No commits on main for 2 days",
      detail: "Demo day is in 9 days and 18 points are still open.",
      branch: "main",
      at: ago(2 * DAY),
      advice: "Check the demo day goal and move the smallest open task first.",
    },
    {
      id: "al_webhook",
      kind: "build_failed",
      severity: "warn",
      title: "GitHub could not deliver the last webhook",
      detail: "The last delivery failed 2 days ago.",
      at: ago(2 * DAY),
      advice: "Check that the webhook URL in your repo settings matches the one in Repo settings.",
    },
  ],
  r_commitit: [],
};

/* --------------------------------------------------------- subscriptions */

export const subscriptions: Record<RepoId, Subscription> = {
  r_syncura: {
    chatId: "chat_syncura",
    chatTitle: "SynCura team",
    repoId: "r_syncura",
    mode: "daily",
    quietHours: { enabled: true, from: "22:00", to: "07:00" },
    filters: { branches: ["main", "feat/auth"], authors: "all", events: ["commits", "pull_requests", "issues"] },
    muted: false,
  },
  r_capstone: {
    chatId: "chat_capstone",
    chatTitle: "Capstone group",
    repoId: "r_capstone",
    mode: "hourly",
    quietHours: { enabled: false, from: "23:00", to: "06:00" },
    filters: { branches: ["main"], authors: "all", events: ["commits"] },
    muted: false,
  },
  r_commitit: {
    chatId: "chat_commitit",
    chatTitle: "CommitIt build log",
    repoId: "r_commitit",
    mode: "weekly",
    quietHours: { enabled: true, from: "21:00", to: "08:00" },
    filters: { branches: ["main"], authors: "all", events: ["commits", "issues"] },
    muted: true,
  },
};

/* ------------------------------------------------------------- assembled */

export const me: Me = {
  signedIn: true,
  login: "ahad",
  name: "Ahad I K",
  repos,
  telegramLinked: true,
};

function digestFor(repo: Repo, groups: Group[], mode = subscriptions[repo.id].mode): DigestSettings {
  const milestone = milestones[repo.id][0] ?? null;
  const at = new Date(T0);
  at.setHours(9, 0, 0, 0);
  const rendered = renderDigest({
    repoFullName: repo.fullName,
    mode,
    at: at.toISOString(),
    milestone,
    groups,
    compareLink: `https://github.com/${repo.fullName}/compare/7bd021a...ff00ee1`,
    now: NOW(),
  });
  return {
    repoId: repo.id,
    subscription: { ...subscriptions[repo.id], mode },
    preview: rendered.text,
    charCount: rendered.charCount,
    charLimit: DIGEST_CHAR_LIMIT,
  };
}

export function digestFixture(repoId: RepoId, mode?: Subscription["mode"]): DigestSettings {
  const repo = repos.find((r) => r.id === repoId) ?? defaultRepo;
  const groups = repoId === "r_capstone" ? capstoneBurst : syncuraGroups;
  return digestFor(repo, groups, mode);
}

export function repoById(id: RepoId): Repo {
  return repos.find((r) => r.id === id) ?? defaultRepo;
}

export function repoByFullName(fullName: string): Repo {
  return repos.find((r) => r.fullName === fullName) ?? defaultRepo;
}

export function todayFixture(repoId: RepoId): TodaySnapshot {
  const repo = repoById(repoId);
  const list = milestones[repoId] ?? [];
  const groups = (repoId === "r_capstone" ? capstoneBurst : syncuraGroups).map((g) => ({
    ...g,
    tasksClosed:
      repoId === "r_syncura"
        ? (issues[repoId] ?? []).filter((i) => i.assigneeId === g.author.id && i.state === "closed").length
        : 0,
  }));
  const openPoints = list.reduce((n, m) => n + (m.weightedTotal - m.weightedClosed), 0);
  const focus = list[0] ?? null;
  return {
    repo,
    focus,
    focusIssues: focus ? (issues[repoId] ?? []).filter((i) => i.milestoneId === focus.id) : [],
    goals: list,
    digestWindowStart: ago(9 * HOUR),
    groups,
    unlinked: unlinkedFixture(repoId),
    alerts: alerts[repoId] ?? [],
    openPoints,
  };
}

export function unlinkedFixture(repoId: RepoId): TodaySnapshot["unlinked"] {
  const list = issues[repoId] ?? [];
  const groups = repoId === "r_capstone" ? capstoneBurst : syncuraGroups;
  const out: TodaySnapshot["unlinked"] = [];
  for (const g of groups) {
    for (const c of g.commits) {
      if (c.isMerge || c.issueNumber || c.secretFlag) continue;
      const suggestion = list.find((i) => i.number === c.suggestedIssueNumber) ?? null;
      out.push({ commit: c, suggestion });
    }
  }
  return out.sort((a, b) => (a.commit.committedAt < b.commit.committedAt ? 1 : -1));
}

export function goalFixture(repoId: RepoId, goalId: string): GoalDetail {
  const milestone = (milestones[repoId] ?? []).find((m) => m.id === goalId) ?? milestones[repoId][0];
  const list = (issues[repoId] ?? []).filter((i) => i.milestoneId === milestone.id);
  const groups = (repoId === "r_capstone" ? capstoneBurst : syncuraGroups).map((g) => g.commits).flat();
  const numbers = new Set(list.map((i) => i.number));
  const commits = groups.filter((c) => c.issueNumber && numbers.has(c.issueNumber));
  const unlinked: GoalDetail["unlinked"] = groups
    .filter((c) => !c.isMerge && !c.issueNumber && !c.secretFlag)
    .map((c) => ({ commit: c, suggestion: list.find((i) => i.number === c.suggestedIssueNumber) ?? null }));
  const authorIds = [...new Set([...list.map((i) => i.assigneeId), ...commits.map((c) => c.authorId)])].filter(
    (id): id is string => Boolean(id),
  );
  return {
    milestone,
    issues: list,
    authors: authorIds.map((id) => authors[id]).filter(Boolean),
    commits,
    unlinked,
  };
}

export function peopleFixture(repoId: RepoId): PersonSummary[] {
  const groups = repoId === "r_capstone" ? capstoneBurst : syncuraGroups;
  const list = issues[repoId] ?? [];
  return groups.map((g) => {
    const closedTasks = list.filter((i) => i.assigneeId === g.author.id && i.state === "closed");
    const weightedPointsClosed = closedTasks.reduce((n, i) => n + (i.sizeWeight ?? 1), 0);
    return {
      author: g.author,
      commits: g.commits,
      closedTasks,
      weightedPointsClosed,
      mergedPRs: pullRequests.filter((p) => p.authorId === g.author.id && p.state === "merged").length,
      windowStart: ago(7 * DAY),
      windowEnd: ago(0),
    };
  });
}

export function settingsFixture(repoId: RepoId): RepoSettings {
  const repo = repoById(repoId);
  return {
    repo,
    subscription: subscriptions[repoId] ?? null,
    aiEnabled: repo.aiEnabled,
    aiAvailable: true,
  };
}

export const digestModeLabels = DIGEST_MODE_LABEL;
