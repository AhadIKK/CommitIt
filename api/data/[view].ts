import type { IncomingMessage, ServerResponse } from "node:http";
import { canAccessRepo, isAuthEnforced } from "../../src/access.js";
import { getActivity, getDigests, getIssues, getProgress } from "../../src/dashboard.js";
import type {
  ActivitySnapshot,
  DigestEntry,
  IssueRow,
  RepoProgress,
} from "../../src/dashboard.js";
import { prisma } from "../../src/db.js";
import { syncUserInstalls } from "../../src/installations.js";
import { isRateLimited } from "../../src/rateLimit.js";
import {
  SESSION_COOKIE,
  getSessionUser,
  parseCookies,
  type SessionUser,
} from "../../src/session.js";

// api/data/[view].ts — every read the dashboard needs, in ONE serverless
// function. /api/me, /api/progress, /api/activity, /api/issues and
// /api/digests used to be five separate functions: five cold-start surfaces
// and five round trips for a single page load, in two waves (the account
// first, then the data, because only the account knows which repo to show).
// vercel.json rewrites every old path here, so no caller changed and the
// route shapes stay identical.
//
// Views: me | progress | activity | issues | digests | all
//
// `all` is the one the dashboard actually calls. It resolves the default repo
// server-side (prefer=1 asks for the account's first repo when the client has
// no explicit choice yet — the same pick the client used to make after a
// second round trip), returns the account alongside the data, and answers in
// one wave. Read-only and never 500s: any store failure degrades to the same
// empty shape the individual endpoints always returned.
export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const view = viewOf(req);
  const url = new URL(req.url ?? "/", "http://localhost");
  const method = req.method ?? "GET";

  if (view === "me") {
    if (method === "POST") return handleMeSync(req, res, url);
    if (method !== "GET") return sendJson(res, 405, { ok: false, error: "method_not_allowed" });
    return handleMe(req, res);
  }

  if (view === "all") {
    if (method !== "GET") return sendJson(res, 405, { ok: false, error: "method_not_allowed" });
    return handleAll(req, res, url);
  }

  if (view === "progress" || view === "activity" || view === "issues" || view === "digests") {
    if (method !== "GET") return sendJson(res, 405, { ok: false, error: "method_not_allowed" });
    const repo = url.searchParams.get("repo");
    if (!repo) return sendJson(res, 400, { ok: false, error: "missing_repo" });
    const denial = await denyRepo(req, repo);
    if (denial) return sendJson(res, denial.status, { ok: false, error: denial.error });
    if (view === "progress") {
      return sendJson(res, 200, { ok: true, data: await loadProgress(repo) });
    }
    if (view === "issues") {
      return sendJson(res, 200, { ok: true, data: await loadIssues(repo) });
    }
    if (view === "digests") {
      const limit = Number(url.searchParams.get("limit")) || 20;
      return sendJson(res, 200, { ok: true, data: await loadDigests(repo, limit) });
    }
    const days = Number(url.searchParams.get("days")) || 7;
    const limit = Number(url.searchParams.get("limit")) || 20;
    return sendJson(res, 200, { ok: true, data: await loadActivity(repo, days, limit) });
  }

  return sendJson(res, 404, { ok: false, error: "not_found" });
}

// --- me (GET) / me?op=sync (POST) -------------------------------------------

async function handleMe(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const session = await sessionOf(req);
  if (!session) return sendJson(res, 401, { ok: false, error: "logged_out" });
  sendJson(res, 200, {
    ok: true,
    data: { login: session.login, avatarUrl: session.avatarUrl, repos: await ownedRepos(session.id) },
  });
}

async function handleMeSync(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  if ((url.searchParams.get("op") ?? "") !== "sync") {
    return sendJson(res, 404, { ok: false, error: "not_found" });
  }
  if (isRateLimited(`me-sync:${clientIp(req)}`, { max: 5 })) {
    return sendJson(res, 429, { ok: false, error: "rate_limited" });
  }
  const session = await sessionOf(req);
  if (!session) return sendJson(res, 401, { ok: false, error: "logged_out" });
  sendJson(res, 200, { ok: true, data: await syncUserInstalls(session.login) });
}

// --- all (the dashboard's single call) --------------------------------------

