import { canAccessRepo, isAuthEnforced } from "./access.js";
import { classify, type Category } from "./brain/classify.js";
import { suggestLink } from "./brain/suggest.js";
import {
  DIGEST_CHAR_LIMIT,
  type Alert,
  type Author,
  type AuthorGroup,
  type Commit,
  type CommitCategory,
  type DigestFilters,
  type DigestMode,
  type DigestSettings,
  type GoalDetail,
  type Issue,
  type Me,
  type Milestone,
  type PersonSummary,
  type Repo,
  type RepoSettings,
  type Subscription,
  type TodaySnapshot,
  type WebhookHealth,
} from "./contract.js";
import { prisma } from "./db.js";
import { meaningfulSummary } from "./dashboard.js";
import { renderDigestBodies } from "./delivery.js";
import { createLinkToken, PURPOSE_TELEGRAM_LINK, TOKEN_RE } from "./linkTokens.js";
import { isDigestMode } from "./notifyPrefs.js";
import { milestoneProgress } from "./progress.js";
import { hashToken, type SessionUser } from "./session.js";
import { botUsername, sendMessage } from "./telegram.js";

// workspace.ts — the reads and writes the signed-in product performs, against
// the database. One module, so every screen is answered by the same queries:
//   me, repos, today, goals, goal, people, alerts, digest, settings
// and the four writes the interface allows (link a commit, save a digest,
// switch AI summaries, disconnect a chat).
//
// Invariants (AGENTS.md):
//   - Progress is read from issues/milestones only, never counted from commits.
//   - Every commit carries an author id, or reads as "unknown" (rule 12).
//   - A secret is named by path/commit only; its value never leaves the scan.
//   - Digest text is produced by the same renderer the sender uses (rule 8).
//
// Every read degrades to its empty shape instead of throwing: a store blip
// shows an empty screen, never a 500. Writes answer with a real status code.

export const ACTIVITY_WINDOW_DAYS = 7;
const COMMIT_LIMIT = 60;

// --- structural row types (what we select, not the whole Prisma model) ------

export type RepoRow = {
  id: string;
  fullName: string;
  defaultBranch: string | null;
  aiEnabled: boolean;
  installActive: boolean;
  installationId: bigint | null;
};

type AuthorRow = { id: string; githubLogin: string; displayName: string | null };

type CommitRow = {
  id: string;
  sha: string;
  message: string;
  category: string | null;
  aiSummary: string | null;
  branch: string | null;
  additions: number | null;
  deletions: number | null;
  committedAt: Date | null;
  createdAt: Date;
  isMerge: boolean;
  secretFlag: boolean;
  authorId: string | null;
  author: { id: string; githubLogin: string; displayName: string | null } | null;
  issue: { number: number } | null;
};

type IssueRow = {
  id: string;
  number: number;
  title: string;
  sizeWeight: number;
  state: string;
  milestoneId: string | null;
  closedAt: Date | null;
  reopenedAt: Date | null;
  updatedAt: Date;
};

type MilestoneRow = {
  id: string;
  title: string;
  dueDate: Date | null;
  state: string;
  issues: IssueRow[];
};

type ChatRow = { telegramChatId: string; type: string; title: string | null };

type SubscriptionRow = {
  id: string;
  chatId: string;
  repoId: string;
  digestMode: string;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  filterBranches: string[];
  filterAuthors: string[];
  filterEventTypes: string[];
  isMuted: boolean;
  chat: ChatRow;
};

// --- pure shaping (unit-tested, no database) --------------------------------

const CATEGORIES: Record<string, CommitCategory> = {
  feat: "feat",
  fix: "fix",
  docs: "docs",
  refactor: "refactor",
  test: "test",
  chore: "chore",
  perf: "refactor",
  ci: "chore",
  build: "chore",
  merge: "other",
  other: "other",
};

/** The stored category, or a fresh classification when ingest stored none. */
export function commitCategory(stored: string | null, message: string): CommitCategory {
  const key = (stored ?? classify(message)) as Category;
  return CATEGORIES[key] ?? "other";
}

/** Subject and body of a commit message. The body is omitted when it is empty. */
export function splitMessage(message: string): { subject: string; body?: string } {
  const [first, ...rest] = message.split("\n");
  const subject = (first ?? "").trim();
  const body = rest.join("\n").trim();
  return body ? { subject, body } : { subject };
}

export function authorOf(row: AuthorRow): Author {
  return row.displayName && row.displayName !== row.githubLogin
    ? { id: row.id, login: row.githubLogin, name: row.displayName }
    : { id: row.id, login: row.githubLogin };
}

/** "unknown" is a data gap stated plainly, never a blank that looks like a bug. */
export function authorOfCommit(row: { authorId: string | null; author: AuthorRow | null }): Author {
  return row.author ? authorOf(row.author) : { id: "unknown", login: "unknown" };
}

