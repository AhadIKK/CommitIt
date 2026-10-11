import type { IncomingMessage, ServerResponse } from "node:http";
import { prisma } from "../../src/db.js";
import {
  buildAuthorizeUrl,
  callbackUrl,
  claimUserRepos,
  exchangeCode,
  fetchViewer,
  isSecureCallback,
} from "../../src/githubApp.js";
import { isRateLimited } from "../../src/rateLimit.js";
import {
  SESSION_COOKIE,
  SETUP_COOKIE,
  STATE_COOKIE,
  clearSessionCookieHeader,
  clearSetupCookieHeader,
  createSession,
  genState,
  parseCookies,
  revokeSession,
  sessionCookieHeader,
  sessionCookieValue,
  setupCookieHeader,
  stateCookieHeader,
} from "../../src/session.js";
import { registerInstallFromSetup } from "../../src/installations.js";

// Dynamic auth route: /api/auth/login (+ legacy /api/auth/github),
// /api/auth/callback, /api/auth/logout share ONE serverless function
// (Vercel Hobby caps at 12 per deployment).

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

function actionOf(req: IncomingMessage): string {
  const path = (req.url ?? "/").split("?")[0] ?? "";
  const seg = path.split("/").filter(Boolean).pop() ?? "";
  return seg.toLowerCase();
}

function clientIp(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  return (
    (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0]?.trim()) ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

async function startLogin(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if ((req.method ?? "GET") !== "GET") {
    sendJson(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }
  if (isRateLimited(`oauth:${clientIp(req)}`, { max: 20 })) {
    sendJson(res, 429, { ok: false, error: "rate_limited" });
    return;
  }
  const clientId = (process.env.GITHUB_CLIENT_ID ?? "").trim();
  if (!clientId) {
    sendJson(res, 503, { ok: false, error: "oauth_not_configured" });
    return;
  }
  const redirectUri = callbackUrl(req.headers);
  const state = genState();
  res.statusCode = 302;
  res.setHeader("Set-Cookie", stateCookieHeader(state, isSecureCallback(redirectUri)));
  res.setHeader(
    "Location",
    buildAuthorizeUrl({ clientId, redirectUri, state }),
  );
  res.end();
}

async function finishLogin(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if ((req.method ?? "GET") !== "GET") {
    sendJson(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }
  if (isRateLimited(`oauth:${clientIp(req)}`, { max: 20 })) {
    sendJson(res, 429, { ok: false, error: "rate_limited" });
    return;
  }
  const url = new URL(req.url ?? "/", "http://localhost");
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const setupId = url.searchParams.get("installation_id") ?? "";
  const cookies = parseCookies(req.headers.cookie);
  const expectedState = cookies[STATE_COOKIE] ?? "";
  const clearState = `${STATE_COOKIE}=; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=0`;
  const secure = (req.headers["x-forwarded-proto"] ?? "https") !== "http";

  // OAuth-during-install landing: GitHub redirects here with installation_id
  // (Setup URL is disabled in that mode). No code yet: stash the install id,
  // bounce through login, claim after the session exists.
  if (!code && setupId) {
    try {
      const id = BigInt(setupId);
      if (id <= 0) throw new Error("bad id");
      res.statusCode = 302;
      res.setHeader("Set-Cookie", setupCookieHeader(setupId, secure));
      res.setHeader("Location", "/api/auth/login");
      res.end();
      return;
    } catch {
      res.setHeader("Set-Cookie", clearState);
      sendJson(res, 400, { ok: false, error: "invalid_installation" });
      return;
    }
  }

  if (!code || !state || !expectedState || state !== expectedState) {
    res.setHeader("Set-Cookie", clearState);
    sendJson(res, 400, { ok: false, error: "invalid_state" });
    return;
  }
  const sessionSecret = process.env.SESSION_SECRET ?? "";
  if (!sessionSecret) {
    res.setHeader("Set-Cookie", clearState);
    sendJson(res, 503, { ok: false, error: "sessions_not_configured" });
    return;
  }

  let login = "";
  let avatarUrl: string | undefined;
  let githubId = 0;
  try {
    const token = await exchangeCode(code);
    const viewer = await fetchViewer(token);
    login = viewer.login;
    avatarUrl = viewer.avatarUrl;
    githubId = viewer.id;
  } catch {
    res.setHeader("Set-Cookie", clearState);
    sendJson(res, 502, { ok: false, error: "oauth_failed" });
    return;
  }

  let userRow: { id: string };
  try {
    userRow = await prisma.user.upsert({
      where: { githubLogin: login },
      update: { githubUserId: BigInt(githubId), avatarUrl: avatarUrl ?? null },
      create: { githubLogin: login, githubUserId: BigInt(githubId), avatarUrl: avatarUrl ?? null },
    });
  } catch {
    res.setHeader("Set-Cookie", clearState);
    sendJson(res, 503, { ok: false, error: "unavailable" });
    return;
  }

  // Claim installs belonging to this login (installed before first login).
  // Best-effort: never blocks the login redirect.
  await claimUserRepos(prisma, login);

  // Pending Setup-URL install (stashed pre-login, or on this landing):
  // claim it now that the session exists.
  const stashed = cookies[SETUP_COOKIE] ?? setupId;
  let setupClaimed = false;
  if (stashed) {
    try {
      const out = await registerInstallFromSetup(BigInt(stashed));
      setupClaimed = out.ok;
    } catch {
      setupClaimed = false;
    }
  }

  // Server-side session: only the id hash hits the DB (Phase C).
  let sid: string;
  try {
    sid = await createSession(userRow.id);
  } catch {
    res.setHeader("Set-Cookie", clearState);
    sendJson(res, 503, { ok: false, error: "unavailable" });
    return;
  }

  res.statusCode = 302;
  res.setHeader("Set-Cookie", [
    sessionCookieHeader(sessionCookieValue(sid, sessionSecret), secure),
    clearState,
    clearSetupCookieHeader(),
  ]);
  res.setHeader("Location", setupClaimed ? "/?linked=github&setup_claimed=1" : "/?linked=github");
  res.end();
}

async function logout(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }
  await revokeSession(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
  res.statusCode = 200;
  res.setHeader("Set-Cookie", clearSessionCookieHeader());
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ ok: true }));
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const action = actionOf(req);
  if (action === "login" || action === "github") {
    await startLogin(req, res);
    return;
  }
  if (action === "callback") {
    await finishLogin(req, res);
    return;
  }
  if (action === "logout") {
    await logout(req, res);
    return;
  }
  sendJson(res, 404, { ok: false, error: "not_found" });
}
