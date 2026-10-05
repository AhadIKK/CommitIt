import crypto from "node:crypto";
import { prisma } from "./db.js";
import { sendMessage } from "./telegram.js";

// Telegram inbound: getUpdates long-poll loop (Render service only;
// Vercel serverless never polls). Handles the chat-linking side:
// - /start <token> — claims a website-issued deep-link token (primary flow)
// - /link — issues a short code bound to this chat (backup flow)
// - anything else — short help. No other commands live here.

export const LINK_TTL_MS = 10 * 60 * 1000;
const CODE_LEN = 6;
// No 0/O/1/I/L — codes are read off a phone screen.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function genToken(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function genCode(pick: (n: number) => number = (n) => crypto.randomInt(n)): string {
  let out = "";
  for (let i = 0; i < CODE_LEN; i++) out += CODE_ALPHABET[pick(CODE_ALPHABET.length)];
  return out;
}

export function codeExpiry(now: number = Date.now()): Date {
  return new Date(now + LINK_TTL_MS);
}

export type ParsedCommand = { cmd: string; arg?: string } | null;

export function parseCommand(text?: string): ParsedCommand {
  if (!text) return null;
  const t = text.trim();
  if (!t.startsWith("/")) return null;
  const [raw, ...rest] = t.slice(1).split(/\s+/);
  if (!raw) return null;
  return { cmd: raw.split("@")[0]!.toLowerCase(), arg: rest.join(" ") || undefined };
}

async function claimToken(code: string, chatId: string): Promise<"linked" | "invalid" | "error"> {
  try {
    const row = await prisma.telegramLink.findUnique({ where: { code } });
    if (!row || row.kind !== "token" || row.usedAt || row.expiresAt < new Date()) {
      return "invalid";
    }
    await prisma.telegramLink.update({
      where: { code },
      data: { claimedBy: chatId, usedAt: new Date() },
    });
    return "linked";
  } catch {
    return "error";
  }
}

async function issueCode(chatId: string): Promise<{ code: string } | null> {
  try {
    await prisma.telegramLink.deleteMany({
      where: { kind: "code", chatId, expiresAt: { lt: new Date() } },
    });
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const row = await prisma.telegramLink.create({
          data: { code: genCode(), kind: "code", chatId, expiresAt: codeExpiry() },
        });
        return { code: row.code };
      } catch {
        // probable code collision (UNIQUE) — retry with a fresh code
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function handleMessage(chatId: string, text?: string): Promise<void> {
  const parsed = parseCommand(text);
  if (!parsed) return;
  if (parsed.cmd === "start") {
    if (!parsed.arg) {
      await sendMessage(
        chatId,
        "CommitIt bot. To link this chat, tap your personal Join link on the website, " +
          "or send /link for a short code to enter there instead.",
      );
      return;
    }
    const res = await claimToken(parsed.arg.trim(), chatId);
    await sendMessage(
      chatId,
      res === "linked"
        ? "This chat is now linked. Return to the website to finish subscribing."
        : res === "invalid"
          ? "That link expired or is invalid. Generate a new Join link on the website."
          : "Linking is temporarily unavailable, try again soon.",
    );
    return;
  }
  if (parsed.cmd === "link") {
    const issued = await issueCode(chatId);
    await sendMessage(
      chatId,
      issued
        ? `Your code is <code>${issued.code}</code>. Enter it on the website within 10 minutes.`
        : "Linking is temporarily unavailable, try again soon.",
    );
    return;
  }
  await sendMessage(
    chatId,
    "Commands: /start (after tapping your Join link), /link (get a short code instead).",
  );
}

type TgUpdate = {
  update_id: number;
  message?: { chat?: { id?: number }; text?: string };
};

export async function pollOnce(offset: number): Promise<number> {
  const token = process.env.TELEGRAM_BOT_TOKEN ?? "";
  if (!token) return offset;
  const res = await fetch(
    `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=25`,
  );
  if (!res.ok) return offset;
  const body = (await res.json()) as { ok: boolean; result?: TgUpdate[] };
  if (!body.ok || !body.result) return offset;
  let next = offset;
  for (const u of body.result) {
    next = Math.max(next, u.update_id + 1);
    const chat = u.message?.chat?.id;
    if (chat !== undefined) {
      try {
        await handleMessage(String(chat), u.message?.text);
      } catch {
        // one bad message never kills the loop
      }
    }
  }
  return next;
}

export function startBotPolling(
  log: { info: (o: object, m: string) => void; error: (o: object, m: string) => void },
  intervalMs = 1000,
): NodeJS.Timeout | null {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    log.info({}, "TELEGRAM_BOT_TOKEN not set — bot inbound disabled");
    return null;
  }
  let offset = 0;
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      offset = await pollOnce(offset);
    } catch (err) {
      log.error({ err }, "bot poll failed");
    } finally {
      busy = false;
    }
  }, intervalMs);
  timer.unref?.();
  return timer;
}