export function issueDto(row: IssueRow): Issue {
  const state = row.state === "closed" ? "closed" : "open";
  return {
    number: row.number,
    title: row.title,
    // null = unestimated. The UI draws a dashed node and counts it as 1 point.
    sizeWeight:
      row.sizeWeight === 1 || row.sizeWeight === 3 || row.sizeWeight === 5
        ? (row.sizeWeight as 1 | 3 | 5)
        : null,
    state,
    milestoneId: row.milestoneId,
    assigneeId: null,
    // Written by the `issues` webhook and the API sync. A closed issue with no
    // timestamp predates the column, so the migration seeded it from updatedAt.
    closedAt: state === "closed" ? (row.closedAt?.toISOString() ?? null) : null,
    // Only a reopen sets this, and reopening clears closedAt, so the Goal Track
    // can draw the task open again and move the filled line back.
    reopenedAt: row.reopenedAt?.toISOString() ?? null,
  };
}

/**
 * The order the Goal Track draws: the tasks that closed, in the order they
 * closed, then the ones still open. The filled prefix is therefore a real
 * history, not a sort artefact.
 */
export function orderIssues(issues: Issue[]): Issue[] {
  const closed = issues
    .filter((i) => i.state === "closed")
    .sort((a, b) => (a.closedAt ?? "").localeCompare(b.closedAt ?? ""));
  const open = issues.filter((i) => i.state !== "closed").sort((a, b) => a.number - b.number);
  return [...closed, ...open];
}

export function milestoneDto(row: MilestoneRow): Milestone {
  const issues = row.issues.map((i) => ({ state: i.state, sizeWeight: i.sizeWeight }));
  const res = milestoneProgress(
    issues.map((i) => ({
      state: (i.state === "closed" ? "closed" : "open") as "open" | "closed",
      sizeWeight: i.sizeWeight,
    })),
  );
  return {
    id: row.id,
    title: row.title,
    dueDate: row.dueDate ? row.dueDate.toISOString() : null,
    state: row.state === "closed" ? "closed" : "open",
    weightedClosed: res.empty ? 0 : res.closedPoints,
    weightedTotal: res.empty ? 0 : res.totalPoints,
    issueCount: row.issues.length,
    closedCount: res.empty ? 0 : res.closed,
  };
}

/** Points still open across the repo, from issue weights (never from commits). */
export function openPointsOf(rows: { state: string; sizeWeight: number }[]): number {
  return rows
    .filter((i) => i.state !== "closed")
    .reduce((n, i) => n + (i.sizeWeight > 0 ? i.sizeWeight : 1), 0);
}

export function commitDto(
  row: CommitRow,
  openIssues: { number: number; title: string }[],
): Commit {
  const { subject, body } = splitMessage(row.message);
  const linked = row.issue?.number ?? null;
  // A suggestion is never applied: it is offered, and only linkCommit() writes.
  const suggestion =
    linked === null && !row.secretFlag && !row.isMerge
      ? suggestLink(row.message, row.branch ?? "", openIssues)
      : null;
  return {
    sha: row.sha,
    message: subject,
    ...(body ? { body } : {}),
    category: commitCategory(row.category, row.message),
    // The echo stub's "AI summary: <subject>" is not a summary; drop it here so
    // the row shows the real message instead of repeating it twice.
    aiSummary: meaningfulSummary(row.message, row.aiSummary),
    branch: row.branch ?? "",
    additions: row.additions ?? 0,
    deletions: row.deletions ?? 0,
    committedAt: (row.committedAt ?? row.createdAt).toISOString(),
    issueNumber: linked,
    suggestedIssueNumber: suggestion,
    authorId: row.authorId ?? "unknown",
    isMerge: row.isMerge,
    secretFlag: row.secretFlag,
  };
}

export type AlertInput = {
  repoFullName: string;
  defaultBranch: string;
  secretCommits: { sha: string; branch: string | null; committedAt: Date | null; createdAt: Date }[];
  failedBuilds: {
    id: string;
    commitSha: string;
    branch: string | null;
    buildNumber: string | null;
    runUrl: string | null;
    createdAt: Date;
  }[];
  forcePushes: { sha: string; branch: string | null; committedAt: Date | null; createdAt: Date }[];
  lastActivityAt: Date | null;
  now: Date;
};

/**
 * What needs a human. Only the kinds we can substantiate from stored rows are
 * emitted: a build we saw fail, a commit flagged by the scanner, a push that
 * rewrote history, and a stretch with nothing at all. No invented alerts.
 */
