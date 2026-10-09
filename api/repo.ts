import type { IncomingMessage, ServerResponse } from "node:http";
import { prisma } from "../src/db.js";

// GET /api/repo?repo=owner/name — project profile: install state.
// Read-only. Degrades to installed:false on DB failure.
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
  let installed = false;
  try {
    const row = await prisma.repo.findUnique({
      where: { fullName: repo },
      select: { installationId: true },
    });
    installed = row?.installationId != null;
  } catch {
    installed = false;
  }
  res.statusCode = 200;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ ok: true, data: { fullName: repo, installed } }));
}
