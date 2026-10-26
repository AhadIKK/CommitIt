import { prisma } from "./db.js";
import { telegramApi } from "./telegram.js";

// The name Telegram shows for a chat, captured once so the product can say
// "SynCura team" instead of "Group chat". Best-effort by design: a title is
// cosmetic, and a missing token or a blocked bot must never fail a link.

type TelegramChat = {
  type?: string;
  title?: string;
  first_name?: string;
  username?: string;
};

/** Prefer the group's title, then a person's name, then their handle. */
export function chatNameOf(chat: TelegramChat): string {
  return (chat.title ?? chat.first_name ?? chat.username ?? "").trim();
}

/** Fill `Chat.title` from getChat. Never overwrites a title we already have. */
export async function syncChatTitle(chatDbId: string, telegramChatId: string): Promise<void> {
  try {
    const existing = await prisma.chat.findUnique({
      where: { id: chatDbId },
      select: { title: true },
    });
    if (existing?.title) return;
    const chat = await telegramApi<TelegramChat>("getChat", { chat_id: telegramChatId });
    if (!chat) return;
    const title = chatNameOf(chat);
    if (!title) return;
    await prisma.chat.updateMany({
      where: { id: chatDbId, title: null },
      data: { title },
    });
  } catch {
    // Cosmetic only.
  }
}
