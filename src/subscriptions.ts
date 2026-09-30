import { prisma } from "./db.js";

// subscriptions.ts — prefs live per-subscription (chat × repo).
// Never on users. Digest/quiet-hours/mute are subscription-scoped.

export type DigestMode = "instant" | "hourly" | "daily" | "weekly";

export async function getSubscription(chatId: string, repoId: string) {
  try {
    return await prisma.subscription.findUnique({
      where: { chatId_repoId: { chatId, repoId } },
    });
  } catch {
    return null;
  }
}

export async function setDigestMode(
  chatId: string,
  repoId: string,
  mode: DigestMode,
): Promise<void> {
  try {
    await prisma.subscription.update({
      where: { chatId_repoId: { chatId, repoId } },
      data: { digestMode: mode },
    });
  } catch {
    // dev without DB: no-op
  }
}

export async function setMuted(
  chatId: string,
  repoId: string,
  muted: boolean,
): Promise<void> {
  try {
    await prisma.subscription.update({
      where: { chatId_repoId: { chatId, repoId } },
      data: { isMuted: muted },
    });
  } catch {
    // dev without DB: no-op
  }
}

export async function setQuietHours(
  chatId: string,
  repoId: string,
  start: string | null,
  end: string | null,
): Promise<void> {
  try {
    await prisma.subscription.update({
      where: { chatId_repoId: { chatId, repoId } },
      data: { quietHoursStart: start, quietHoursEnd: end },
    });
  } catch {
    // dev without DB: no-op
  }
}
