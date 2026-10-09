import type { IncomingMessage, ServerResponse } from "node:http";
import { checkRepoAccess } from "../src/access.js";
import { getActivity } from "../src/dashboard.js";
import type { ActivitySnapshot } from "../src/dashboard.js";
import { SESSION_COOKIE, parseCookies } from "../src/session.js";

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
  const checked = await checkRepoAccess(
    parseCookies(req.headers.cookie)[SESSION_COOKIE],
    process.env.SESSION_SECRET ?? "",
    repo,
  );
  if ("denial" in checked) {
    res.statusCode = checked.denial.status;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: false, error: checked.denial.error }));
    return;
  }
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
