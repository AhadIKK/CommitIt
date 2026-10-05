import type { IncomingMessage, ServerResponse } from "node:http";
import { getActivity } from "../src/dashboard.js";
import type { ActivitySnapshot } from "../src/dashboard.js";

// GET /api/activity?repo=owner/name&days=7 — Vercel mirror. Read-only.
// Never 500s: any failure degrades to an empty snapshot.
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
  const days = Number(url.searchParams.get("days")) || 7;
  let data: ActivitySnapshot;
  try {
    data = await getActivity(repo, days);
  } catch {
    data = { repo, authors: [], totalCommits: 0, totalMergedPRs: 0 };
  }
  res.statusCode = 200;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ ok: true, data }));
}
