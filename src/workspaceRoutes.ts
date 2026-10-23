import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { canAccessRepo, isAuthEnforced } from "./access.js";
import { syncUserInstalls } from "./installations.js";
import type { DigestMode } from "./contract.js";
import { isRateLimited } from "./rateLimit.js";
import { SESSION_COOKIE, getSessionUser, parseCookies, type SessionUser } from "./session.js";
import {
  activitySince,
  alertsOf,
  chooseRepo,
  digestOf,
  disconnectRepo,
  findRepo,
  goalOf,
  goalsOf,
  linkCommitToIssue,
  meDto,
  peopleOf,
  pollTelegramLink,
  saveDigest,
  saveOnboardingMode,
  sendTestDigest,
  setAiEnabled,
  settingsOf,
  startTelegramLink,
  todayOf,
} from "./workspace.js";

// workspaceRoutes.ts — the HTTP surface for the signed-in product.
//
// One router, two hosts: Fastify registers it for local dev (`npm run dev`),
// and `api/product/[...path].ts` adapts the same function to Vercel. There is
// exactly one implementation of every rule, so the two hosts cannot drift.
//
// Reads degrade to empty (never a 500). Writes answer honestly: 404 when the
// row is not there, 409 when the state forbids it, 503 when the store is down.

export type WorkspaceRequest = {
  method: string;
  /** Path after `/api` (or `/api/product` on Vercel): "/repos/:id/today". */
  path: string;
  query: URLSearchParams;
  body: unknown;
  cookies: Record<string, string>;
  ip: string;
};

export type WorkspaceResponse = {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
};

/** Strip the host prefix so both hosts route the same path. */
export function workspacePath(rawPath: string): string {
  const path = (rawPath.split("?")[0] ?? "/").replace(/\/+$/, "");
  const withoutApi = path.replace(/^\/api(\/product)?(?=\/|$)/, "");
  return withoutApi || "/";
}

function json(status: number, body: unknown): WorkspaceResponse {
  return { status, body };
}

function fail(status: number, error: string): WorkspaceResponse {
  return { status, body: { ok: false, error } };
}

const WRITE_LIMIT = { max: 30 };

const LinkBody = z.object({ issueNumber: z.number().int().positive() });
const AiBody = z.object({ enabled: z.boolean() });
const QuietBody = z.object({
  enabled: z.boolean(),
  from: z.string(),
  to: z.string(),
});
const FiltersBody = z.object({
  branches: z.array(z.string()),
  authors: z.union([z.literal("all"), z.array(z.string())]),
  events: z.array(z.enum(["commits", "pull_requests", "issues"])),
});
const DigestBody = z.object({
  mode: z.enum(["instant", "hourly", "daily", "weekly"]).optional(),
  quietHours: QuietBody.optional(),
  filters: FiltersBody.optional(),
  muted: z.boolean().optional(),
});
const RepoBody = z.object({ fullName: z.string(), repo: z.string().optional() });
const LinkStartBody = z.object({ repo: z.string().optional() });
const ModeBody = z.object({
  mode: z.enum(["instant", "hourly", "daily", "weekly"]),
  repo: z.string().optional(),
});

async function sessionOf(req: WorkspaceRequest): Promise<SessionUser | null> {
  return getSessionUser(req.cookies[SESSION_COOKIE], process.env.SESSION_SECRET ?? "");
}

type Gate = { session: SessionUser | null; row: Awaited<ReturnType<typeof findRepo>> } | { denial: WorkspaceResponse };

/**
 * Session + repo gate. Mirrors src/access.ts: when OAuth is not configured the
 * read API is public (there is no way to log in), otherwise the caller must own
 * the repo or belong to its installation.
 */
async function gateRepo(req: WorkspaceRequest, selector: string): Promise<Gate> {
  const session = await sessionOf(req);
  if (isAuthEnforced() && !session) return { denial: fail(401, "logged_out") };
  const row = await findRepo(decodeURIComponent(selector));
  if (!row) return { denial: fail(404, "repo_not_found") };
  if (isAuthEnforced() && session && !(await canAccessRepo(session.id, row.fullName))) {
    return { denial: fail(403, "forbidden") };
  }
  return { session, row };
}

