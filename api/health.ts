import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * GET /api/health — Vercel serverless health check.
 * Mirrors the `GET /health` route in `src/index.ts` (used by Render/local).
 */
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
  res.statusCode = 200;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ ok: true }));
}
