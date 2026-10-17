import { afterEach, describe, expect, it, vi } from "vitest";
import { clearRateLimit } from "../src/rateLimit.js";
import { dispatchUpdate, handleCallback } from "../src/telegramBot.js";

// Button taps must reuse the text-command handlers, so this suite mirrors the
// prisma shapes used by botCommands/digestCommand tests and watches which Bot
// API calls come out.
type Call = { method: string; body: Record<string, unknown> };
const calls: Call[] = [];
let memberStatus = "administrator";

vi.mock("../src/db.js", () => ({
  prisma: {
    linkToken: { findUnique: async () => null, update: async () => ({}) },
    telegramLink: { findUnique: async () => null },
    chat: {
      upsert: async (args: { where: { telegramChatId: string } }) => ({
        id: `chat-${args.where.telegramChatId}`,
      }),
      findUnique: async (args: { where: { telegramChatId: string } }) =>
        args.where.telegramChatId === "empty-chat" ? null : { id: "chat-1" },
    },
    repo: {
      upsert: async () => ({ id: "r1" }),
      findUnique: async (args: { where: { fullName?: string } }) =>
        args.where.fullName === "o/r"
          ? { id: "r1", installationId: 1n, installActive: true, ownerUserId: "u1", fullName: "o/r" }
          : null,
      findMany: async () => [{ fullName: "o/r" }],
    },
    subscription: {
      upsert: async () => ({}),
      findMany: async () => [{ repo: { fullName: "o/r" }, digestMode: "daily", isMuted: false }],
      updateMany: async () => ({ count: 1 }),
      deleteMany: async () => ({ count: 1 }),
    },
    user: {
      findUnique: async (args: { where: { telegramUserId?: string } }) =>
        args.where.telegramUserId === "42"
          ? { id: "u1", githubLogin: "octocat", installations: [{ installationId: 1n }] }
          : { id: "u9", githubLogin: null, installations: [] },
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
    calls.push({
      method: target.split("/").pop() ?? "",
      body: JSON.parse((init?.body as string) ?? "{}") as Record<string, unknown>,
    });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
  return () => {
    if (savedToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = savedToken;
    else delete process.env.TELEGRAM_BOT_TOKEN;
    globalThis.fetch = savedFetch;
  };
}

const of = (method: string) => calls.filter((c) => c.method === method);
const tapped = (data: string, chatId = "111", type = "private") =>
  handleCallback({
    id: `cb-${data}`,
    data,
    from: { id: 42 },
    message: { message_id: 5, chat: { id: Number(chatId), type } },
  });

afterEach(() => {
  clearRateLimit();
  calls.length = 0;
  memberStatus = "administrator";
});

describe("dispatchUpdate", () => {
  it("routes a message update to the command handler", async () => {
    const restore = stubTelegram();
    try {
      await dispatchUpdate({
        update_id: 1,
        message: { chat: { id: 99, type: "private" }, from: { id: 42 }, text: "/help" },
      });
      expect(of("sendMessage")).toHaveLength(1);
      expect(String(of("sendMessage")[0]?.body.text)).toContain("Commands:");
      // Help carries the site button.
      expect(of("sendMessage")[0]?.body.reply_markup).toBeDefined();
    } finally {
      restore();
    }
  });

  it("routes a button tap to the callback handler", async () => {
    const restore = stubTelegram();
    try {
      await dispatchUpdate({
        update_id: 2,
        callback_query: {
          id: "cb-1",
          data: "sub:o/r",
          from: { id: 42 },
          message: { message_id: 9, chat: { id: 111, type: "private" } },
        },
      });
      expect(of("answerCallbackQuery")).toHaveLength(1);
    } finally {
      restore();
    }
  });

  it("ignores updates that are neither", async () => {
    const restore = stubTelegram();
    try {
      await dispatchUpdate({ update_id: 3 });
      expect(calls).toHaveLength(0);
    } finally {
      restore();
    }
  });
});

describe("button taps", () => {
  it("subscribes, answers the tap, and rewrites the message in place", async () => {
    const restore = stubTelegram();
    try {
      await tapped("sub:o/r");
      expect(String(of("sendMessage")[0]?.body.text)).toContain("subscribed to o/r");

      const answers = of("answerCallbackQuery");
      expect(answers).toHaveLength(1);
      expect(answers[0]?.body.callback_query_id).toBe("cb-sub:o/r");
      expect(String(answers[0]?.body.text)).toBe("Subscribed to o/r");

      const edits = of("editMessageText");
      expect(edits).toHaveLength(1);
      expect(edits[0]?.body.message_id).toBe(5);
      expect(String(edits[0]?.body.text)).toContain("✓ <code>o/r</code>");
    } finally {
      restore();
    }
  });

  it("unsubscribes from a ✓ button", async () => {
    const restore = stubTelegram();
    try {
      await tapped("unsub:o/r");
      expect(String(of("sendMessage")[0]?.body.text)).toContain("Unsubscribed from o/r");
      expect(String(of("answerCallbackQuery")[0]?.body.text)).toBe("Unsubscribed from o/r");
      expect(of("editMessageText")).toHaveLength(1);
    } finally {
      restore();
    }
  });

  it("sets a chat-wide mode from a mode button", async () => {
    const restore = stubTelegram();
    try {
      await tapped("digest:weekly");
      expect(String(of("answerCallbackQuery")[0]?.body.text)).toBe("All → weekly");
      // The mode list rewrites itself rather than posting a second message.
      expect(of("editMessageText")).toHaveLength(1);
      expect(stringified()).toContain("Notifications for this chat:");
    } finally {
      restore();
    }
  });

  it("sets one repo's mode when the button pinned a repo", async () => {
    const restore = stubTelegram();
    try {
      await tapped("digest:weekly:o/r");
      expect(String(of("answerCallbackQuery")[0]?.body.text)).toBe("o/r → weekly");
    } finally {
      restore();
    }
  });

  // A tap carries its own sender, so the group admin rule still applies.
  it("refuses a chat-wide mode change from a non-admin group tap", async () => {
    const restore = stubTelegram();
    try {
      memberStatus = "member";
      await tapped("digest:instant", "333", "supergroup");
      expect(String(of("sendMessage")[0]?.body.text)).toContain("Only group admins");
      expect(String(of("answerCallbackQuery")[0]?.body.text)).toBe("Admins only");
      expect(of("editMessageText")).toHaveLength(0);
    } finally {
      restore();
    }
  });

  it("answers an unknown button instead of leaving it spinning", async () => {
    const restore = stubTelegram();
    try {
      await tapped("mystery:1");
      expect(of("answerCallbackQuery")).toHaveLength(1);
      expect(String(of("answerCallbackQuery")[0]?.body.text)).toContain("no longer supported");
      expect(of("sendMessage")).toHaveLength(0);
    } finally {
      restore();
    }
  });

  it("rate limits rapid taps", async () => {
    const restore = stubTelegram();
    try {
      for (let i = 0; i < 21; i++) await tapped("sub:o/r");
      const answers = of("answerCallbackQuery");
      expect(answers).toHaveLength(21);
      expect(String(answers[20]?.body.text)).toContain("Too many taps");
    } finally {
      restore();
    }
  });
});

function stringified(): string {
  return JSON.stringify(calls);
}
