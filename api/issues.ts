import type { IncomingMessage, ServerResponse } from "node:http";
import { checkRepoAccess } from "../src/access.js";
import { getIssues } from "../src/dashboard.js";
import type { IssueRow } from "../src/dashboard.js";
import { SESSION_COOKIE, parseCookies } from "../src/session.js";

// GET /api/issues?repo=owner/name — Vercel mirror. Read-only.
// Never 500s: any failure degrades to an empty list.
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
  let data: IssueRow[];
  try {
    data = await getIssues(repo);
  } catch {
    data = [];
  }
  res.statusCode = 200;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ ok: true, data }));
}
