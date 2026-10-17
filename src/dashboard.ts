import type { FastifyInstance, FastifyRequest } from "fastify";
import { checkRepoAccess, isAuthEnforced, type AccessDenial } from "./access.js";
import { prisma } from "./db.js";
import { getMainBranchCommitCount } from "./githubCounts.js";
import { milestoneProgress } from "./progress.js";
import { SESSION_COOKIE, parseCookies } from "./session.js";

// dashboard.ts — read-only BFF for the Phase 7 dashboard.
// Types here are shared with dashboard/ (imported as @src/dashboard.js).
// No mutations, ever. All data access degrades to empty on DB failure.

// --- Shared types (imported by dashboard/) ---

export type MilestoneSnapshot = {
  title: string;
  percent: number;
  closedPoints: number;
  totalPoints: number;
  open: number;
  closed: number;
  label: string;
};

export type RepoProgress = {
  repo: string;
  milestones: MilestoneSnapshot[];
  overall: MilestoneSnapshot | null;
};

export type AuthorStat = { login: string; commits: number; mergedPRs: number };

/**
 * One commit as the dashboard needs it for "what each commit is about".
 * Metadata + short summaries only — never file contents or diffs (AGENTS.md).
 */
export type CommitRow = {
  sha: string;
  shortSha: string;
  /** First line of the commit message. */
  subject: string;
  /** LLM summary, or null when there is none / it only echoes the subject. */
  aiSummary: string | null;
  author: string;
  category: string | null;
  branch: string | null;
  committedAt: string | null;
  isMerge: boolean;
  secretFlag: boolean;
  issueNumber: number | null;
};

export type ActivitySnapshot = {
  repo: string;
  authors: AuthorStat[];
  /** Most recent commits in the window, newest first. */
  commits: CommitRow[];
  totalCommits: number;
  totalMergedPRs: number;
  totalCommitsAllTime: number;
  totalMergedPRsAllTime: number;
  /** Live default-branch count from GitHub; null when unreachable (use totalCommitsAllTime). */
  githubMainCommits: number | null;
};

export type IssueRow = {
  number: number;
  title: string;
  state: "open" | "closed";
  weight: number;
  milestone: string | null;
};

export type DigestEntry = {
  id: string;
  type: string;
  body: string;
  status: string;
  createdAt: string;
};

// --- Pure shaping (unit-tested, no DB) ---

export function shapeMilestones(
  rows: { title: string; issues: { state: string; sizeWeight: number }[] }[],
): MilestoneSnapshot[] {
  return rows.map((m) => {
    const res = milestoneProgress(
      m.issues.map((i) => ({
        state: i.state === "closed" ? "closed" : "open",
        sizeWeight: i.sizeWeight,
      })),
    );
    if (res.empty) {
      return {
        title: m.title,
        percent: 0,
        closedPoints: 0,
        totalPoints: 0,
        open: m.issues.length,
        closed: 0,
        label: "no issues yet",
      };
    }
    return {
      title: m.title,
      percent: res.percent,
      closedPoints: res.closedPoints,
      totalPoints: res.totalPoints,
      open: res.total - res.closed,
      closed: res.closed,
      label: res.label,
    };
  });
}

export function shapeActivity(
  commits: { authorLogin: string }[],
  mergedPRs: { authorLogin: string }[],
): AuthorStat[] {
  const byAuthor = new Map<string, AuthorStat>();
  for (const c of commits) {
    const row = byAuthor.get(c.authorLogin) ?? { login: c.authorLogin, commits: 0, mergedPRs: 0 };
    row.commits += 1;
    byAuthor.set(c.authorLogin, row);
  }
  for (const p of mergedPRs) {
    const row = byAuthor.get(p.authorLogin) ?? { login: p.authorLogin, commits: 0, mergedPRs: 0 };
    row.mergedPRs += 1;
    byAuthor.set(p.authorLogin, row);
  }
  return [...byAuthor.values()].sort(
    (a, b) => b.commits + b.mergedPRs - (a.commits + a.mergedPRs),
  );
}

/** Longest subject we will render; commit subjects are conventionally short. */
export const COMMIT_SUBJECT_MAX = 200;

/** First line of a commit message, trimmed and capped. Never multi-line. */
export function commitSubject(message: string): string {
  const first = message.split("\n", 1)[0]?.trim() ?? "";
  return first.length > COMMIT_SUBJECT_MAX ? `${first.slice(0, COMMIT_SUBJECT_MAX)}…` : first;
}

/**
 * The stored summary, or null when it tells us nothing more than the subject.
 *
 * Both the echo stub (`"AI summary: <first line>"`) and the degraded path
 * (summary === the whole commit message) echo the message back. The Telegram
 * formatter hides those because it still holds the in-memory `degraded` flag;
 * the DB keeps only the text, so compare instead of trusting it. Without this
 * the section prints the subject twice for every commit.
 */
