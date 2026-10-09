import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "./db.js";
import { isRateLimited } from "./rateLimit.js";
import { TOKEN_RE, createLinkToken, isTokenClaimed } from "./linkTokens.js";

// linking.ts — website side of Telegram chat linking (no website accounts;
// the chat subscription IS the user). Pairs with src/telegramBot.ts:
// - POST /api/link-token {repo} → {code, url} (deep-link primary flow)
// - GET  /api/link-token/:code → {claimed} (website polls while user taps)
// - POST /api/link-code {code, repo} → claims a /link backup code
// Deep-link tokens are hash-only (LinkToken); the /link backup codes stay
// on TelegramLink (short user-typed codes, rate-limited + single-use).
// Code formats are validated BEFORE touching the DB so malformed input
// never pays a connection timeout.

const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;
const REPO_RE = /^[^/\s]+\/[^/\s]+$/;

const LinkTokenBody = z.object({ repo: z.string() });
const LinkCodeBody = z.object({ code: z.string(), repo: z.string() });

function clientIp(req: { ip?: string; headers: Record<string, unknown> }): string {
  return req.ip ?? req.headers["x-forwarded-for"]?.toString() ?? "unknown";
}

function botName(): string {
  return (process.env.TELEGRAM_BOT_NAME ?? "").trim().replace(/^@/, "");
}

function botDeepLink(code: string): string | null {
  const name = botName();
  if (!name) return null;
  return `https://t.me/${name}?start=${code}`;
}

export async function registerLinkingRoutes(app: FastifyInstance) {
  app.post("/api/link-token", async (req, reply) => {
    if (isRateLimited(`link-token:${clientIp(req)}`, { max: 20 })) {
      return reply.code(429).send({ ok: false, error: "rate_limited" });
    }
    const parsed = LinkTokenBody.safeParse(req.body ?? {});
    if (!parsed.success || !REPO_RE.test(parsed.data.repo)) {
      return reply.code(400).send({ ok: false, error: "invalid_repo" });
    }
    if (!botName()) {
      return reply.code(503).send({ ok: false, error: "bot_not_configured" });
    }
    try {
      const issued = await createLinkToken(parsed.data.repo);
      if (!issued) {
        return reply.code(503).send({ ok: false, error: "unavailable" });
      }
      return reply.send({ ok: true, data: { code: issued.token, url: botDeepLink(issued.token) } });
    } catch {
      return reply.code(503).send({ ok: false, error: "unavailable" });
    }
  });

  app.get("/api/link-token/:code", async (req, reply) => {
    const code = (req.params as { code?: string }).code ?? "";
    if (!TOKEN_RE.test(code)) {
      return reply.code(404).send({ ok: false, error: "not_found" });
    }
    // New hash-only tokens first; legacy raw TelegramLink rows still poll
    // until they expire (pre-Phase D deep links).
    const claimed = await isTokenClaimed(code);
    if (claimed) {
      return reply.send({ ok: true, data: { claimed: true } });
    }
    try {
      const row = await prisma.telegramLink.findUnique({ where: { code } });
      if (!row || row.kind !== "token") {
        return reply.code(404).send({ ok: false, error: "not_found" });
      }
      return reply.send({ ok: true, data: { claimed: row.usedAt !== null } });
    } catch {
      // degraded: keep the website polling instead of erroring the UI
      return reply.send({ ok: true, data: { claimed: false } });
    }
  });

  app.post("/api/link-code", async (req, reply) => {
    if (isRateLimited(`link-code:${clientIp(req)}`, { max: 20 })) {
      return reply.code(429).send({ ok: false, error: "rate_limited" });
    }
    const parsed = LinkCodeBody.safeParse(req.body ?? {});
    const code = (parsed.success ? parsed.data.code : "").trim().toUpperCase();
    const repo = parsed.success ? parsed.data.repo : "";
    if (!parsed.success || !CODE_RE.test(code) || !REPO_RE.test(repo)) {
      return reply.code(400).send({ ok: false, error: "invalid_input" });
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
        return reply.code(404).send({ ok: false, error: "invalid_or_expired" });
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
      return reply.send({ ok: true });
    } catch {
      return reply.code(503).send({ ok: false, error: "unavailable" });
    }
  });
}
