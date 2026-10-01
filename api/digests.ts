import type { IncomingMessage, ServerResponse } from "node:http";
import { getDigests } from "../src/dashboard.js";

// GET /api/digests?repo=owner/name&limit=20 — Vercel mirror. Read-only.
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
  const url = new URL(req.url ?? "/", "http://localhost");
  const repo = url.searchParams.get("repo");
  if (!repo) {
    res.statusCode = 400;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: false, error: "missing_repo" }));
    return;
  }
  const limit = Number(url.searchParams.get("limit")) || 20;
  res.statusCode = 200;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ ok: true, data: await getDigests(repo, limit) }));
}
