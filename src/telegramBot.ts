import crypto from "node:crypto";
import { prisma } from "./db.js";
import { accessibleRepos, checkBindAllowed, getChatMemberStatus, type Sender } from "./chatAccess.js";
import { isRateLimited } from "./rateLimit.js";
import { claimLinkToken } from "./linkTokens.js";
import { sendMessage } from "./telegram.js";

// Telegram inbound: getUpdates long-poll loop (Render service only;
// Vercel serverless never polls). Chat linking + repo binding:
// - /start <token> — claims a website-issued deep-link token (hash-only)
// - /link — issues a short code bound to this chat (backup flow, legacy)
// - /repos — repos your linked GitHub account can access (+ bound marks)
// - /bind owner/repo — subscribe this chat (group: admin only)
// - /unlink [owner/repo] — unsubscribe (group: admin only)
// - anything else — short help.

export const LINK_TTL_MS = 10 * 60 * 1000;
const CODE_LEN = 6;
// No 0/O/1/I/L — codes are read off a phone screen.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const REPO_RE = /^[^/\s]+\/[^/\s]+$/;

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

async function claimToken(code: string, chatId: string) {
  // Legacy TelegramLink rows (raw 32-hex codes, pre-Phase D) stay claimable
  // until they expire; new deep-link tokens live hashed in LinkToken.
  const fresh = await claimLinkToken(code, chatId);
  if (fresh.status !== "invalid") return fresh;
  try {
    const row = await prisma.telegramLink.findUnique({ where: { code } });
    if (!row || row.kind !== "token" || row.usedAt || row.expiresAt < new Date()) {
      return { status: "invalid" as const };
    }
    await prisma.telegramLink.update({
      where: { code },
      data: { claimedBy: chatId, usedAt: new Date() },
    });
    return { status: "linked" as const, repoFullName: row.repoFullName };
  } catch {
    return { status: "error" as const };
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

async function ensureChat(chatId: string, chatType?: string): Promise<string | null> {
  try {
    const chat = await prisma.chat.upsert({
      where: { telegramChatId: chatId },
      update: {},
      create: { telegramChatId: chatId, type: chatType === "private" ? "dm" : "group" },
    });
    return chat.id;
  } catch {
    return null;
  }
}

async function subscribeRepo(chatDbId: string, repoFullName: string): Promise<boolean> {
  try {
    const repoRow = await prisma.repo.upsert({
      where: { fullName: repoFullName },
      update: {},
      create: { fullName: repoFullName },
    });
    await prisma.subscription.upsert({
      where: { chatId_repoId: { chatId: chatDbId, repoId: repoRow.id } },
      update: {},
      create: { chatId: chatDbId, repoId: repoRow.id },
    });
    return true;
  } catch {
    return false;
  }
}

async function boundRepos(chatDbId: string): Promise<Set<string>> {
  try {
    const subs = await prisma.subscription.findMany({
      where: { chatId: chatDbId },
      include: { repo: { select: { fullName: true } } },
    });
    return new Set(subs.map((s) => s.repo.fullName));
  } catch {
    return new Set();
  }
}

const HELP =
  "Commands: /start (after tapping your Join link), /link (short code instead), " +
  "/repos (your accessible repos), /bind owner/repo, /unlink [owner/repo].";

function limited(cmd: string, chatId: string): boolean {
  return isRateLimited(`tg:${cmd}:${chatId}`, { max: 20 });
}

export async function handleMessage(chatId: string, text?: string, sender?: Sender): Promise<void> {
  const parsed = parseCommand(text);
  if (!parsed) return;
  if (limited(parsed.cmd, chatId)) {
    await sendMessage(chatId, "Too many tries — wait a minute.");
    return;
  }
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
    if (res.status !== "linked") {
      await sendMessage(
        chatId,
        res.status === "invalid"
          ? "That link expired or is invalid. Generate a new Join link on the website."
          : "Linking is temporarily unavailable, try again soon.",
      );
      return;
    }
    if (res.repoFullName) {
      const chatDbId = await ensureChat(chatId, sender?.chatType);
      const ok = chatDbId ? await subscribeRepo(chatDbId, res.repoFullName) : false;
      await sendMessage(
        chatId,
        ok
          ? `This chat is now subscribed to ${res.repoFullName}.`
          : "Link claimed, but subscribing failed — try /bind manually.",
      );
      return;
    }
    await sendMessage(chatId, "This chat is now linked. Return to the website to finish subscribing.");
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
  if (parsed.cmd === "repos") {
    const telegramUserId = sender?.telegramUserId ?? "";
    if (!telegramUserId) {
      await sendMessage(chatId, "I can't tell who you are — message me in a DM first.");
      return;
    }
    const chatDbId = await ensureChat(chatId, sender?.chatType);
    const [repos, bound] = await Promise.all([
      accessibleRepos(telegramUserId),
      chatDbId ? boundRepos(chatDbId) : Promise.resolve(new Set<string>()),
    ]);
    if (repos.length === 0) {
      await sendMessage(
        chatId,
        "No accessible repos. Link your GitHub account on the website, then install the App.",
      );
      return;
    }
    const lines = repos
      .slice(0, 15)
      .map((r) => `${bound.has(r) ? "✓" : "·"} <code>${r}</code>`);
    if (repos.length > 15) lines.push(`+${repos.length - 15} more`);
    await sendMessage(chatId, `Your repos (✓ = this chat is subscribed):\n${lines.join("\n")}\n/bind owner/repo to add.`);
    return;
  }
  if (parsed.cmd === "bind") {
    const repo = (parsed.arg ?? "").trim();
    if (!REPO_RE.test(repo)) {
      await sendMessage(chatId, "Usage: /bind owner/repo.");
      return;
    }
    const check = await checkBindAllowed(chatId, sender ?? {}, repo);
    if (!check.ok) {
      await sendMessage(
        chatId,
        check.reason === "needs_link"
          ? "Link your GitHub account on the website first."
          : check.reason === "group_needs_admin"
            ? "Only group admins with a linked GitHub account may bind repos."
            : "Your account can't access that repo (App not installed or access removed).",
      );
      return;
    }
    const chatDbId = await ensureChat(chatId, sender?.chatType);
    const ok = chatDbId ? await subscribeRepo(chatDbId, repo) : false;
    await sendMessage(chatId, ok ? `This chat is now subscribed to ${repo}.` : "Subscribing failed — try again soon.");
    return;
  }
  if (parsed.cmd === "unlink") {
    const repo = (parsed.arg ?? "").trim();
    if (repo && !REPO_RE.test(repo)) {
      await sendMessage(chatId, "Usage: /unlink [owner/repo].");
      return;
    }
    if (repo) {
      const check = await checkBindAllowed(chatId, sender ?? {}, repo);
      if (!check.ok) {
        await sendMessage(
          chatId,
          check.reason === "group_needs_admin"
            ? "Only group admins may change this chat's subscriptions."
            : "You can't change this chat's subscription to that repo.",
        );
        return;
      }
    } else if (sender?.chatType === "group" || sender?.chatType === "supergroup") {
      // Unbinding everything is destructive: require admin even without a repo arg.
      const status = sender?.telegramUserId
        ? await getChatMemberStatus(chatId, sender.telegramUserId)
        : null;
      if (status !== "creator" && status !== "administrator") {
        await sendMessage(chatId, "Only group admins may change this chat's subscriptions.");
        return;
      }
    }
    try {
      const chat = await prisma.chat.findUnique({ where: { telegramChatId: chatId } });
      if (!chat) {
        await sendMessage(chatId, "This chat has no subscriptions.");
        return;
      }
      if (repo) {
        const repoRow = await prisma.repo.findUnique({ where: { fullName: repo } });
        if (repoRow) {
          await prisma.subscription.deleteMany({ where: { chatId: chat.id, repoId: repoRow.id } });
        }
        await sendMessage(chatId, `Unsubscribed from ${repo}.`);
      } else {
        const res = await prisma.subscription.deleteMany({ where: { chatId: chat.id } });
        await sendMessage(chatId, `Removed ${res.count} subscription(s) from this chat.`);
      }
    } catch {
      await sendMessage(chatId, "Unlinking failed — try again soon.");
    }
    return;
  }
  await sendMessage(chatId, HELP);
}

type TgUpdate = {
  update_id: number;
  message?: { chat?: { id?: number; type?: string }; from?: { id?: number }; text?: string };
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
        const fromId = u.message?.from?.id;
        await handleMessage(String(chat), u.message?.text, {
          telegramUserId: fromId === undefined ? undefined : String(fromId),
          chatType: u.message?.chat?.type,
        });
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
