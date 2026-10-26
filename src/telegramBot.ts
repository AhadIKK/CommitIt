import crypto from "node:crypto";
import { prisma } from "./db.js";
import { accessibleRepos, checkBindAllowed, getChatMemberStatus, type Sender } from "./chatAccess.js";
import { isRateLimited } from "./rateLimit.js";
import { claimLinkToken } from "./linkTokens.js";
import { isDigestMode } from "./notifyPrefs.js";
import { formatRecent } from "./formatter.js";
import { answerCallbackQuery, editMessageText, sendMessage } from "./telegram.js";
import { chatNameOf } from "./chatTitle.js";
import {
  digestKeyboard,
  digestView,
  reposKeyboard,
  reposView,
  startKeyboard,
  type InlineKeyboard,
} from "./telegramUi.js";

// Telegram inbound: primary path is the Vercel webhook
// (src/telegramWebhook.ts, /api/telegram). The getUpdates long-poll loop below
// is the FALLBACK (Render service only; Vercel serverless never polls). It
// detects that a webhook is registered (HTTP 409) and idles on a slow tick, so
// it costs nothing while the webhook lives and resumes automatically if the
// webhook is ever deleted.
//
// Both entry points feed dispatchUpdate(), so a message and a button tap take
// exactly the same path whether Telegram delivered them to Vercel or Render.
//
// Commands:
// - /start <token> — claims a website-issued deep-link token (hash-only)
// - /link — issues a short code bound to this chat (backup flow, legacy)
// - /repos — repos your linked GitHub account can access (+ bound marks,
//            with subscribe/unsubscribe buttons per repo)
// - /recent [owner/repo] — newest commits across this chat's subscriptions
// - /bind owner/repo — subscribe this chat (group: admin only)
// - /unlink [owner/repo] — unsubscribe (group: admin only)
// - /digest [mode] [owner/repo] — show/set notification frequency (+ buttons)
// - /help (or anything else) — short help.
//
// Button taps arrive as callback_query and reuse those same handlers, so every
// permission rule (linked account, group admin) applies to a tap too.

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

/** Outcome of one command, used for the button-toast text. */
type Reply = { ok: boolean; note: string };

function reply(chatId: string, html: string, keyboard?: InlineKeyboard) {
  return sendMessage(chatId, html, keyboard ? { replyMarkup: keyboard } : undefined);
}