export function buildAlerts(input: AlertInput): Alert[] {
  const out: Alert[] = [];
  const commitUrl = (sha: string) => `https://github.com/${input.repoFullName}/commit/${sha}`;
  const short = (sha: string) => sha.slice(0, 7);

  for (const c of input.secretCommits) {
    out.push({
      id: `secret:${c.sha}`,
      kind: "secret",
      severity: "danger",
      title: `Possible secret in ${short(c.sha)}`,
      detail:
        "A matching file was skipped before it reached the AI, so no line of it was summarised or stored.",
      advice: "Rotate the credential, then remove it from the branch's history.",
      commitSha: c.sha,
      branch: c.branch ?? undefined,
      at: (c.committedAt ?? c.createdAt).toISOString(),
      href: commitUrl(c.sha),
    });
  }

  for (const b of input.failedBuilds) {
    out.push({
      id: `build:${b.id}`,
      kind: "build_failed",
      severity: "danger",
      title: `Build failed on ${b.branch ?? input.defaultBranch}`,
      detail: `${b.buildNumber ? `Build ${b.buildNumber} on ` : "A build on "}${short(b.commitSha)} did not pass.`,
      advice: "Open the run, fix the failure, and the next digest will report it as recovered.",
      commitSha: b.commitSha,
      branch: b.branch ?? undefined,
      at: b.createdAt.toISOString(),
      ...(b.runUrl ? { href: b.runUrl } : {}),
    });
  }

  for (const c of input.forcePushes) {
    out.push({
      id: `force:${c.sha}`,
      kind: "force_push",
      severity: "danger",
      title: `History was rewritten on ${c.branch ?? input.defaultBranch}`,
      detail: "The push replaced commits. Those commits are excluded from activity and from the digest.",
      advice: "If the rewrite was not intended, restore the branch from a reflog or a backup.",
      commitSha: c.sha,
      branch: c.branch ?? undefined,
      at: (c.committedAt ?? c.createdAt).toISOString(),
      href: commitUrl(c.sha),
    });
  }

  if (input.lastActivityAt) {
    const quietDays = Math.floor(
      (input.now.getTime() - input.lastActivityAt.getTime()) / 86_400_000,
    );
    if (quietDays >= ACTIVITY_WINDOW_DAYS) {
      out.push({
        id: `quiet:${input.repoFullName}`,
        kind: "inactivity",
        severity: "warn",
        title: `Nothing from ${input.repoFullName} for ${quietDays} days`,
        detail: "No commit, pull request or issue change has arrived in the digest window.",
        advice: "If work is happening elsewhere, check that the webhook is still delivering.",
        at: input.now.toISOString(),
      });
    }
  }

  return out.sort((a, b) => b.at.localeCompare(a.at));
}

/** The chat's Telegram name when we captured one, else a truthful stand-in. */
export function chatTitleOf(chat: { type: string; title?: string | null }): string {
  const stored = chat.title?.trim();
  if (stored) return stored;
  return chat.type === "group" ? "Group chat" : "Direct message";
}

export function subscriptionDto(sub: SubscriptionRow): Subscription {
  const events = sub.filterEventTypes.filter(
    (e): e is "commits" | "pull_requests" | "issues" =>
      e === "commits" || e === "pull_requests" || e === "issues",
  );
  const filters: DigestFilters = {
    branches: sub.filterBranches,
    // An empty author list means "everyone" in storage, which the UI spells "all".
    authors: sub.filterAuthors.length > 0 ? sub.filterAuthors : "all",
    events: events.length > 0 ? events : ["commits", "pull_requests", "issues"],
  };
  return {
    chatId: sub.chatId,
    chatTitle: chatTitleOf(sub.chat),
    repoId: sub.repoId,
    mode: isDigestMode(sub.digestMode) ? sub.digestMode : "daily",
    quietHours: {
      enabled: Boolean(sub.quietHoursStart && sub.quietHoursEnd),
      from: sub.quietHoursStart ?? "22:00",
      to: sub.quietHoursEnd ?? "07:00",
    },
    filters,
    muted: sub.isMuted,
  };
}

/** "owner/name" split once; a malformed name still renders something honest. */
export function repoNames(fullName: string): { owner: string; name: string } {
  const idx = fullName.indexOf("/");
  if (idx <= 0) return { owner: "", name: fullName };
  return { owner: fullName.slice(0, idx), name: fullName.slice(idx + 1) };
}

// --- database reads ---------------------------------------------------------

export function windowStart(now: Date = new Date()): Date {
  return new Date(now.getTime() - ACTIVITY_WINDOW_DAYS * 86_400_000);
}

/** The repo id the client sent may be our id or the owner/name it links with. */
export async function findRepo(selector: string): Promise<RepoRow | null> {
  if (!selector) return null;
  try {
    const byId = await prisma.repo.findUnique({ where: { id: selector } });
    if (byId) return byId;
    return await prisma.repo.findUnique({ where: { fullName: selector } });
  } catch {
    return null;
  }
}

export function expectedWebhookUrl(): string {
  const base = (process.env.APP_URL ?? "").trim().replace(/\/+$/, "") || "http://localhost:3000";
  return `${base}/api/webhook`;
}

async function webhookHealth(repoId: string): Promise<WebhookHealth> {
  const expectedUrl = expectedWebhookUrl();
  try {
    const last = await prisma.event.findFirst({
      // Event.repoId is the repo's id, not its name: comparing the two never
      // matched, so every repo claimed it had never received a delivery.
      where: { repoId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, status: true },
    });
    if (!last) {
      // Nothing recorded yet. Not a failure: the boolean means "we have not seen
      // a failed delivery", so a quiet repo does not raise a false alarm.
      return { lastDeliveryAt: null, lastDeliveryStatus: null, expectedUrl, ok: true };
    }
    const failed = last.status === "failed";
    return {
      lastDeliveryAt: last.createdAt.toISOString(),
      lastDeliveryStatus: failed ? "failed" : "ok",
      expectedUrl,
      ok: !failed,
    };
  } catch {
    return { lastDeliveryAt: null, lastDeliveryStatus: null, expectedUrl, ok: true };
  }
}