async function handleAll(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const requested = url.searchParams.get("repo");
  if (!requested) return sendJson(res, 400, { ok: false, error: "missing_repo" });

  const session = await sessionOf(req);
  const mine = session ? await ownedRepos(session.id) : [];
  const prefer = url.searchParams.get("prefer") === "1";

  // The client asks us to pick when it has no repo of its own yet: it sends
  // the placeholder, which it cannot read. `prefer` is a fallback for exactly
  // that — a repo the caller asked for and *can* read is never overridden.
  // This is the pick the client used to make only after asking who it was,
  // i.e. the second wave this endpoint exists to remove.
  let repo = requested;
  let denial = await denyRepo(req, repo, session);
  if (denial && prefer && mine.length > 0) {
    repo = mine[0] as string;
    denial = await denyRepo(req, repo, session);
  }
  if (denial) {
    // Denied — but still 200, carrying the account. This composite read always
    // reports who you are, because the account is what tells the client which
    // onboarding step to show ("link GitHub" vs "install the App"). It used to
    // learn that from a second request to /api/me.
    return sendJson(res, 200, { ok: true, data: { repo, me: meOf(session, mine), denied: denial } });
  }

  const days = Number(url.searchParams.get("days")) || 7;
  const limit = Number(url.searchParams.get("limit")) || 20;
  const [progress, activity, issues, digests] = await Promise.all([
    loadProgress(repo),
    loadActivity(repo, days, limit),
    loadIssues(repo),
    loadDigests(repo, limit),
  ]);

  sendJson(res, 200, {
    ok: true,
    data: { repo, me: meOf(session, mine), progress, activity, issues, digests },
  });
}

function meOf(
  session: SessionUser | null,
  repos: string[],
): { login: string; avatarUrl: string | null; repos: string[] } | null {
  return session ? { login: session.login, avatarUrl: session.avatarUrl, repos } : null;
}

// --- shared -----------------------------------------------------------------

async function sessionOf(req: IncomingMessage): Promise<SessionUser | null> {
  return getSessionUser(
    parseCookies(req.headers.cookie)[SESSION_COOKIE],
    process.env.SESSION_SECRET ?? "",
  );
}

/**
 * The repo gate. Pass the session when the caller already resolved it to skip
 * a second lookup. Returns the same {status, error} pairs as checkRepoAccess.
 */
async function denyRepo(
  req: IncomingMessage,
  repo: string,
  session?: SessionUser | null,
): Promise<{ status: 401 | 403; error: string } | null> {
  if (!isAuthEnforced()) return null;
  const user = session === undefined ? await sessionOf(req) : session;
  if (!user) return { status: 401, error: "logged_out" };
  if (!(await canAccessRepo(user.id, repo))) return { status: 403, error: "forbidden" };
  return null;
}

/** Repos owned by this account. Best-effort: a store blip reads as no repos. */
async function ownedRepos(userId: string): Promise<string[]> {
  try {
    const rows = await prisma.repo.findMany({
      where: { ownerUserId: userId },
      select: { fullName: true },
    });
    return rows.map((r) => r.fullName);
  } catch {
    return [];
  }
}

async function loadProgress(repo: string): Promise<RepoProgress> {
  try {
    return await getProgress(repo);
  } catch {
    return { repo, milestones: [], overall: null };
  }
}

async function loadActivity(repo: string, days: number, limit: number): Promise<ActivitySnapshot> {
  try {
    return await getActivity(repo, days, limit);
  } catch {
    return {
      repo,
      authors: [],
      commits: [],
      totalCommits: 0,
      totalMergedPRs: 0,
      totalCommitsAllTime: 0,
      totalMergedPRsAllTime: 0,
      githubMainCommits: null,
    };
  }
}

async function loadIssues(repo: string): Promise<IssueRow[]> {
  try {
    return await getIssues(repo);
  } catch {
    return [];
  }
}

async function loadDigests(repo: string, limit: number): Promise<DigestEntry[]> {
  try {
    return await getDigests(repo, limit);
  } catch {
    return [];
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

function viewOf(req: IncomingMessage): string {
  const path = (req.url ?? "/").split("?")[0] ?? "";
  return (path.split("/").filter(Boolean).pop() ?? "").toLowerCase();
}

function clientIp(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  return (
    (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0]?.trim()) ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}
