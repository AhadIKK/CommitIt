import { prisma } from "./db.js";
import { canAccessRepo } from "./access.js";

// notifyPrefs.ts — digest-mode control shared by the bot (/digest), the
// Fastify BFF, and the Vercel mirror. Website identity is the session user;
// their DM chats are the ones whose telegramChatId equals the user's
// Telegram id. Group chats are bot-side only (/digest there, admin-gated).

export const DIGEST_MODES = ["instant", "hourly", "daily", "weekly"] as const;
export type DigestMode = (typeof DIGEST_MODES)[number];

export function isDigestMode(v: unknown): v is DigestMode {
  return typeof v === "string" && (DIGEST_MODES as readonly string[]).includes(v);
}

export type MySubscription = { repo: string; digestMode: string; isMuted: boolean };

/** DM subscriptions for a website user. [] when unlinked; null on DB failure. */
export async function mySubscriptions(userId: string): Promise<MySubscription[] | null> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { telegramUserId: true },
    });
    if (!user?.telegramUserId) return [];
    const chats = await prisma.chat.findMany({
      where: { telegramChatId: user.telegramUserId },
      select: { id: true },
    });
    if (chats.length === 0) return [];
    const rows = await prisma.subscription.findMany({
      where: { chatId: { in: chats.map((c) => c.id) } },
      include: { repo: { select: { fullName: true } } },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((s) => ({ repo: s.repo.fullName, digestMode: s.digestMode, isMuted: s.isMuted }));
  } catch {
    return null;
  }
}

export type SetDigestResult = { updated: number } | { error: "forbidden" | "unavailable" | "no_subscription" };

/** Set digest mode on the user's DM subscriptions for one repo. */
export async function setMyDigestMode(
  userId: string,
  repoFullName: string,
  mode: DigestMode,
): Promise<SetDigestResult> {
  try {
    if (!(await canAccessRepo(userId, repoFullName))) return { error: "forbidden" };
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { telegramUserId: true },
    });
    if (!user?.telegramUserId) return { error: "no_subscription" };
    const chats = await prisma.chat.findMany({
      where: { telegramChatId: user.telegramUserId },
      select: { id: true },
    });
    if (chats.length === 0) return { error: "no_subscription" };
    const repoRow = await prisma.repo.findUnique({
      where: { fullName: repoFullName },
      select: { id: true },
    });
    if (!repoRow) return { error: "no_subscription" };
    const res = await prisma.subscription.updateMany({
      where: { chatId: { in: chats.map((c) => c.id) }, repoId: repoRow.id },
      data: { digestMode: mode },
    });
    if (res.count === 0) return { error: "no_subscription" };
    return { updated: res.count };
  } catch {
    return { error: "unavailable" };
  }
}
