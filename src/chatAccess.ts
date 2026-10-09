import { prisma } from "./db.js";
import { canAccessRepo } from "./access.js";

// chatAccess.ts — who may bind a chat to a repo (Phase D).
// - DMs: sender must be GitHub-linked and have repo access.
// - Groups: sender must ALSO be a chat admin (creator/administrator).
// Sender identity is the Telegram user id (message.from.id), matched to
// User.telegramUserId. Pure logic + thin Bot API adapter (injectable fetch).

export type Sender = { telegramUserId?: string; chatType?: string };

export function isGroupChat(chatType?: string): boolean {
  return chatType === "group" || chatType === "supergroup";
}

export type FetchDeps = { fetchFn?: typeof fetch };

/** Raw getChatMember status (creator/administrator/member/...) or null. */
export async function getChatMemberStatus(
  chatId: string,
  telegramUserId: string,
  deps: FetchDeps = {},
): Promise<string | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN ?? "";
  if (!token) return null;
  try {
    const doFetch = deps.fetchFn ?? fetch;
    const res = await doFetch(
      `https://api.telegram.org/bot${token}/getChatMember?chat_id=${encodeURIComponent(chatId)}&user_id=${encodeURIComponent(telegramUserId)}`,
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { ok: boolean; result?: { status?: string } };
    return body.ok ? (body.result?.status ?? null) : null;
  } catch {
    return null;
  }
}

export type LinkedAccount = { id: string; login: string };

/** CommitIt account linked to this Telegram user (needs GitHub login). */
export async function senderAccount(telegramUserId: string): Promise<LinkedAccount | null> {
  try {
    const user = await prisma.user.findUnique({ where: { telegramUserId } });
    if (!user?.githubLogin) return null;
    return { id: user.id, login: user.githubLogin };
  } catch {
    return null;
  }
}

export type BindCheck =
  | { ok: true; userId: string }
  | { ok: false; reason: "needs_link" | "group_needs_admin" | "forbidden" };

/** Full gate for binding (and unbinding) a chat to a repo. */
export async function checkBindAllowed(
  chatId: string,
  sender: Sender,
  repoFullName: string,
  deps: FetchDeps = {},
): Promise<BindCheck> {
  const telegramUserId = sender.telegramUserId ?? "";
  if (!telegramUserId) return { ok: false, reason: "needs_link" };
  const account = await senderAccount(telegramUserId);
  if (!account) return { ok: false, reason: "needs_link" };
  if (isGroupChat(sender.chatType)) {
    const status = await getChatMemberStatus(chatId, telegramUserId, deps);
    if (status !== "creator" && status !== "administrator") {
      return { ok: false, reason: "group_needs_admin" };
    }
  }
  if (!(await canAccessRepo(account.id, repoFullName))) {
    return { ok: false, reason: "forbidden" };
  }
  return { ok: true, userId: account.id };
}

/** Repos this Telegram user can access (owned + member installs). */
export async function accessibleRepos(telegramUserId: string): Promise<string[]> {
  try {
    const user = await prisma.user.findUnique({
      where: { telegramUserId },
      include: { installations: { select: { installationId: true } } },
    });
    if (!user?.githubLogin) return [];
    const rows = await prisma.repo.findMany({
      where: {
        installActive: true,
        OR: [
          { ownerUserId: user.id },
          { installationId: { in: user.installations.map((i) => i.installationId) } },
        ],
      },
      select: { fullName: true },
      orderBy: { fullName: "asc" },
      take: 50,
    });
    return rows.map((r) => r.fullName);
  } catch {
    return [];
  }
}
