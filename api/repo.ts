import type { IncomingMessage, ServerResponse } from "node:http";
import { prisma } from "../src/db.js";
import { registerInstallFromSetup } from "../src/installations.js";
import { isRateLimited } from "../src/rateLimit.js";
import { SESSION_COOKIE, getSessionUser, parseCookies } from "../src/session.js";

// GET /api/repo?repo=owner/name — project profile: install state.
// Read-only. Degrades to installed:false on DB failure.
//
// GET /api/repo?installation_id=123 — setup-redirect claim (fallback when
// the installation webhook events are unavailable). Requires a session;
// registers the install as the App and queues a backfill. Rate-limited.
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
  const setupId = url.searchParams.get("installation_id");
  if (setupId) {
    await handleSetupClaim(req, res, setupId);
    return;
  }
  const repo = url.searchParams.get("repo");
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

async function handleSetupClaim(
  req: IncomingMessage,
  res: ServerResponse,
  setupId: string,
): Promise<void> {
  const send = (status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(body));
  };
  let installationId: bigint;
  try {
    installationId = BigInt(setupId);
    if (installationId <= 0) throw new Error("bad id");
  } catch {
    send(400, { ok: false, error: "invalid_installation" });
    return;
  }
  const forwarded = req.headers["x-forwarded-for"];
  const ip =
    (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0]?.trim()) ||
    req.socket?.remoteAddress ||
    "unknown";
  if (isRateLimited(`install-setup:${ip}`, { max: 20 })) {
    send(429, { ok: false, error: "rate_limited" });
    return;
  }
  const session = await getSessionUser(
    parseCookies(req.headers.cookie)[SESSION_COOKIE],
    process.env.SESSION_SECRET ?? "",
  );
  if (!session) {
    send(401, { ok: false, error: "logged_out" });
    return;
  }
  const out = await registerInstallFromSetup(installationId);
  if (!out.ok) {
    const status =
      out.error === "app_not_configured" ? 503 : out.error === "unavailable" ? 503 : 502;
    send(status, { ok: false, error: out.error });
    return;
  }
  send(200, { ok: true, data: { installationId: installationId.toString(), repos: out.repos } });
}