async function claimToken(
  code: string,
  chatId: string,
  senderUserId?: string,
) {
  // Legacy TelegramLink rows (raw 32-hex codes, pre-Phase D) stay claimable
  // until they expire; new deep-link tokens live hashed in LinkToken.
  const fresh = await claimLinkToken(code, chatId, senderUserId);
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

async function ensureChat(
  chatId: string,
  chatType?: string,
  chatTitle?: string,
): Promise<string | null> {
  try {
    const title = (chatTitle ?? "").trim() || null;
    const chat = await prisma.chat.upsert({
      where: { telegramChatId: chatId },
      // The bot always carries the chat's name in the update, so a rename in
      // Telegram is picked up on the next message. Never clobber a stored name
      // with nothing.
      update: title ? { title } : {},
      create: {
        telegramChatId: chatId,
        type: chatType === "private" ? "dm" : "group",
        title,
      },
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

export const HELP =
  "Commands:\n" +
  "/start — after tapping your Join link\n" +
  "/link — short code instead\n" +
  "/repos — your accessible repos\n" +
  "/recent [owner/repo] — latest commits\n" +
  "/bind owner/repo — subscribe this chat\n" +
  "/unlink [owner/repo] — unsubscribe\n" +
  "/digest [instant|hourly|daily|weekly] [owner/repo] — notification frequency\n" +
  "/help — this list";

function limited(cmd: string, chatId: string): boolean {
  return isRateLimited(`tg:${cmd}:${chatId}`, { max: 20 });
}

const TOO_MANY: Reply = { ok: false, note: "Too many taps — wait a minute." };

async function cmdStart(chatId: string, sender?: Sender, arg?: string): Promise<Reply> {
  if (!arg) {
    await reply(
      chatId,
      "CommitIt bot. To link this chat, tap your personal Join link on the website, " +
        "or send /link for a short code to enter there instead.",
      startKeyboard(),
    );
    return { ok: true, note: "Opening CommitIt" };
  }
  const res = await claimToken(arg.trim(), chatId, sender?.telegramUserId);
  if (res.status !== "linked") {
    await reply(
      chatId,
      res.status === "invalid"
        ? "That link expired or is invalid. Generate a new Join link on the website."
        : "Linking is temporarily unavailable, try again soon.",
    );
    return { ok: false, note: res.status === "invalid" ? "Link expired" : "Linking unavailable" };
  }
  if (res.repoFullName) {
    const chatDbId = await ensureChat(chatId, sender?.chatType, sender?.chatTitle);
    const ok = chatDbId ? await subscribeRepo(chatDbId, res.repoFullName) : false;
    await reply(
      chatId,
      ok
        ? `This chat is now subscribed to ${res.repoFullName}.`
        : "Link claimed, but subscribing failed — try /bind manually.",
      ok ? reposKeyboard([{ repo: res.repoFullName, bound: true }]) : undefined,
    );
    return { ok, note: ok ? `Subscribed to ${res.repoFullName}` : "Subscribing failed" };
  }
  await reply(
    chatId,
    "This chat is now linked. Return to the website to finish subscribing.",
    startKeyboard(),
  );
  return { ok: true, note: "This chat is linked" };
}

async function cmdLink(chatId: string): Promise<Reply> {
  const issued = await issueCode(chatId);
  await reply(
    chatId,
    issued
      ? `Your code is <code>${issued.code}</code>. Enter it on the website within 10 minutes.`
      : "Linking is temporarily unavailable, try again soon.",
    issued ? startKeyboard() : undefined,
  );
  return { ok: issued !== null, note: issued ? "Code sent" : "Linking unavailable" };
}

/**
 * Renders this chat's repo list. With a messageId it rewrites that message
 * instead — that is how a tapped subscribe/unsubscribe button refreshes its own
 * ✓ marks and button labels.
 */
async function cmdRepos(chatId: string, sender?: Sender, messageId?: number): Promise<Reply> {
  const telegramUserId = sender?.telegramUserId ?? "";
  if (!telegramUserId) {
    await reply(chatId, "I can't tell who you are — message me in a DM first.");
    return { ok: false, note: "Message me in a DM first" };
  }
  const chatDbId = await ensureChat(chatId, sender?.chatType, sender?.chatTitle);
  const [repos, bound] = await Promise.all([
    accessibleRepos(telegramUserId),
    chatDbId ? boundRepos(chatDbId) : Promise.resolve(new Set<string>()),
  ]);
  if (repos.length === 0) {
    await reply(
      chatId,
      "No accessible repos. Link your GitHub account on the website, install the App, " +
        "then tap a fresh Join link (older links predate account binding).",
      startKeyboard(),
    );
    return { ok: false, note: "No accessible repos" };
  }
  const view = reposView(repos, bound);
  if (messageId !== undefined) {
    await editMessageText(chatId, messageId, view.text, view.keyboard);
  } else {
    await reply(chatId, view.text, view.keyboard);
  }
  return { ok: true, note: `${repos.length} repo(s)` };
}

const RECENT_LIMIT = 10;

/**
 * The /recent view. With no argument it reads this chat's subscriptions (the
 * same surface /digest lists); with an owner/repo it reads that repo, gated by
 * the same access check /bind uses so a chat can never page through a repo its
 * caller has no access to. Read-only: nothing here mutates state.
 */
async function cmdRecent(
  chatId: string,
  sender: Sender | undefined,
  repoArg?: string,
): Promise<Reply> {
  const repo = (repoArg ?? "").trim();
  if (repo && !REPO_RE.test(repo)) {
    await reply(chatId, "Usage: /recent [owner/repo].");
    return { ok: false, note: "Usage: /recent [owner/repo]" };
  }
  try {
    const chat = await prisma.chat.findUnique({ where: { telegramChatId: chatId } });
    let repoIds: string[];
    if (repo) {
      const check = await checkBindAllowed(chatId, sender ?? {}, repo);
      if (!check.ok) {
        await reply(
          chatId,
          check.reason === "group_needs_admin"
            ? "Only group admins with a linked GitHub account may view another repo here."
            : check.reason === "needs_link"
              ? "Link your GitHub account on the website first."
              : "Your account can't access that repo (App not installed or access removed).",
        );
        return {
          ok: false,
          note: check.reason === "group_needs_admin" ? "Admins only" : "Not allowed",
        };
      }
      const row = await prisma.repo.findUnique({
        where: { fullName: repo },
        select: { id: true },
      });
      if (!row) {
        await reply(chatId, `🕒 No commits recorded yet for <code>${repo}</code>.`);
        return { ok: false, note: `No commits for ${repo}` };
      }
      repoIds = [row.id];
    } else {
      const subs = chat
        ? await prisma.subscription.findMany({
            where: { chatId: chat.id },
            select: { repoId: true },
            orderBy: { createdAt: "asc" },
          })
        : [];
      repoIds = subs.map((s) => s.repoId);
      if (repoIds.length === 0) {
        await reply(chatId, "This chat has no subscriptions. /bind owner/repo to add one.");
        return { ok: false, note: "No subscriptions" };
      }
    }
    // Newest first by the commit's own date; legacy nulls sort last, never
    // first. The extra row is what makes "+N more" truthful.
    const rows = await prisma.commit.findMany({
      where: { repoId: { in: repoIds } },
      include: {
        author: { select: { githubLogin: true } },
        repo: { select: { fullName: true } },
        issue: { select: { number: true } },
      },
      orderBy: [{ committedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take: RECENT_LIMIT + 1,
    });
    const shown = rows.slice(0, RECENT_LIMIT);
    const body = formatRecent({
      commits: shown.map((c) => ({
        repo: c.repo.fullName,
        sha: c.sha,
        message: c.message,
        // Unattributed rows must read honestly, never blank (rule 12).
        author: c.author?.githubLogin ?? "unknown",
        category: c.category,
        isMerge: c.isMerge,
        secretFlag: c.secretFlag,
        issueNumber: c.issue?.number ?? null,
        at: c.committedAt ?? c.createdAt,
      })),
      more: Math.max(0, rows.length - RECENT_LIMIT),
      commitsUrl: repo ? `https://github.com/${repo}/commits` : undefined,
    });
    await reply(chatId, body, startKeyboard());
    return { ok: shown.length > 0, note: `${shown.length} commit(s)` };
  } catch {
    await reply(chatId, "Reading commits failed — try again soon.");
    return { ok: false, note: "Reading failed" };
  }
}

async function cmdBind(chatId: string, sender: Sender | undefined, repoArg?: string): Promise<Reply> {
  const repo = (repoArg ?? "").trim();
  if (!REPO_RE.test(repo)) {
    await reply(chatId, "Usage: /bind owner/repo.");
    return { ok: false, note: "Usage: /bind owner/repo" };
  }
  const check = await checkBindAllowed(chatId, sender ?? {}, repo);
  if (!check.ok) {
    await reply(
      chatId,
      check.reason === "needs_link"
        ? "Link your GitHub account on the website first."
        : check.reason === "group_needs_admin"
          ? "Only group admins with a linked GitHub account may bind repos."
          : "Your account can't access that repo (App not installed or access removed).",
    );
    return {
      ok: false,
      note: check.reason === "group_needs_admin" ? "Admins only" : "Not allowed",
    };
  }
  const chatDbId = await ensureChat(chatId, sender?.chatType, sender?.chatTitle);
  const ok = chatDbId ? await subscribeRepo(chatDbId, repo) : false;
  await reply(
    chatId,
    ok ? `This chat is now subscribed to ${repo}.` : "Subscribing failed — try again soon.",
    ok ? reposKeyboard([{ repo, bound: true }]) : undefined,
  );
  return { ok, note: ok ? `Subscribed to ${repo}` : "Subscribing failed" };
}

async function cmdUnlink(
  chatId: string,
  sender: Sender | undefined,
  repoArg?: string,
): Promise<Reply> {
  const repo = (repoArg ?? "").trim();
  if (repo && !REPO_RE.test(repo)) {
    await reply(chatId, "Usage: /unlink [owner/repo].");
    return { ok: false, note: "Usage: /unlink [owner/repo]" };
  }
  if (repo) {
    const check = await checkBindAllowed(chatId, sender ?? {}, repo);
    if (!check.ok) {
      await reply(
        chatId,
        check.reason === "group_needs_admin"
          ? "Only group admins may change this chat's subscriptions."
          : "You can't change this chat's subscription to that repo.",
      );
      return {
        ok: false,
        note: check.reason === "group_needs_admin" ? "Admins only" : "Not allowed",
      };
    }
  } else if (sender?.chatType === "group" || sender?.chatType === "supergroup") {
    // Unbinding everything is destructive: require admin even without a repo arg.
    const status = sender?.telegramUserId
      ? await getChatMemberStatus(chatId, sender.telegramUserId)
      : null;
    if (status !== "creator" && status !== "administrator") {
      await reply(chatId, "Only group admins may change this chat's subscriptions.");
      return { ok: false, note: "Admins only" };
    }
  }
  try {
    const chat = await prisma.chat.findUnique({ where: { telegramChatId: chatId } });
    if (!chat) {
      await reply(chatId, "This chat has no subscriptions.");
      return { ok: false, note: "No subscriptions" };
    }
    if (repo) {
      const repoRow = await prisma.repo.findUnique({ where: { fullName: repo } });
      if (repoRow) {
        await prisma.subscription.deleteMany({ where: { chatId: chat.id, repoId: repoRow.id } });
      }
      await reply(chatId, `Unsubscribed from ${repo}.`);
      return { ok: true, note: `Unsubscribed from ${repo}` };
    }
    const res = await prisma.subscription.deleteMany({ where: { chatId: chat.id } });
    await reply(chatId, `Removed ${res.count} subscription(s) from this chat.`);
    return { ok: true, note: `Removed ${res.count} subscription(s)` };
  } catch {
    await reply(chatId, "Unlinking failed — try again soon.");
    return { ok: false, note: "Unlinking failed" };
  }
}

async function cmdDigest(
  chatId: string,
  sender: Sender | undefined,
  arg?: string,
  messageId?: number,
): Promise<Reply> {
  const parts = (arg ?? "").trim().split(/\s+/).filter(Boolean);
  const [first, ...rest] = parts;

  // Listing: same body as before buttons, with a mode row attached.
  const list = async (): Promise<Reply> => {
    try {
      const chat = await prisma.chat.findUnique({ where: { telegramChatId: chatId } });
      const subs = chat
        ? await prisma.subscription.findMany({
            where: { chatId: chat.id },
            include: { repo: { select: { fullName: true } } },
            orderBy: { createdAt: "asc" },
          })
        : [];
      const view = digestView(
        subs.map((s) => ({
          repo: s.repo.fullName,
          digestMode: s.digestMode,
          isMuted: s.isMuted,
        })),
      );
      if (messageId !== undefined) {
        await editMessageText(chatId, messageId, view.text, view.keyboard);
      } else {
        await reply(chatId, view.text, view.keyboard);
      }
      return { ok: subs.length > 0, note: `${subs.length} subscription(s)` };
    } catch {
      await reply(chatId, "Reading subscriptions failed — try again soon.");
      return { ok: false, note: "Reading failed" };
    }
  };

  if (!first) return list();

  const mode = first.toLowerCase();
  if (!isDigestMode(mode)) {
    await reply(chatId, "Usage: /digest [instant|hourly|daily|weekly] [owner/repo].");
    return { ok: false, note: "Usage: /digest <mode> [owner/repo]" };
  }
  const repo = rest.join(" ").trim();
  if (repo && !REPO_RE.test(repo)) {
    await reply(chatId, "Usage: /digest [instant|hourly|daily|weekly] [owner/repo].");
    return { ok: false, note: "Usage: /digest <mode> [owner/repo]" };
  }
  if (!repo && (sender?.chatType === "group" || sender?.chatType === "supergroup")) {
    // Changing everything is chat-wide: require admin, mirroring /unlink.
    const status = sender?.telegramUserId
      ? await getChatMemberStatus(chatId, sender.telegramUserId)
      : null;
    if (status !== "creator" && status !== "administrator") {
      await reply(chatId, "Only group admins may change this chat's subscriptions.");
      return { ok: false, note: "Admins only" };
    }
  }
  if (repo) {
    const check = await checkBindAllowed(chatId, sender ?? {}, repo);
    if (!check.ok) {
      await reply(
        chatId,
        check.reason === "group_needs_admin"
          ? "Only group admins may change this chat's subscriptions."
          : "You can't change this chat's subscription to that repo.",
      );
      return {
        ok: false,
        note: check.reason === "group_needs_admin" ? "Admins only" : "Not allowed",
      };
    }
  }
  try {
    const chat = await prisma.chat.findUnique({ where: { telegramChatId: chatId } });
    const where = chat
      ? repo
        ? await prisma.repo
            .findUnique({ where: { fullName: repo }, select: { id: true } })
            .then((r) => (r ? { chatId: chat.id, repoId: r.id } : null))
        : { chatId: chat.id }
      : null;
    if (!where) {
      await reply(chatId, "This chat has no subscriptions.");
      return { ok: false, note: "No subscriptions" };
    }
    const res = await prisma.subscription.updateMany({ where, data: { digestMode: mode } });
    if (res.count === 0) {
      await reply(chatId, "This chat has no subscriptions.");
      return { ok: false, note: "No subscriptions" };
    }
    const done = repo ? `<code>${repo}</code> → ${mode}.` : `All ${res.count} subscription(s) → ${mode}.`;
    if (messageId !== undefined) {
      // The tap came from a mode button: redraw that same message.
      await list();
    } else {
      await reply(chatId, done, digestKeyboard(mode, repo || undefined));
    }
    return { ok: true, note: repo ? `${repo} → ${mode}` : `All → ${mode}` };
  } catch {
    await reply(chatId, "Saving failed — try again soon.");
    return { ok: false, note: "Saving failed" };
  }
}

async function showHelp(chatId: string): Promise<Reply> {
  await reply(chatId, HELP, startKeyboard());
  return { ok: true, note: "Commands listed" };
}

export async function handleMessage(chatId: string, text?: string, sender?: Sender): Promise<void> {
  const parsed = parseCommand(text);
  if (!parsed) return;
  if (limited(parsed.cmd, chatId)) {
    await sendMessage(chatId, "Too many tries — wait a minute.");
    return;
  }
  switch (parsed.cmd) {
    case "start":
      await cmdStart(chatId, sender, parsed.arg);
      return;
    case "link":
      await cmdLink(chatId);
      return;
    case "repos":
      await cmdRepos(chatId, sender);
      return;
    case "recent":
      await cmdRecent(chatId, sender, parsed.arg);
      return;
    case "bind":
      await cmdBind(chatId, sender, parsed.arg);
      return;
    case "unlink":
      await cmdUnlink(chatId, sender, parsed.arg);
      return;
    case "digest":
      await cmdDigest(chatId, sender, parsed.arg);
      return;
    default:
      await showHelp(chatId);
  }
}

export type CallbackQuery = {
  id?: string;
  data?: string;
  from?: { id?: number };
  message?: { message_id?: number; chat?: { id?: number; type?: string } };
};

/** A tap on an inline button: reuses the command handlers, so every permission
 * rule (linked account, group admin) applies to a tap exactly as it does to text. */
export async function handleCallback(query: CallbackQuery): Promise<void> {
  const id = query.id;
  const chatId = query.message?.chat?.id;
  if (!id || chatId === undefined) return;
  const chat = String(chatId);
  const sender: Sender = {
    telegramUserId: query.from?.id === undefined ? undefined : String(query.from.id),
    chatType: query.message?.chat?.type,
    chatTitle: chatNameOf(query.message?.chat ?? {}),
  };
  const messageId = query.message?.message_id;
  const [action, ...rest] = (query.data ?? "").split(":");
  const value = rest.join(":");

  let out: Reply = { ok: false, note: "That button is no longer supported" };
  try {
    if (action === "sub" && value) {
      out = limited("bind", chat) ? TOO_MANY : await cmdBind(chat, sender, value);
      // Redraw the list so ✓ marks and button labels stay truthful.
      if (out.ok && messageId !== undefined) await cmdRepos(chat, sender, messageId);
    } else if (action === "unsub" && value) {
      out = limited("unlink", chat) ? TOO_MANY : await cmdUnlink(chat, sender, value);
      if (out.ok && messageId !== undefined) await cmdRepos(chat, sender, messageId);
    } else if (action === "digest" && value) {
      const [mode, ...repoParts] = value.split(":");
      const repo = repoParts.join(":");
      // cmdDigest redraws the message itself when it is given the messageId.
      out = limited("digest", chat)
        ? TOO_MANY
        : await cmdDigest(chat, sender, repo ? `${mode} ${repo}` : mode, messageId);
    }
  } catch (err) {
    out = { ok: false, note: "Something went wrong — try again" };
    console.warn(JSON.stringify({ msg: "telegram callback failed", err: String(err) }));
  }
  // Every tap must be answered, or the client spins that button forever.
  await answerCallbackQuery(id, out.note);
}

export type InboundUpdate = {
  update_id?: number;
  message?: {
    chat?: { id?: number; type?: string };
    from?: { id?: number };
    text?: string;
  };
  callback_query?: CallbackQuery;
};

/**
 * The one place an update becomes work: both the Vercel webhook and the Render
 * poller call this, so a tap and a command behave identically on either host.
 */
export async function dispatchUpdate(update: InboundUpdate): Promise<void> {
  const query = update.callback_query;
  if (query && query.id) {
    await handleCallback(query);
    return;
  }
  const chat = update.message?.chat?.id;
  if (chat === undefined) return;
  const fromId = update.message?.from?.id;
  await handleMessage(String(chat), update.message?.text, {
    telegramUserId: fromId === undefined ? undefined : String(fromId),
    chatType: update.message?.chat?.type,
    chatTitle: chatNameOf(update.message?.chat ?? {}),
  });
}

export type PollResult = { next: number; webhookActive: boolean };

export async function pollOnce(offset: number): Promise<PollResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN ?? "";
  if (!token) return { next: offset, webhookActive: false };
  const res = await fetch(
    `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=25`,
  );
  // 409 = "can't use getUpdates while webhook is active": inbound is on the
  // webhook, so this poller steps aside rather than hammering Telegram.
  if (res.status === 409) return { next: offset, webhookActive: true };
  if (!res.ok) return { next: offset, webhookActive: false };
  const body = (await res.json()) as { ok: boolean; result?: InboundUpdate[] };
  if (!body.ok || !body.result) return { next: offset, webhookActive: false };
  let next = offset;
  for (const u of body.result) {
    next = Math.max(next, (u.update_id ?? 0) + 1);
    try {
      await dispatchUpdate(u);
    } catch {
      // one bad update never kills the loop
    }
  }
  return { next, webhookActive: false };
}

export function startBotPolling(
  log: { info: (o: object, m: string) => void; error: (o: object, m: string) => void },
  intervalMs = 1000,
  webhookRetryMs = 60_000,
): NodeJS.Timeout | null {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    log.info({}, "TELEGRAM_BOT_TOKEN not set — bot inbound disabled");
    return null;
  }
  let offset = 0;
  let busy = false;
  let nextTick = 0;
  let webhookMode = false;
  const timer = setInterval(async () => {
    if (busy || Date.now() < nextTick) return;
    busy = true;
    try {
      const out = await pollOnce(offset);
      offset = out.next;
      if (out.webhookActive !== webhookMode) {
        webhookMode = out.webhookActive;
        log.info(
          {},
          webhookMode
            ? "telegram webhook active — polling backed off (standby)"
            : "telegram webhook gone — polling resumed",
        );
      }
      // Standby: inbound belongs to the webhook. Re-checking on a slow tick
      // means deleting the webhook restores polling by itself.
      if (out.webhookActive) nextTick = Date.now() + webhookRetryMs;
    } catch (err) {
      log.error({ err }, "bot poll failed");
    } finally {
      busy = false;
    }
  }, intervalMs);
  timer.unref?.();
  return timer;
}