export function meaningfulSummary(message: string, aiSummary: string | null): string | null {
  const summary = aiSummary?.trim();
  if (!summary) return null;
  // Compare heads so the echo's 120-char slice still matches a longer subject.
  const head = (s: string) => s.trim().toLowerCase().slice(0, 120);
  const stripped = summary.replace(/^ai summary:\s*/i, "");
  if (head(summary) === head(message)) return null;
  if (head(stripped) === head(commitSubject(message))) return null;
  return summary;
}

export function shapeCommits(
  rows: {
    sha: string;
    message: string;
    aiSummary: string | null;
    category: string | null;
    branch: string | null;
    committedAt: Date | null;
    isMerge: boolean;
    secretFlag: boolean;
    author: { githubLogin: string } | null;
    issue: { number: number } | null;
  }[],
): CommitRow[] {
  return rows.map((c) => ({
    sha: c.sha,
    shortSha: c.sha.slice(0, 7),
    subject: commitSubject(c.message),
    aiSummary: meaningfulSummary(c.message, c.aiSummary),
    // Unattributed rows must read honestly: a blank author would look like a
    // rendering bug rather than a data gap (AGENTS.md rule 12).
    author: c.author?.githubLogin ?? "unknown",
    category: c.category,
    branch: c.branch,
    committedAt: c.committedAt ? c.committedAt.toISOString() : null,
    isMerge: c.isMerge,
    secretFlag: c.secretFlag,
    issueNumber: c.issue?.number ?? null,
  }));
}

// --- Data access (Prisma, graceful empty fallback) ---

async function findRepo(fullName: string) {
  try {
    return await prisma.repo.findUnique({ where: { fullName } });
  } catch {
    return null;
  }
}

export async function getProgress(repo: string): Promise<RepoProgress> {
  const empty: RepoProgress = { repo, milestones: [], overall: null };
  const repoRow = await findRepo(repo);
  if (!repoRow) return empty;
  try {
    const milestones = await prisma.milestone.findMany({
      where: { repoId: repoRow.id },
      include: { issues: { select: { state: true, sizeWeight: true } } },
    });
    const shaped = shapeMilestones(
      milestones.map((m) => ({ title: m.title, issues: m.issues })),
    );
    const all = milestones.flatMap((m) => m.issues);
    const overallRes = milestoneProgress(
      all.map((i) => ({
        state: (i.state === "closed" ? "closed" : "open") as "open" | "closed",
        sizeWeight: i.sizeWeight,
      })),
    );
    return {
      repo,
      milestones: shaped,
      overall: overallRes.empty
        ? null
        : {
            title: "Overall",
            percent: overallRes.percent,
            closedPoints: overallRes.closedPoints,
            totalPoints: overallRes.totalPoints,
            open: overallRes.total - overallRes.closed,
            closed: overallRes.closed,
            label: overallRes.label,
          },
    };
  } catch {
    return empty;
  }
}

