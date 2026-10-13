import type { IncomingMessage, ServerResponse } from "node:http";
import { prisma } from "../src/db.js";
import { syncUserInstalls } from "../src/installations.js";
import { isRateLimited } from "../src/rateLimit.js";
import { SESSION_COOKIE, getSessionUser, parseCookies } from "../src/session.js";

// GET /api/me — current linked GitHub account (server-side session),
// plus repos owned by this account. 401 when logged out.
// POST /api/me?op=sync — re-run install attribution for this account
// ("Sync now" repair: installs made outside our redirect get recorded).
// Same rate limits + error codes as the Fastify mirror in src/auth.ts.
export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method === "POST") {
    const op = new URL(req.url ?? "/", "http://localhost").searchParams.get("op") ?? "";
    if (op !== "sync") {
      res.statusCode = 404;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: false, error: "not_found" }));
      return;
    }
    const forwarded = req.headers["x-forwarded-for"];
    const ip =
      (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0]?.trim()) ||
      req.socket?.remoteAddress ||
      "unknown";
    if (isRateLimited(`me-sync:${ip}`, { max: 5 })) {
      res.statusCode = 429;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: false, error: "rate_limited" }));
      return;
    }
    const session = await getSessionUser(
      parseCookies(req.headers.cookie)[SESSION_COOKIE],
      process.env.SESSION_SECRET ?? "",
    );
    if (!session) {
      res.statusCode = 401;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: false, error: "logged_out" }));
      return;
    }
    const synced = await syncUserInstalls(session.login);
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, data: { synced } }));
    return;
  }
  if ((req.method ?? "GET") !== "GET") {
    res.statusCode = 405;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
    return;
  }
  const session = await getSessionUser(
    parseCookies(req.headers.cookie)[SESSION_COOKIE],
    process.env.SESSION_SECRET ?? "",
  );
  if (!session) {
    res.statusCode = 401;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: false, error: "logged_out" }));
    return;
  }
  let repos: string[] = [];
  try {
    const rows = await prisma.repo.findMany({
      where: { ownerUserId: session.id },
      select: { fullName: true },
    });
    repos = rows.map((r) => r.fullName);
  } catch {
    repos = [];
  }
  res.statusCode = 200;
  res.setHeader("content-type", "application/json");
  res.end(
    JSON.stringify({
      ok: true,
      data: { login: session.login, avatarUrl: session.avatarUrl, repos },
    }),
  );
}
