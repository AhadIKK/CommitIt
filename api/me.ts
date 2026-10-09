import type { IncomingMessage, ServerResponse } from "node:http";
import { SESSION_COOKIE, parseCookies, verifySession } from "../src/session.js";

// GET /api/me — current linked GitHub account from the session cookie.
// 401 when logged out. Stateless: no DB touch.
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
  const session = verifySession(
    parseCookies(req.headers.cookie)[SESSION_COOKIE],
    process.env.SESSION_SECRET ?? "",
  );
  if (!session) {
    res.statusCode = 401;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: false, error: "logged_out" }));
    return;
  }
  res.statusCode = 200;
  res.setHeader("content-type", "application/json");
  res.end(
    JSON.stringify({
      ok: true,
      data: { login: session.login, avatarUrl: session.avatarUrl ?? null },
    }),
  );
}