async function route(req: WorkspaceRequest): Promise<WorkspaceResponse | null> {
  const path = req.path;
  const method = req.method.toUpperCase();

  // --- account ------------------------------------------------------------
  if (method === "GET" && path === "/me") {
    return json(200, await meDto(await sessionOf(req)));
  }
  // The install re-sync that used to live on `POST /api/me?op=sync` in
  // src/auth.ts: same path, same shape, but now inside the router both hosts
  // share, so a serverless rewrite cannot quietly drop it.
  if (method === "POST" && path === "/me") {
    if ((req.query.get("op") ?? "") !== "sync") return fail(404, "not_found");
    if (isRateLimited(`workspace-me-sync:${req.ip}`, { max: 5 })) return fail(429, "rate_limited");
    const session = await sessionOf(req);
    if (!session) return fail(401, "logged_out");
    return json(200, { ok: true, data: await syncUserInstalls(session.login) });
  }
  if (method === "GET" && path === "/repos") {
    const me = await meDto(await sessionOf(req));
    return json(200, me.repos);
  }

  // --- onboarding / auth ---------------------------------------------------
  if (method === "GET" && path === "/auth/github/start") {
    const slug = (process.env.GITHUB_APP_SLUG ?? "").trim();
    if (slug) return json(200, { url: `https://github.com/apps/${slug}/installations/new` });
    if ((process.env.GITHUB_CLIENT_ID ?? "").trim()) return json(200, { url: "/api/auth/login" });
    return fail(503, "github_not_configured");
  }
  if (method === "POST" && path === "/auth/github/repo") {
    if (isRateLimited(`workspace-repo:${req.ip}`, WRITE_LIMIT)) return fail(429, "rate_limited");
    const parsed = RepoBody.safeParse(req.body ?? {});
    if (!parsed.success) return fail(400, "invalid_repo");
    const result = await chooseRepo(await sessionOf(req), parsed.data.fullName);
    return result.ok ? json(200, result.data) : fail(result.status, result.error);
  }
  if (method === "POST" && path === "/link/telegram") {
    if (isRateLimited(`workspace-link:${req.ip}`, WRITE_LIMIT)) return fail(429, "rate_limited");
    const parsed = LinkStartBody.safeParse(req.body ?? {});
    const result = await startTelegramLink(
      await sessionOf(req),
      parsed.success ? parsed.data.repo : undefined,
    );
    return result.ok ? json(200, result.data) : fail(result.status, result.error);
  }
  if (method === "GET" && path.startsWith("/link/telegram/")) {
    const token = decodeURIComponent(path.slice("/link/telegram/".length));
    const result = await pollTelegramLink(token);
    return result.ok ? json(200, result.data) : fail(result.status, result.error);
  }
  if (method === "POST" && path === "/onboarding/mode") {
    if (isRateLimited(`workspace-mode:${req.ip}`, WRITE_LIMIT)) return fail(429, "rate_limited");
    const parsed = ModeBody.safeParse(req.body ?? {});
    if (!parsed.success) return fail(400, "invalid_mode");
    const result = await saveOnboardingMode(
      await sessionOf(req),
      parsed.data.mode as DigestMode,
      parsed.data.repo,
    );
    return result.ok ? json(200, result.data) : fail(result.status, result.error);
  }

  // --- repo-scoped --------------------------------------------------------
  const match = /^\/repos\/([^/]+)(\/.*)?$/.exec(path);
  if (!match) return null;
  const selector = match[1] ?? "";
  const rest = match[2] ?? "";
  const gate = await gateRepo(req, selector);
  if ("denial" in gate) return gate.denial;

  const row = gate.row;
  if (!row) return fail(404, "repo_not_found");
  const session = gate.session;

  if (method === "GET" && rest === "/today") return json(200, await todayOf(row));
  if (method === "GET" && rest === "/goals") return json(200, await goalsOf(row.id));
  if (method === "GET" && rest.startsWith("/goals/")) {
    const detail = await goalOf(row, decodeURIComponent(rest.slice("/goals/".length)));
    return detail ? json(200, detail) : fail(404, "goal_not_found");
  }
  if (method === "GET" && rest === "/people") return json(200, await peopleOf(row));
  if (method === "GET" && rest === "/alerts") return json(200, await alertsOf(row));
  if (method === "GET" && rest === "/digest") return json(200, await digestOf(row, session));
  if (method === "GET" && rest === "/settings") return json(200, await settingsOf(row, session));

  if (method === "GET" && rest === "/events") {
    const raw = req.query.get("since") ?? "";
    const since = /^\d{4}-\d{2}-\d{2}T/.test(raw) ? new Date(raw) : new Date(Date.now() - 300_000);
    const from = Number.isNaN(since.getTime()) ? new Date(Date.now() - 300_000) : since;
    return json(200, await activitySince(row, from));
  }

  if (method === "PUT" && rest === "/digest") {
    if (isRateLimited(`workspace-digest:${req.ip}`, WRITE_LIMIT)) return fail(429, "rate_limited");
    const parsed = DigestBody.safeParse(req.body ?? {});
    if (!parsed.success) return fail(400, "invalid_digest");
    const result = await saveDigest(row, session, parsed.data);
    return result.ok ? json(200, result.data) : fail(result.status, result.error);
  }
  if (method === "POST" && rest === "/digest/test") {
    if (isRateLimited(`workspace-test:${req.ip}`, { max: 5 })) return fail(429, "rate_limited");
    const result = await sendTestDigest(row, session);
    return result.ok ? json(200, result.data) : fail(result.status, result.error);
  }
  if (method === "PUT" && rest === "/settings/ai") {
    if (isRateLimited(`workspace-ai:${req.ip}`, WRITE_LIMIT)) return fail(429, "rate_limited");
    const parsed = AiBody.safeParse(req.body ?? {});
    if (!parsed.success) return fail(400, "invalid_body");
    const result = await setAiEnabled(row, session, parsed.data.enabled);
    return result.ok ? json(200, result.data) : fail(result.status, result.error);
  }
  if (method === "DELETE" && rest === "/connection") {
    if (isRateLimited(`workspace-disconnect:${req.ip}`, WRITE_LIMIT)) return fail(429, "rate_limited");
    const result = await disconnectRepo(row);
    return result.ok ? { status: 204 } : fail(result.status, result.error);
  }

  const linkMatch = /^\/commits\/([^/]+)\/link$/.exec(rest);
  if (method === "POST" && linkMatch) {
    if (isRateLimited(`workspace-link-commit:${req.ip}`, WRITE_LIMIT)) {
      return fail(429, "rate_limited");
    }
    const parsed = LinkBody.safeParse(req.body ?? {});
    if (!parsed.success) return fail(400, "invalid_issue");
    const result = await linkCommitToIssue(
      row,
      decodeURIComponent(linkMatch[1] ?? ""),
      parsed.data.issueNumber,
    );
    return result.ok ? json(200, result.data) : fail(result.status, result.error);
  }

  return null;
}

