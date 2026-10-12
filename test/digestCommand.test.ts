import { afterEach, describe, expect, it, vi } from "vitest";
import { handleMessage } from "../src/telegramBot.js";
import { clearRateLimit } from "../src/rateLimit.js";

const sent: { chatId: string; text: string }[] = [];
let memberStatus = "administrator";

vi.mock("../src/db.js", () => ({
  prisma: {
    chat: {
      upsert: async (args: { where: { telegramChatId: string } }) => ({ id: `chat-${args.where.telegramChatId}` }),
      findUnique: async (args: { where: { telegramChatId: string } }) =>
        args.where.telegramChatId === "empty-chat" ? null : { id: "chat-1" },
    },
    repo: {
      upsert: async () => ({ id: "r1" }),
      findUnique: async (args: { where: { fullName?: string } }) =>
        args.where.fullName === "o/r"
          ? { id: "r1", installationId: 1n, installActive: true, ownerUserId: "u1", fullName: "o/r" }
          : null,
    },
    subscription: {
      upsert: async () => ({}),
      findMany: async (args: { where: { chatId?: string } }) =>
        args.where.chatId === "empty-chat-id"
          ? []
          : [{ repo: { fullName: "o/r" }, digestMode: "daily", isMuted: false }],
      updateMany: async () => ({ count: 1 }),
      deleteMany: async () => ({ count: 1 }),
    },
    user: {
      findUnique: async (args: { where: { telegramUserId?: string } }) => {
        if (args.where.telegramUserId === "tg-1") {
          return { id: "u1", githubLogin: "octocat", installations: [{ installationId: 1n }] };
        }
        return { id: "u9", githubLogin: null, installations: [] };
      },
    },
    userInstallation: { findUnique: async () => ({}) },
  },
}));

function stubTelegram() {
  const savedToken = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = "dummy";
  const savedFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const target = url.toString();
    if (target.includes("getChatMember")) {
      return new Response(JSON.stringify({ ok: true, result: { status: memberStatus } }), {
        status: 200,
      });
    }
    if (target.includes("sendMessage")) {
      const body = JSON.parse((init?.body as string) ?? "{}") as {
        chat_id: string;
        text: string;
      };
      sent.push({ chatId: String(body.chat_id), text: body.text });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    throw new Error(`unexpected ${target}`);
  }) as typeof fetch;
  return () => {
    if (savedToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = savedToken;
    else delete process.env.TELEGRAM_BOT_TOKEN;
    globalThis.fetch = savedFetch;
  };
}

afterEach(() => {
  clearRateLimit();
  sent.length = 0;
  memberStatus = "administrator";
});

describe("bot /digest", () => {
  it("lists this chat's modes", async () => {
    const restore = stubTelegram();
    try {
      await handleMessage("111", "/digest", { telegramUserId: "tg-1", chatType: "private" });
      expect(sent[0]?.text).toContain("o/r");
      expect(sent[0]?.text).toContain("daily");
    } finally {
      restore();
    }
  });

  it("sets all chat subscriptions in DMs", async () => {
    const restore = stubTelegram();
    try {
      await handleMessage("111", "/digest instant", { telegramUserId: "tg-1", chatType: "private" });
      expect(sent[0]?.text).toContain("instant");
    } finally {
      restore();
    }
  });

  it("sets one repo with access check", async () => {
    const restore = stubTelegram();
    try {
      await handleMessage("111", "/digest hourly o/r", { telegramUserId: "tg-1", chatType: "private" });
      expect(sent[0]?.text).toContain("o/r");
      expect(sent[0]?.text).toContain("hourly");
    } finally {
      restore();
    }
  });

  it("rejects bad modes and repos with usage", async () => {
    const restore = stubTelegram();
    try {
      await handleMessage("111", "/digest sometimes", { telegramUserId: "tg-1", chatType: "private" });
      expect(sent[0]?.text).toContain("Usage: /digest");
      await handleMessage("111", "/digest instant nope", { telegramUserId: "tg-1", chatType: "private" });
      expect(sent[1]?.text).toContain("Usage: /digest");
    } finally {
      restore();
    }
  });

  it("requires admin for chat-wide changes in groups", async () => {
    const restore = stubTelegram();
    try {
      memberStatus = "member";
      await handleMessage("333", "/digest instant", { telegramUserId: "tg-1", chatType: "supergroup" });
      expect(sent[0]?.text).toContain("Only group admins");
    } finally {
      restore();
    }
  });
});