export async function repoDto(row: RepoRow): Promise<Repo> {
  const { owner, name } = repoNames(row.fullName);
  return {
    id: row.id,
    owner,
    name,
    fullName: row.fullName,
    defaultBranch: row.defaultBranch ?? "main",
    aiEnabled: row.aiEnabled,
    webhook: await webhookHealth(row.id),
    // Access lost (App uninstalled, suspended): readable rows stay, but say so.
    unreadable: row.installActive === false,
  };
}

/**
 * Repos this caller can see. A signed-in account sees what it owns plus what its
 * installations expose. In a webhooks-only setup (no OAuth configured) the read
 * API is public by design, so every repo is listed — same escape hatch as
 * src/access.ts.
 */
async function visibleRepoRows(session: SessionUser | null): Promise<RepoRow[]> {
  try {
    if (!session) {
      if (isAuthEnforced()) return [];
      return await prisma.repo.findMany({ orderBy: { fullName: "asc" } });
    }
    const memberships = await prisma.userInstallation.findMany({
      where: { userId: session.id },
      select: { installationId: true },
    });
    return await prisma.repo.findMany({
      where: {
        OR: [
          { ownerUserId: session.id },
          { installationId: { in: memberships.map((m) => m.installationId) } },
        ],
      },
      orderBy: { fullName: "asc" },
    });
  } catch {
    return [];
  }
}

async function telegramLinked(userId: string): Promise<boolean> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { telegramUserId: true },
    });
    return Boolean(user?.telegramUserId);
  } catch {
    return false;
  }
}

export async function meDto(session: SessionUser | null): Promise<Me> {
  const rows = await visibleRepoRows(session);
  const repos = await Promise.all(rows.map((r) => repoDto(r)));
  return {
    signedIn: session !== null,
    login: session?.login ?? null,
    repos,
    telegramLinked: session ? await telegramLinked(session.id) : false,
  };
}

/** Every milestone of the repo, open first, nearest due date first. */
export async function goalsOf(repoId: string): Promise<Milestone[]> {
  try {
    const rows = await prisma.milestone.findMany({
      where: { repoId },
      include: { issues: true },
    });
    return rows
      .map((m) => milestoneDto(m as MilestoneRow))
      .sort((a, b) => {
        if (a.state !== b.state) return a.state === "open" ? -1 : 1;
        if (a.dueDate !== b.dueDate) {
          if (a.dueDate === null) return 1;
          if (b.dueDate === null) return -1;
          return a.dueDate.localeCompare(b.dueDate);
        }
        return b.weightedTotal - a.weightedTotal;
      });
  } catch {
    return [];
  }
}

function pickFocus(goals: Milestone[]): Milestone | null {
  return goals.find((g) => g.state === "open") ?? null;
}

async function openIssuesOf(repoId: string): Promise<{ number: number; title: string }[]> {
  try {
    return await prisma.issue.findMany({
      where: { repoId, state: "open" },
      select: { number: true, title: true },
      orderBy: { number: "asc" },
    });
  } catch {
    return [];
  }
}