/** The one entry point both hosts call. `null` = no such route. */
export async function handleWorkspace(req: WorkspaceRequest): Promise<WorkspaceResponse | null> {
  try {
    return await route(req);
  } catch {
    // A bug in one screen must not take the product down with it.
    return fail(503, "unavailable");
  }
}

// --- Fastify (local dev / Render) ------------------------------------------

function toWorkspaceRequest(req: FastifyRequest): WorkspaceRequest {
  const url = new URL(req.raw.url ?? "/", "http://localhost");
  return {
    method: req.method,
    path: workspacePath(url.pathname),
    query: url.searchParams,
    body: req.body ?? {},
    cookies: parseCookies(req.headers.cookie),
    ip: req.ip ?? req.headers["x-forwarded-for"]?.toString() ?? "unknown",
  };
}

async function replyWith(reply: FastifyReply, out: WorkspaceResponse | null): Promise<void> {
  if (!out) {
    await reply.code(404).send({ ok: false, error: "not_found" });
    return;
  }
  if (out.headers) await reply.headers(out.headers);
  if (out.status === 204) {
    await reply.code(204).send();
    return;
  }
  await reply.code(out.status).send(out.body);
}

export async function registerWorkspaceRoutes(app: FastifyInstance) {
  const handler = async (req: FastifyRequest, reply: FastifyReply) => {
    await replyWith(reply, await handleWorkspace(toWorkspaceRequest(req)));
  };
  for (const path of [
    "/api/repos",
    "/api/repos/*",
    "/api/auth/github/start",
    "/api/auth/github/repo",
    "/api/link/telegram",
    "/api/link/telegram/*",
    "/api/onboarding/mode",
  ]) {
    app.route({ method: ["GET", "POST", "PUT", "DELETE"], url: path, handler });
  }
  // Both verbs: GET is the account, POST is the install re-sync (?op=sync).
  app.route({ method: ["GET", "POST"], url: "/api/me", handler });
}

/** A small helper the tests use: does this path belong to the workspace API? */
export function isWorkspacePath(path: string): boolean {
  const p = workspacePath(path);
  return (
    p === "/me" ||
    p === "/repos" ||
    p.startsWith("/repos/") ||
    p.startsWith("/auth/github/") ||
    p.startsWith("/link/telegram") ||
    p === "/onboarding/mode"
  );
}