export async function getActivity(
  repo: string,
  days = 7,
  commitLimit = 20,
): Promise<ActivitySnapshot> {
  const empty: ActivitySnapshot = {
    repo,
    authors: [],
    commits: [],
    totalCommits: 0,
    totalMergedPRs: 0,
    totalCommitsAllTime: 0,
    totalMergedPRsAllTime: 0,
    githubMainCommits: null,
  };
  const repoRow = await findRepo(repo);
  if (!repoRow) return empty;
  try {
    const since = new Date(Date.now() - days * 86_400_000);
    // Activity is the commit's real author date, not when our row was
    // written (backfills/repairs would otherwise land all history in the
    // window). Legacy rows with no committedAt fall back to insert time so
    // they still surface.
    const window = {
      OR: [
        { committedAt: { gte: since } },
        { committedAt: null, createdAt: { gte: since } },
      ],
    };
    const [commits, prs, allCommits, allPrs, live, recent] = await Promise.all([
      prisma.commit.findMany({
        where: { repoId: repoRow.id, ...window },
        include: { author: { select: { githubLogin: true } } },
      }),
      prisma.pullRequest.findMany({
        where: { repoId: repoRow.id, state: "merged", mergedAt: { gte: since } },
        include: { author: { select: { githubLogin: true } } },
      }),
      prisma.commit.count({ where: { repoId: repoRow.id } }),
      prisma.pullRequest.count({ where: { repoId: repoRow.id, state: "merged" } }),
      getMainBranchCommitCount(repo, {
        installationId: repoRow.installationId,
        defaultBranch: repoRow.defaultBranch,
      }).catch(() => ({ count: null as number | null, defaultBranch: null as string | null })),
      // Per-commit detail for the "what each commit is about" list. Newest
      // first by the commit's own date; legacy nulls sort last, never first.
      prisma.commit.findMany({
        where: { repoId: repoRow.id, ...window },
        include: {
          author: { select: { githubLogin: true } },
          issue: { select: { number: true } },
        },
        orderBy: [{ committedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
        take: Math.min(Math.max(commitLimit, 1), 50),
      }),
    ]);
    const authors = shapeActivity(
      commits.map((c) => ({ authorLogin: c.author?.githubLogin ?? "unknown" })),
      prs.map((p) => ({ authorLogin: p.author?.githubLogin ?? "unknown" })),
    );
    return {
      repo,
      authors,
      commits: shapeCommits(recent),
      totalCommits: commits.length,
      totalMergedPRs: prs.length,
      totalCommitsAllTime: allCommits,
      totalMergedPRsAllTime: allPrs,
      githubMainCommits: live.count,
    };
  } catch {
    return empty;
  }
}

export async function getIssues(repo: string): Promise<IssueRow[]> {
  const repoRow = await findRepo(repo);
  if (!repoRow) return [];
  try {
    const issues = await prisma.issue.findMany({
      where: { repoId: repoRow.id },
      include: { milestone: { select: { title: true } } },
      orderBy: { number: "asc" },
    });
    return issues.map((i) => ({
      number: i.number,
      title: i.title,
      state: (i.state === "closed" ? "closed" : "open") as "open" | "closed",
      weight: i.sizeWeight,
      milestone: i.milestone?.title ?? null,
    }));
  } catch {
    return [];
  }
}

export async function getDigests(repo: string, limit = 20): Promise<DigestEntry[]> {
  const repoRow = await findRepo(repo);
  if (!repoRow) return [];
  try {
    const subs = await prisma.subscription.findMany({
      where: { repoId: repoRow.id },
      select: { id: true },
    });
    const notes = await prisma.notification.findMany({
      where: { subscriptionId: { in: subs.map((s) => s.id) } },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 50),
    });
    return notes.map((n) => ({
      id: n.id,
      type: n.type,
      body: n.body,
      status: n.status,
      createdAt: n.createdAt.toISOString(),
    }));
  } catch {
    return [];
  }
}

// --- Fastify routes (Render/local). Vercel mirrors live in api/*.ts. ---
// Phase C: every BFF route requires a session + repo access (401 logged out,
// 403 forbidden). DB outages still degrade to empty (200), never 500.

async function accessDenial(req: FastifyRequest): Promise<AccessDenial | null> {
  if (!isAuthEnforced()) return null; // webhooks-only setup: public read API
  const repo = (req.query as { repo?: string }).repo ?? "";
  const checked = await checkRepoAccess(
    parseCookies(req.headers.cookie)[SESSION_COOKIE],
    process.env.SESSION_SECRET ?? "",
    repo,
  );
  return "denial" in checked ? checked.denial : null;
}

export async function registerDashboardRoutes(app: FastifyInstance) {
  app.get("/api/progress", async (req, reply) => {
    const repo = (req.query as { repo?: string }).repo;
    if (!repo) return reply.code(400).send({ ok: false, error: "missing_repo" });
    const denied = await accessDenial(req);
    if (denied) return reply.code(denied.status).send({ ok: false, error: denied.error });
    return reply.send({ ok: true, data: await getProgress(repo) });
  });
  app.get("/api/activity", async (req, reply) => {
    const q = req.query as { repo?: string; days?: string; limit?: string };
    if (!q.repo) return reply.code(400).send({ ok: false, error: "missing_repo" });
    const denied = await accessDenial(req);
    if (denied) return reply.code(denied.status).send({ ok: false, error: denied.error });
    const days = q.days ? Number(q.days) || 7 : 7;
    const limit = q.limit ? Number(q.limit) || 20 : 20;
    return reply.send({ ok: true, data: await getActivity(q.repo, days, limit) });
  });
  app.get("/api/issues", async (req, reply) => {
    const repo = (req.query as { repo?: string }).repo;
    if (!repo) return reply.code(400).send({ ok: false, error: "missing_repo" });
    const denied = await accessDenial(req);
    if (denied) return reply.code(denied.status).send({ ok: false, error: denied.error });
    return reply.send({ ok: true, data: await getIssues(repo) });
  });
  app.get("/api/digests", async (req, reply) => {
    const q = req.query as { repo?: string; limit?: string };
    if (!q.repo) return reply.code(400).send({ ok: false, error: "missing_repo" });
    const denied = await accessDenial(req);
    if (denied) return reply.code(denied.status).send({ ok: false, error: denied.error });
    const limit = q.limit ? Number(q.limit) || 20 : 20;
    return reply.send({ ok: true, data: await getDigests(q.repo, limit) });
  });
}
