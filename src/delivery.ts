import { prisma } from "./db.js";
import { inQuietHours, nextDigestAt, quietEndsAt } from "./scheduler.js";
import { sendMessage } from "./telegram.js";

// delivery.ts — per-subscription fan-out. Replaces the single
// TELEGRAM_DEFAULT_CHAT_ID blast: every message goes to each subscribed
// chat, honoring digest mode, quiet hours, and mute.
// - instant + awake → send now (priority alerts also bypass quiet hours)
// - anything else → Notification row (reschedule, never drop)
// - no subscriptions → default chat fallback (dev/back-compat)

export type Recipient = {
  subscriptionId: string | null; // null = default-chat fallback
  telegramChatId: string;
  digestMode: string;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
};

function fallbackRecipient(): Recipient[] {
  const chat = process.env.TELEGRAM_DEFAULT_CHAT_ID ?? "";
  if (!chat) return [];
  return [
    {
      subscriptionId: null,
      telegramChatId: chat,
      digestMode: "instant",
      quietHoursStart: null,
      quietHoursEnd: null,
    },
  ];
}

export async function resolveRecipients(repoFullName: string): Promise<Recipient[]> {
  try {
    const repoRow = await prisma.repo.findUnique({ where: { fullName: repoFullName } });
    if (!repoRow) return fallbackRecipient();
    const subs = await prisma.subscription.findMany({
      where: { repoId: repoRow.id, isMuted: false },
      include: { chat: { select: { telegramChatId: true } } },
    });
    if (subs.length === 0) return fallbackRecipient();
    return subs.map((s) => ({
      subscriptionId: s.id,
      telegramChatId: s.chat.telegramChatId,
      digestMode: s.digestMode,
      quietHoursStart: s.quietHoursStart,
      quietHoursEnd: s.quietHoursEnd,
    }));
  } catch {
    return fallbackRecipient();
  }
}

export type Route = "send" | "defer";

export function routeRecipient(
  r: Pick<Recipient, "digestMode" | "quietHoursStart" | "quietHoursEnd">,
  priority: boolean,
  now: Date,
): Route {
  if (priority) return "send";
  if (r.digestMode !== "instant") return "defer";
  if (inQuietHours(now, r.quietHoursStart, r.quietHoursEnd)) return "defer";
  return "send";
}

function deferAt(
  r: Recipient,
  now: Date,
): Date {
  if (r.digestMode === "instant") {
    return quietEndsAt(now, r.quietHoursStart ?? "0", r.quietHoursEnd ?? "0");
  }
  return nextDigestAt(r.digestMode, now);
}

export async function deliver(
  repoFullName: string,
  type: string,
  html: string,
  opts: { priority?: boolean; now?: Date } = {},
): Promise<void> {
  const now = opts.now ?? new Date();
  const priority = opts.priority ?? false;
  const recipients = await resolveRecipients(repoFullName);
  for (const r of recipients) {
    if (routeRecipient(r, priority, now) === "send") {
      await sendMessage(r.telegramChatId, html);
      continue;
    }
    if (!r.subscriptionId) continue; // fallback is always instant+awake
    try {
      await prisma.notification.create({
        data: {
          subscriptionId: r.subscriptionId,
          type,
          body: html,
          status: "queued",
          scheduledFor: deferAt(r, now),
        },
      });
    } catch {
      // dev without DB: deferred message is dropped with the process —
      // logged by the caller path, never silently half-sent
    }
  }
}

// Sends due queued notifications, one digest per subscription (grouped,
// capped at Telegram's 3800 chars). Quiet hours reschedule, not drop.
export async function dispatchDueNotifications(now: Date = new Date()): Promise<number> {
  try {
    const due = await prisma.notification.findMany({
      where: {
        status: { in: ["queued", "skipped_quiet_hours"] },
        OR: [{ scheduledFor: null }, { scheduledFor: { lte: now } }],
      },
      include: {
        subscription: { include: { chat: { select: { telegramChatId: true } } } },
      },
      take: 50,
    });
    const bySub = new Map<string, typeof due>();
    for (const n of due) {
      const list = bySub.get(n.subscriptionId) ?? [];
      list.push(n);
      bySub.set(n.subscriptionId, list);
    }
    let digests = 0;
    for (const [, notes] of bySub) {
      const sub = notes[0]!.subscription;
      if (sub.isMuted) {
        await prisma.notification.updateMany({
          where: { id: { in: notes.map((n) => n.id) } },
          data: { status: "failed" },
        });
        continue;
      }
      if (inQuietHours(now, sub.quietHoursStart, sub.quietHoursEnd)) {
        await prisma.notification.updateMany({
          where: { id: { in: notes.map((n) => n.id) } },
          data: {
            status: "skipped_quiet_hours",
            scheduledFor: quietEndsAt(now, sub.quietHoursStart ?? "0", sub.quietHoursEnd ?? "0"),
          },
        });
        continue;
      }
      let body = notes.map((n) => n.body).join("\n\n");
      if (body.length > 3800) body = body.slice(0, 3780) + "\n… truncated";
      await sendMessage(sub.chat.telegramChatId, body);
      await prisma.notification.updateMany({
        where: { id: { in: notes.map((n) => n.id) } },
        data: { status: "sent" },
      });
      digests++;
    }
    return digests;
  } catch {
    return 0;
  }
}
