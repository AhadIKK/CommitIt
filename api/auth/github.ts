import type { IncomingMessage, ServerResponse } from "node:http";
import { buildAuthorizeUrl, callbackUrl, isSecureCallback } from "../../src/githubApp.js";
import { genState, stateCookieHeader } from "../../src/session.js";

// GET /api/auth/github — start GitHub OAuth login. Sets a short-lived state
// CSRF cookie, then 302s to github.com. No DB touch.
export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if ((req.method ?? "GET") !== "GET") {
    res.statusCode = 405;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
    return;
  }
  const clientId = (process.env.GITHUB_CLIENT_ID ?? "").trim();
  if (!clientId) {
    res.statusCode = 503;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: false, error: "oauth_not_configured" }));
    return;
  }
  const redirectUri = callbackUrl(req.headers);
  const state = genState();
  const secure = isSecureCallback(redirectUri);
  res.statusCode = 302;
  res.setHeader("Set-Cookie", stateCookieHeader(state, secure));
  res.setHeader("Location", buildAuthorizeUrl({ clientId, redirectUri, state }));
  res.end();
}