async function windowCommits(repoId: string, since: Date, take = COMMIT_LIMIT): Promise<CommitRow[]> {
  try {
    return (await prisma.commit.findMany({
      where: {
        repoId,
        OR: [{ committedAt: { gte: since } }, { committedAt: null, createdAt: { gte: since } }],
      },
      include: { author: { select: { id: true, githubLogin: true, displayName: true } }, issue: { select: { number: true } } },
      orderBy: [{ committedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take,
    })) as CommitRow[];
  } catch {
    return [];
  }
}

/** Issues closed in the window, with the authors of the commits that closed them. */
async function closedIssuesOf(
  repoId: string,
  since: Date,
): Promise<{ issue: IssueRow; authorId: string | null }[]> {
  try {
    const rows = await prisma.issue.findMany({
      where: { repoId, state: "closed", updatedAt: { gte: since } },
      include: { commits: { select: { authorId: true } } },
    });
    return rows.map((row) => ({
      issue: row as IssueRow,
      authorId: row.commits.find((c) => c.authorId)?.authorId ?? null,
    }));
  } catch {
    return [];
  }
}

export async function alertsOf(row: RepoRow, now: Date = new Date()): Promise<Alert[]> {
  const since = windowStart(now);
  try {
    const [secretCommits, failedBuilds, forcePushes, lastCommit] = await Promise.all([
      prisma.commit.findMany({
        where: { repoId: row.id, secretFlag: true },
        select: { sha: true, branch: true, committedAt: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      prisma.build.findMany({
        where: { repoId: row.id, status: "failure", createdAt: { gte: since } },
        select: {
          id: true,
          commitSha: true,
          branch: true,
          buildNumber: true,
          runUrl: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      prisma.commit.findMany({
        where: { repoId: row.id, isForcePushContext: true, createdAt: { gte: since } },
        select: { sha: true, branch: true, committedAt: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      prisma.commit.findFirst({
        where: { repoId: row.id },
        select: { committedAt: true, createdAt: true },
        orderBy: [{ committedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      }),
    ]);
    return buildAlerts({
      repoFullName: row.fullName,
      defaultBranch: row.defaultBranch ?? "main",
      secretCommits,
      failedBuilds,
      forcePushes,
      lastActivityAt: lastCommit ? (lastCommit.committedAt ?? lastCommit.createdAt) : null,
      now,
    });
  } catch {
    return [];
  }
}

function groupByAuthor(
  commits: Commit[],
  closed: { issue: Issue; authorId: string | null }[],
  authorById: Map<string, Author>,
): AuthorGroup[] {
  const byAuthor = new Map<string, AuthorGroup>();
  for (const commit of commits) {
    const existing = byAuthor.get(commit.authorId);
    if (existing) {
      existing.commits.push(commit);
      continue;
    }
    const author = authorById.get(commit.authorId) ?? { id: commit.authorId, login: commit.authorId };
    byAuthor.set(commit.authorId, { author, commits: [commit], tasksClosed: 0 });
  }
  const points = new Map<string, number>();
  for (const item of closed) {
    if (!item.authorId) continue;
    const weight = item.issue.sizeWeight ?? 1;
    points.set(item.authorId, (points.get(item.authorId) ?? 0) + weight);
  }
  for (const [authorId, group] of byAuthor) {
    group.tasksClosed = points.get(authorId) ?? 0;
  }
  return [...byAuthor.values()].sort((a, b) => b.commits.length - a.commits.length);
}

/** A suggestion is offered as a task-shaped row, never applied. */
function withSuggestions(
  rows: CommitRow[],
  openIssues: { number: number; title: string }[],
): { commit: Commit; suggestion: Issue | null }[] {
  return rows.map((row) => {
    const commit = commitDto(row, openIssues);
    const hit = openIssues.find((i) => i.number === commit.suggestedIssueNumber);
    return {
      commit,
      suggestion: hit
        ? {
            number: hit.number,
            title: hit.title,
            sizeWeight: null,
            state: "open",
            milestoneId: null,
          }
        : null,
    };
  });
}

export async function todayOf(row: RepoRow, now: Date = new Date()): Promise<TodaySnapshot> {
  const since = windowStart(now);
  const [repo, goals, rawCommits, closed, alerts, openIssues, allIssues] = await Promise.all([
    repoDto(row),
    goalsOf(row.id),
    windowCommits(row.id, since),
    closedIssuesOf(row.id, since),
    alertsOf(row, now),
    openIssuesOf(row.id),
    prisma.issue
      .findMany({ where: { repoId: row.id }, select: { state: true, sizeWeight: true } })
      .catch(() => []),
  ]);

  const commits = rawCommits.map((c) => commitDto(c, openIssues));
  const focus = pickFocus(goals);
  let focusIssues: Issue[] = [];
  if (focus) {
    const rows = await prisma.issue
      .findMany({ where: { repoId: row.id, milestoneId: focus.id } })
      .catch(() => []);
    focusIssues = orderIssues((rows as IssueRow[]).map(issueDto));
  }

  // Unlinked work: commits in the window that belong to no task yet. The
  // suggestion is offered, never applied (linkCommit is the only write).
  const unlinked = withSuggestions(
    rawCommits.filter((c) => !c.issue && !c.isMerge && !c.secretFlag).slice(0, 6),
    openIssues,
  );

  // Authors are named from the commit rows we already hold, so a person keeps
  // their display name (AGENTS.md rule 12).
  const authorById = new Map<string, Author>();
  for (const c of rawCommits) {
    const author = authorOfCommit(c);
    if (author.id !== "unknown") authorById.set(author.id, author);
  }

  const groups = groupByAuthor(
    commits,
    closed.map((c) => ({ issue: issueDto(c.issue), authorId: c.authorId })),
    authorById,
  );

  return {
    repo,
    focus,
    focusIssues,
    goals,
    digestWindowStart: since.toISOString(),
    groups,
    unlinked,
    alerts,
    openPoints: openPointsOf(allIssues),
  };
}

export async function goalOf(row: RepoRow, goalId: string): Promise<GoalDetail | null> {
  try {
    const milestone = await prisma.milestone.findFirst({
      where: { id: goalId, repoId: row.id },
      include: { issues: true },
    });
    if (!milestone) return null;
    const issues = orderIssues((milestone.issues as IssueRow[]).map(issueDto));
    const openIssues = await openIssuesOf(row.id);
    const [commitRows, unlinkedRows] = await Promise.all([
      prisma.commit.findMany({
        where: { repoId: row.id, issueId: { in: milestone.issues.map((i) => i.id) } },
        include: {
          author: { select: { id: true, githubLogin: true, displayName: true } },
          issue: { select: { number: true } },
        },
        orderBy: [{ committedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
        take: 30,
      }),
      prisma.commit.findMany({
        where: {
          repoId: row.id,
          issueId: null,
          isMerge: false,
          secretFlag: false,
          OR: [{ committedAt: { gte: windowStart() } }, { committedAt: null, createdAt: { gte: windowStart() } }],
        },
        include: {
          author: { select: { id: true, githubLogin: true, displayName: true } },
          issue: { select: { number: true } },
        },
        orderBy: [{ committedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
        take: 6,
      }),
    ]);
    const commits = (commitRows as CommitRow[]).map((c) => commitDto(c, openIssues));
    const unlinked = withSuggestions(unlinkedRows as CommitRow[], openIssues);
    const authors = new Map<string, Author>();
    for (const c of commitRows as CommitRow[]) {
      const author = authorOfCommit(c);
      authors.set(author.id, author);
    }
    return {
      milestone: milestoneDto(milestone as MilestoneRow),
      issues,
      authors: [...authors.values()],
      commits,
      unlinked,
    };
  } catch {
    return null;
  }
}

export async function peopleOf(row: RepoRow, now: Date = new Date()): Promise<PersonSummary[]> {
  const since = windowStart(now);
  try {
    const [rawCommits, closed, mergedPrs, openIssues] = await Promise.all([
      windowCommits(row.id, since, 200),
      closedIssuesOf(row.id, since),
      prisma.pullRequest.groupBy({
        by: ["authorId"],
        where: { repoId: row.id, state: "merged", mergedAt: { gte: since } },
        _count: { _all: true },
      }),
      openIssuesOf(row.id),
    ]);
    const authors = new Map<string, Author>();
    for (const c of rawCommits) {
      const author = authorOfCommit(c);
      if (author.id !== "unknown") authors.set(author.id, author);
    }
    const merged = new Map<string, number>();
    for (const g of mergedPrs) {
      if (g.authorId) merged.set(g.authorId, g._count._all);
    }
    const closedByAuthor = new Map<string, Issue[]>();
    for (const item of closed) {
      if (!item.authorId) continue;
      const list = closedByAuthor.get(item.authorId) ?? [];
      list.push(issueDto(item.issue));
      closedByAuthor.set(item.authorId, list);
    }
    const summaries: PersonSummary[] = [];
    for (const [id, author] of authors) {
      const commits = rawCommits.filter((c) => c.authorId === id).map((c) => commitDto(c, openIssues));
      const closedTasks = closedByAuthor.get(id) ?? [];
      summaries.push({
        author,
        commits,
        closedTasks,
        weightedPointsClosed: closedTasks.reduce(
          (n, i) => n + (i.sizeWeight ?? 1),
          0,
        ),
        mergedPRs: merged.get(id) ?? 0,
        windowStart: since.toISOString(),
        windowEnd: now.toISOString(),
      });
    }
    return summaries.sort(
      (a, b) => b.weightedPointsClosed - a.weightedPointsClosed || b.commits.length - a.commits.length,
    );
  } catch {
    return [];
  }
}

/** The subscription the dashboard edits: the caller's DM chat, else the oldest. */
export async function pickSubscription(
  repoId: string,
  session: SessionUser | null,
): Promise<SubscriptionRow | null> {
  try {
    const subs = (await prisma.subscription.findMany({
      where: { repoId },
      include: { chat: { select: { telegramChatId: true, type: true, title: true } } },
      orderBy: { createdAt: "asc" },
    })) as SubscriptionRow[];
    if (subs.length === 0) return null;
    if (session) {
      const user = await prisma.user.findUnique({
        where: { id: session.id },
        select: { telegramUserId: true },
      });
      const mine = subs.find((s) => s.chat.telegramChatId === user?.telegramUserId);
      if (mine) return mine;
    }
    return subs[0] ?? null;
  } catch {
    return null;
  }
}

async function queuedBodies(subscriptionId: string): Promise<string[]> {
  try {
    const notes = await prisma.notification.findMany({
      where: { subscriptionId, status: { in: ["queued", "skipped_quiet_hours"] } },
      orderBy: { createdAt: "asc" },
      select: { body: true },
      take: 50,
    });
    return notes.map((n) => n.body);
  } catch {
    return [];
  }
}

export async function digestOf(
  row: RepoRow,
  session: SessionUser | null,
): Promise<DigestSettings> {
  const sub = await pickSubscription(row.id, session);
  if (!sub) {
    return {
      repoId: row.id,
      subscription: null,
      preview: "",
      charCount: 0,
      charLimit: DIGEST_CHAR_LIMIT,
    };
  }
  // The preview is the next digest exactly: same join, same 3 800 cap.
  const preview = renderDigestBodies(await queuedBodies(sub.id));
  return {
    repoId: row.id,
    subscription: subscriptionDto(sub),
    preview,
    charCount: preview.length,
    charLimit: DIGEST_CHAR_LIMIT,
  };
}

export function aiAvailable(): boolean {
  const provider = (process.env.AI_PROVIDER ?? "").trim().toLowerCase();
  const key = (process.env.AI_API_KEY ?? "").trim();
  return provider !== "" && provider !== "echo" && key !== "";
}

export async function settingsOf(
  row: RepoRow,
  session: SessionUser | null,
): Promise<RepoSettings> {
  const sub = await pickSubscription(row.id, session);
  return {
    repo: await repoDto(row),
    subscription: sub ? subscriptionDto(sub) : null,
    aiEnabled: row.aiEnabled,
    aiAvailable: aiAvailable(),
  };
}

// --- writes -----------------------------------------------------------------

export type WriteResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string };

/** Accept a suggested task for a commit. The only mutation the UI performs. */
export async function linkCommitToIssue(
  row: RepoRow,
  sha: string,
  issueNumber: number,
): Promise<WriteResult<{ ok: true; sha: string; issueNumber: number }>> {
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    return { ok: false, status: 400, error: "invalid_issue" };
  }
  try {
    const commit = await prisma.commit.findFirst({
      where: { repoId: row.id, sha },
      select: { id: true, secretFlag: true, issueId: true },
    });
    if (!commit) return { ok: false, status: 404, error: "commit_not_found" };
    // The server never relies on the UI having hidden the button.
    if (commit.secretFlag) return { ok: false, status: 409, error: "secret_flagged" };

    const issue = await prisma.issue.findFirst({
      where: { repoId: row.id, number: issueNumber },
      select: { id: true, state: true },
    });
    if (!issue) return { ok: false, status: 404, error: "issue_not_found" };
    if (issue.state === "closed") return { ok: false, status: 409, error: "issue_closed" };

    // Idempotent: accepting the same pair twice is a no-op.
    if (commit.issueId !== issue.id) {
      await prisma.commit.update({ where: { id: commit.id }, data: { issueId: issue.id } });
    }
    return { ok: true, data: { ok: true, sha, issueNumber } };
  } catch {
    return { ok: false, status: 503, error: "unavailable" };
  }
}

export type DigestPatch = {
  mode?: DigestMode;
  quietHours?: { enabled: boolean; from: string; to: string };
  filters?: DigestFilters;
  muted?: boolean;
};

export async function saveDigest(
  row: RepoRow,
  session: SessionUser | null,
  patch: DigestPatch,
): Promise<WriteResult<DigestSettings>> {
  const sub = await pickSubscription(row.id, session);
  if (!sub) return { ok: false, status: 409, error: "no_subscription" };
  const data: Record<string, unknown> = {};
  if (patch.mode && isDigestMode(patch.mode)) data.digestMode = patch.mode;
  if (patch.quietHours) {
    data.quietHoursStart = patch.quietHours.enabled ? patch.quietHours.from : null;
    data.quietHoursEnd = patch.quietHours.enabled ? patch.quietHours.to : null;
  }
  if (patch.muted !== undefined) data.isMuted = patch.muted;
  if (patch.filters) {
    data.filterBranches = patch.filters.branches;
    data.filterAuthors = patch.filters.authors === "all" ? [] : patch.filters.authors;
    data.filterEventTypes = patch.filters.events;
  }
  try {
    await prisma.subscription.update({ where: { id: sub.id }, data });
    return { ok: true, data: await digestOf(row, session) };
  } catch {
    return { ok: false, status: 503, error: "unavailable" };
  }
}

export async function sendTestDigest(
  row: RepoRow,
  session: SessionUser | null,
): Promise<WriteResult<{ chatTitle: string; deliveredAt: string; ok: boolean }>> {
  const sub = await pickSubscription(row.id, session);
  if (!sub) return { ok: false, status: 409, error: "no_subscription" };
  const preview = renderDigestBodies(await queuedBodies(sub.id));
  const body =
    preview ||
    `CommitIt is connected to ${row.fullName}. Nothing is queued right now, so this is the test message.`;
  try {
    const result = await sendMessage(sub.chat.telegramChatId, body);
    return {
      ok: true,
      data: {
        chatTitle: chatTitleOf(sub.chat),
        deliveredAt: new Date().toISOString(),
        ok: result.ok,
      },
    };
  } catch {
    return {
      ok: true,
      data: { chatTitle: chatTitleOf(sub.chat), deliveredAt: new Date().toISOString(), ok: false },
    };
  }
}

export async function setAiEnabled(
  row: RepoRow,
  session: SessionUser | null,
  enabled: boolean,
): Promise<WriteResult<RepoSettings>> {
  try {
    const updated = await prisma.repo.update({
      where: { id: row.id },
      data: { aiEnabled: enabled },
    });
    return { ok: true, data: await settingsOf(updated as RepoRow, session) };
  } catch {
    return { ok: false, status: 503, error: "unavailable" };
  }
}

/**
 * Stop sending this repository's digests. The chat link goes; the repository,
 * its commits and its issues stay, because history is not a setting.
 */
export async function disconnectRepo(row: RepoRow): Promise<WriteResult<null>> {
  try {
    await prisma.subscription.deleteMany({ where: { repoId: row.id } });
    return { ok: true, data: null };
  } catch {
    return { ok: false, status: 503, error: "unavailable" };
  }
}

export async function chooseRepo(
  session: SessionUser | null,
  fullName: string,
): Promise<WriteResult<Me>> {
  if (!/^[^/\s]+\/[^/\s]+$/.test(fullName)) {
    return { ok: false, status: 400, error: "invalid_repo" };
  }
  try {
    const repo = await prisma.repo.findUnique({ where: { fullName } });
    if (!repo) return { ok: false, status: 404, error: "repo_not_found" };
    if (session && isAuthEnforced() && !(await canAccessRepo(session.id, fullName))) {
      return { ok: false, status: 403, error: "forbidden" };
    }
    if (session) {
      await prisma.repo.update({ where: { id: repo.id }, data: { ownerUserId: session.id } });
    }
    return { ok: true, data: await meDto(session) };
  } catch {
    return { ok: false, status: 503, error: "unavailable" };
  }
}

/** Mint the Telegram deep link. The token is stored hashed, never raw. */
export async function startTelegramLink(
  session: SessionUser | null,
  repoSelector?: string,
): Promise<WriteResult<{ code: string; deepLink: string; pollToken: string }>> {
  const botName = await botUsername();
  if (!botName) return { ok: false, status: 503, error: "bot_not_configured" };

  let fullName = repoSelector ?? "";
  if (!fullName) {
    const rows = await visibleRepoRows(session);
    fullName = rows[0]?.fullName ?? "";
  }
  if (!fullName) return { ok: false, status: 409, error: "no_repo" };

  const issued = await createLinkToken(fullName, session?.login);
  if (!issued) return { ok: false, status: 503, error: "unavailable" };
  return {
    ok: true,
    data: {
      code: issued.token,
      deepLink: `https://t.me/${botName}?start=${issued.token}`,
      // The raw token is the poll proof; it is never written to the database.
      pollToken: issued.token,
    },
  };
}

export async function pollTelegramLink(
  token: string,
): Promise<WriteResult<{ linked: boolean; chatTitle?: string }>> {
  const clean = token.trim().toLowerCase();
  if (!TOKEN_RE.test(clean)) return { ok: true, data: { linked: false } };
  try {
    const row = await prisma.linkToken.findUnique({ where: { tokenHash: hashToken(clean) } });
    if (!row || row.purpose !== PURPOSE_TELEGRAM_LINK) return { ok: true, data: { linked: false } };
    if (!row.usedAt || !row.chatId) return { ok: true, data: { linked: false } };
    const chat = await prisma.chat.findUnique({
      where: { telegramChatId: row.chatId },
      select: { type: true },
    });
    return {
      ok: true,
      data: { linked: true, chatTitle: chat ? chatTitleOf(chat) : undefined },
    };
  } catch {
    return { ok: false, status: 503, error: "unavailable" };
  }
}

/**
 * The onboarding rhythm. Stored where every other preference lives: on the
 * subscription row for that chat × repo (AGENTS.md rule 10).
 */
export async function saveOnboardingMode(
  session: SessionUser | null,
  mode: DigestMode,
  repoSelector?: string,
): Promise<WriteResult<{ saved: true; mode: DigestMode }>> {
  if (!isDigestMode(mode)) return { ok: false, status: 400, error: "invalid_mode" };
  try {
    const repo = repoSelector ? await findRepo(repoSelector) : null;
    if (repo) {
      const sub = await pickSubscription(repo.id, session);
      if (!sub) return { ok: false, status: 409, error: "no_subscription" };
      await prisma.subscription.update({ where: { id: sub.id }, data: { digestMode: mode } });
      return { ok: true, data: { saved: true, mode } };
    }
    // No repo chosen yet: apply to every chat this account has linked.
    if (session) {
      const user = await prisma.user.findUnique({
        where: { id: session.id },
        select: { telegramUserId: true },
      });
      if (!user?.telegramUserId) return { ok: false, status: 409, error: "no_subscription" };
      const chats = await prisma.chat.findMany({
        where: { telegramChatId: user.telegramUserId },
        select: { id: true },
      });
      const res = await prisma.subscription.updateMany({
        where: { chatId: { in: chats.map((c) => c.id) } },
        data: { digestMode: mode },
      });
      if (res.count === 0) return { ok: false, status: 409, error: "no_subscription" };
      return { ok: true, data: { saved: true, mode } };
    }
    return { ok: false, status: 409, error: "no_subscription" };
  } catch {
    return { ok: false, status: 503, error: "unavailable" };
  }
}

/** New activity since a timestamp — what the live bar polls for. */
export async function activitySince(
  row: RepoRow,
  since: Date,
): Promise<{ type: "commit"; at: string; repoId: string; summary: string }[]> {
  try {
    const commits = await prisma.commit.findMany({
      where: { repoId: row.id, createdAt: { gt: since } },
      include: { author: { select: { githubLogin: true } } },
      orderBy: { createdAt: "asc" },
      take: 20,
    });
    return commits.map((c) => ({
      type: "commit" as const,
      at: c.createdAt.toISOString(),
      repoId: row.id,
      summary: `${splitMessage(c.message).subject} — ${c.author?.githubLogin ?? "unknown"}`,
    }));
  } catch {
    return [];
  }
}
