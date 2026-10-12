import type { IncomingMessage, ServerResponse } from "node:http";
import { prisma } from "../src/db.js";
import { TOKEN_RE, createLinkToken, isTokenClaimed } from "../src/linkTokens.js";
import { isRateLimited } from "../src/rateLimit.js";

// Shared link endpoint (ONE serverless function for the Hobby 12-cap):
// - POST /api/link?op=issue {repo} → {code, url} (deep-link primary flow)
// - GET  /api/link?op=poll&code=.. → {claimed} (website polls while tapping)
// - POST /api/link?op=claim {code, repo} → claims a /link backup code
// Mirrors src/linking.ts (local/Render). Same rate limits + error codes.
const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;
const REPO_RE = /^[^/\s]+\/[^/\s]+$/;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => {
      try {
        resolve(chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

function ipOf(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  return (
    (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0]?.trim()) ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

function botDeepLink(code: string): string | null {
  const name = (process.env.TELEGRAM_BOT_NAME ?? "").trim().replace(/^@/, "");
  if (!name) return null;
  return `https://t.me/${name}?start=${code}`;
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const op = url.searchParams.get("op") ?? "";

  if (op === "issue" && req.method === "POST") {
    if (isRateLimited(`link-token:${ipOf(req)}`, { max: 20 })) {
      sendJson(res, 429, { ok: false, error: "rate_limited" });
      return;
    }
    const body = (await readBody(req)) as { repo?: unknown };
    const repo = typeof body?.repo === "string" ? body.repo : "";
    if (!REPO_RE.test(repo)) {
      sendJson(res, 400, { ok: false, error: "invalid_repo" });
      return;
    }
    if (!(process.env.TELEGRAM_BOT_NAME ?? "").trim()) {
      sendJson(res, 503, { ok: false, error: "bot_not_configured" });
      return;
    }
    try {
      const issued = await createLinkToken(repo);
      if (!issued) {
        sendJson(res, 503, { ok: false, error: "unavailable" });
        return;
      }
      sendJson(res, 200, { ok: true, data: { code: issued.token, url: botDeepLink(issued.token) } });
    } catch {
      sendJson(res, 503, { ok: false, error: "unavailable" });
    }
    return;
  }

  if (op === "poll" && (req.method ?? "GET") === "GET") {
    const code = url.searchParams.get("code") ?? "";
    if (!TOKEN_RE.test(code)) {
      sendJson(res, 404, { ok: false, error: "not_found" });
      return;
    }
    if (await isTokenClaimed(code)) {
      sendJson(res, 200, { ok: true, data: { claimed: true } });
      return;
    }
    try {
      const row = await prisma.telegramLink.findUnique({ where: { code } });
      if (!row || row.kind !== "token") {
        sendJson(res, 404, { ok: false, error: "not_found" });
        return;
      }
      sendJson(res, 200, { ok: true, data: { claimed: row.usedAt !== null } });
    } catch {
      sendJson(res, 200, { ok: true, data: { claimed: false } });
    }
    return;
  }

  if (op === "claim" && req.method === "POST") {
    if (isRateLimited(`link-code:${ipOf(req)}`, { max: 20 })) {
      sendJson(res, 429, { ok: false, error: "rate_limited" });
      return;
    }
    const body = (await readBody(req)) as { code?: unknown; repo?: unknown };
    const code = typeof body?.code === "string" ? body.code.trim().toUpperCase() : "";
    const repo = typeof body?.repo === "string" ? body.repo : "";
    if (!CODE_RE.test(code) || !REPO_RE.test(repo)) {
      sendJson(res, 400, { ok: false, error: "invalid_input" });
      return;
    }
    try {
      const row = await prisma.telegramLink.findUnique({ where: { code } });
      if (
        !row ||
        row.kind !== "code" ||
        !row.chatId ||
        row.usedAt ||
        row.expiresAt < new Date()
      ) {
        sendJson(res, 404, { ok: false, error: "invalid_or_expired" });
        return;
      }
      const repoRow = await prisma.repo.upsert({
        where: { fullName: repo },
        update: {},
        create: { fullName: repo },
      });
      const chat = await prisma.chat.upsert({
        where: { telegramChatId: row.chatId },
        update: {},
        create: { telegramChatId: row.chatId, type: "dm" },
      });
      await prisma.subscription.upsert({
        where: { chatId_repoId: { chatId: chat.id, repoId: repoRow.id } },
        update: {},
        create: { chatId: chat.id, repoId: repoRow.id },
      });
      await prisma.telegramLink.update({ where: { code }, data: { usedAt: new Date() } });
      sendJson(res, 200, { ok: true });
    } catch {
      sendJson(res, 503, { ok: false, error: "unavailable" });
    }
    return;
  }

  sendJson(res, 404, { ok: false, error: "not_found" });
}
