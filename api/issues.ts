import type { IncomingMessage, ServerResponse } from "node:http";
import { getIssues } from "../src/dashboard.js";

// GET /api/issues?repo=owner/name — Vercel mirror. Read-only.
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
  const repo = new URL(req.url ?? "/", "http://localhost").searchParams.get("repo");
  if (!repo) {
    res.statusCode = 400;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: false, error: "missing_repo" }));
    return;
  }
  res.statusCode = 200;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ ok: true, data: await getIssues(repo) }));
}
