import type { IncomingMessage, ServerResponse } from "node:http";
import { prisma } from "../../src/db.js";
import {
  buildAuthorizeUrl,
  callbackUrl,
  exchangeCode,
  fetchViewer,
  isSecureCallback,
} from "../../src/githubApp.js";
import {
  STATE_COOKIE,
  clearSessionCookieHeader,
  genState,
  parseCookies,
  sessionCookieHeader,
  signSession,
  stateCookieHeader,
} from "../../src/session.js";

// Dynamic auth route: /api/auth/github, /api/auth/callback, /api/auth/logout
// share ONE serverless function (Vercel Hobby caps at 12 per deployment).
// Same semantics as the three separate handlers it replaces.

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

async function startLogin(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if ((req.method ?? "GET") !== "GET") {
    sendJson(res, 405, { ok: false, error: "method_not_allowed" });
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
  const url = new URL(req.url ?? "/", "http://localhost");
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const cookies = parseCookies(req.headers.cookie);
  const expectedState = cookies[STATE_COOKIE] ?? "";
  const clearState = `${STATE_COOKIE}=; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=0`;

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

  try {
    await prisma.user.upsert({
      where: { githubLogin: login },
      update: { githubUserId: BigInt(githubId), avatarUrl: avatarUrl ?? null },
      create: { githubLogin: login, githubUserId: BigInt(githubId), avatarUrl: avatarUrl ?? null },
    });
  } catch {
    res.setHeader("Set-Cookie", clearState);
    sendJson(res, 503, { ok: false, error: "unavailable" });
    return;
  }

  const secure = (req.headers["x-forwarded-proto"] ?? "https") !== "http";
  res.statusCode = 302;
  res.setHeader("Set-Cookie", [
    sessionCookieHeader(signSession({ login, avatarUrl }, sessionSecret), secure),
    clearState,
  ]);
  res.setHeader("Location", "/?linked=github");
  res.end();
}

async function logout(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }
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
  if (action === "github") {
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
