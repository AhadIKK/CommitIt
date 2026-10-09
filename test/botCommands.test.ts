import { afterEach, describe, expect, it, vi } from "vitest";
import { handleMessage } from "../src/telegramBot.js";
import { clearRateLimit } from "../src/rateLimit.js";
import { hashToken } from "../src/session.js";

const sent: { chatId: string; text: string }[] = [];
let memberStatus = "administrator";

vi.mock("../src/db.js", () => ({
  prisma: {
    linkToken: {
      findUnique: async (args: { where: { tokenHash: string } }) => {
        if (args.where.tokenHash === hashToken("a".repeat(64))) {
          return {
            tokenHash: args.where.tokenHash,
            purpose: "telegram_link",
            chatId: null,
            repoFullName: "o/r",
            expiresAt: new Date(Date.now() + 600_000),
            usedAt: null,
          };
        }
        return null;
      },
      update: async () => ({}),
    },
    telegramLink: { findUnique: async () => null },
    chat: {
      upsert: async (args: { where: { telegramChatId: string } }) => ({ id: `chat-${args.where.telegramChatId}` }),
      findUnique: async (args: { where: { telegramChatId: string } }) =>
        args.where.telegramChatId === "empty-chat" ? null : { id: "chat-1" },
    },
    repo: {
      upsert: async () => ({ id: "r1" }),
      findUnique: async (args: { where: { fullName?: string } }) => {
        if (args.where.fullName === "o/r") {
          return { installationId: 1n, installActive: true, ownerUserId: "u1", fullName: "o/r" };
        }
        return null;
      },
      findMany: async () => [{ fullName: "o/r" }],
    },
    subscription: {
      upsert: async () => ({}),
      findMany: async () => [{ repo: { fullName: "o/r" } }],
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
    userInstallation: { findUnique: async () => null },
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

describe("bot link/bind commands", () => {
  it("/start claims a deep-link token and subscribes", async () => {
    const restore = stubTelegram();
    try {
      await handleMessage("111", `/start ${"a".repeat(64)}`, {
        telegramUserId: "tg-1",
        chatType: "private",
      });
      expect(sent).toHaveLength(1);
      expect(sent[0]?.text).toContain("subscribed to o/r");
    } finally {
      restore();
    }
  });

  it("/bind works in DMs for linked users with access", async () => {
    const restore = stubTelegram();
    try {
      await handleMessage("111", "/bind o/r", { telegramUserId: "tg-1", chatType: "private" });
      expect(sent[0]?.text).toContain("subscribed to o/r");
    } finally {
      restore();
    }
  });

  it("/bind rejects unlinked users and non-admins in groups", async () => {
    const restore = stubTelegram();
    try {
      await handleMessage("222", "/bind o/r", { telegramUserId: "tg-9", chatType: "private" });
      expect(sent[0]?.text).toContain("Link your GitHub account");
      memberStatus = "member";
      await handleMessage("333", "/bind o/r", { telegramUserId: "tg-1", chatType: "supergroup" });
      expect(sent[1]?.text).toContain("Only group admins");
    } finally {
      restore();
    }
  });

  it("/repos lists accessible repos with bound marks", async () => {
    const restore = stubTelegram();
    try {
      await handleMessage("111", "/repos", { telegramUserId: "tg-1", chatType: "private" });
      expect(sent[0]?.text).toContain("✓");
      expect(sent[0]?.text).toContain("o/r");
    } finally {
      restore();
    }
  });

  it("/unlink removes and rate limits kick in", async () => {
    const restore = stubTelegram();
    try {
      await handleMessage("111", "/unlink o/r", { telegramUserId: "tg-1", chatType: "private" });
      expect(sent[0]?.text).toContain("Unsubscribed from o/r");
      for (let i = 0; i < 21; i++) {
        await handleMessage("111", "/repos", { telegramUserId: "tg-1", chatType: "private" });
      }
      expect(sent[sent.length - 1]?.text).toContain("Too many tries");
    } finally {
      restore();
    }
  });
});
