import type { IncomingMessage, ServerResponse } from "node:http";
import { exchangeCode, fetchViewer } from "../../src/githubApp.js";
import { prisma } from "../../src/db.js";
import {
  STATE_COOKIE,
  parseCookies,
  sessionCookieHeader,
  signSession,
} from "../../src/session.js";

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

// GET /api/auth/callback?code=..&state=.. — finish GitHub OAuth login.
// Validates state, exchanges the code (token never stored), upserts the
// User by githubLogin, sets the session cookie, redirects home.
export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
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
