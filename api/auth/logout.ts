import type { IncomingMessage, ServerResponse } from "node:http";
import { clearSessionCookieHeader } from "../../src/session.js";

// POST /api/auth/logout — clear the session cookie.
export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
    return;
  }
  res.statusCode = 200;
  res.setHeader("Set-Cookie", clearSessionCookieHeader());
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ ok: true }));
}
