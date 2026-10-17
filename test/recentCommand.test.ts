import { afterEach, describe, expect, it, vi } from "vitest";
import { handleMessage } from "../src/telegramBot.js";
import { clearRateLimit } from "../src/rateLimit.js";

const sent: { chatId: string; text: string }[] = [];
let memberStatus = "administrator";

type Row = {
  sha: string;
  message: string;
  category: string | null;
  isMerge: boolean;
  secretFlag: boolean;
  committedAt: Date | null;
  createdAt: Date;
  author: { githubLogin: string } | null;
  repo: { fullName: string };
  issue: { number: number } | null;
};

function row(over: Partial<Row> = {}): Row {
  return {
    sha: "a1b2c3d4e5f6a7b8",
    message: "add /recent command",
    category: "feat",
    isMerge: false,
    secretFlag: false,
    committedAt: new Date("2026-10-18T10:00:00Z"),
    createdAt: new Date("2026-10-18T10:00:01Z"),
    author: { githubLogin: "octocat" },
    repo: { fullName: "o/r" },
    issue: { number: 7 },
    ...over,
  };
}

let commitRows: Row[] = [row()];
let subscriptions: { repoId: string }[] = [{ repoId: "r1" }];

vi.mock("../src/db.js", () => ({
  prisma: {
    chat: {
      findUnique: async (args: { where: { telegramChatId: string } }) =>
        args.where.telegramChatId === "empty-chat" ? null : { id: "chat-1" },
    },
    repo: {
      findUnique: async (args: { where: { fullName?: string } }) =>
        args.where.fullName === "o/r"
          ? {
              id: "r1",
              installationId: 1n,
              installActive: true,
              ownerUserId: "u1",
              fullName: "o/r",
            }
          : null,
    },
    subscription: { findMany: async () => subscriptions },
    commit: { findMany: async () => commitRows },
    user: {
      findUnique: async (args: { where: { telegramUserId?: string } }) =>
        args.where.telegramUserId === "tg-1"
          ? { id: "u1", githubLogin: "octocat", installations: [{ installationId: 1n }] }
          : { id: "u9", githubLogin: null, installations: [] },
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
  commitRows = [row()];
  subscriptions = [{ repoId: "r1" }];
});

describe("bot /recent", () => {
  it("lists the newest commits from this chat's subscriptions", async () => {
    const restore = stubTelegram();
    try {
      await handleMessage("111", "/recent", { telegramUserId: "tg-1", chatType: "private" });
      const text = sent[0]?.text ?? "";
      expect(text).toContain("Recent commits");
      expect(text).toContain("<code>o/r</code>");
      expect(text).toContain("a1b2c3d");
      expect(text).toContain("add /recent command");
      expect(text).toContain("octocat");
    } finally {
      restore();
    }
  });

  it("tells a chat with no subscriptions what to do", async () => {
    const restore = stubTelegram();
    try {
      subscriptions = [];
      await handleMessage("111", "/recent", { telegramUserId: "tg-1", chatType: "private" });
      expect(sent[0]?.text).toContain("has no subscriptions");
      expect(sent[0]?.text).toContain("/bind owner/repo");
    } finally {
      restore();
    }
  });

  it("reads a named repo once access is confirmed", async () => {
    const restore = stubTelegram();
    try {
      await handleMessage("111", "/recent o/r", { telegramUserId: "tg-1", chatType: "private" });
      expect(sent[0]?.text).toContain("Recent commits");
      expect(sent[0]?.text).toContain("All commits");
    } finally {
      restore();
    }
  });

  it("refuses a repo the sender cannot access", async () => {
    const restore = stubTelegram();
    try {
      await handleMessage("111", "/recent someone/private", {
        telegramUserId: "tg-1",
        chatType: "private",
      });
      expect(sent[0]?.text).toContain("can't access that repo");
    } finally {
      restore();
    }
  });

  it("asks for a linked account when the sender has none", async () => {
    const restore = stubTelegram();
    try {
      await handleMessage("111", "/recent o/r", { telegramUserId: "tg-9", chatType: "private" });
      expect(sent[0]?.text).toContain("Link your GitHub account");
    } finally {
      restore();
    }
  });

  it("requires a group admin to read another repo in a group", async () => {
    const restore = stubTelegram();
    try {
      memberStatus = "member";
      await handleMessage("333", "/recent o/r", { telegramUserId: "tg-1", chatType: "supergroup" });
      expect(sent[0]?.text).toContain("Only group admins");
    } finally {
      restore();
    }
  });

  it("still lists the chat's own repo for a plain group member", async () => {
    const restore = stubTelegram();
    try {
      memberStatus = "member";
      await handleMessage("444", "/recent", { telegramUserId: "tg-1", chatType: "supergroup" });
      expect(sent[0]?.text).toContain("Recent commits");
    } finally {
      restore();
    }
  });

  it("rejects a malformed repo with usage", async () => {
    const restore = stubTelegram();
    try {
      await handleMessage("111", "/recent nope", { telegramUserId: "tg-1", chatType: "private" });
      expect(sent[0]?.text).toContain("Usage: /recent [owner/repo]");
    } finally {
      restore();
    }
  });

  it("renders an unattributed commit as unknown, never blank (rule 12)", async () => {
    const restore = stubTelegram();
    try {
      commitRows = [row({ author: null })];
      await handleMessage("111", "/recent", { telegramUserId: "tg-1", chatType: "private" });
      expect(sent[0]?.text).toContain("unknown");
    } finally {
      restore();
    }
  });

  it("withholds a flagged commit's subject", async () => {
    const restore = stubTelegram();
    try {
      commitRows = [row({ secretFlag: true, message: "ghp_deadbeefdeadbeefdeadbeef" })];
      await handleMessage("111", "/recent", { telegramUserId: "tg-1", chatType: "private" });
      const text = sent[0]?.text ?? "";
      expect(text).toContain("possible secret — subject withheld");
      expect(text).not.toContain("ghp_deadbeef");
    } finally {
      restore();
    }
  });

  it("falls back to createdAt when a legacy row has no committedAt", async () => {
    const restore = stubTelegram();
    try {
      // createdAt far in the past, so the rendered age is stable regardless of
      // when this runs — the point is that a date is used at all, not null.
      commitRows = [row({ committedAt: null, createdAt: new Date("2020-01-02T00:00:00Z") })];
      await handleMessage("111", "/recent", { telegramUserId: "tg-1", chatType: "private" });
      const text = sent[0]?.text ?? "";
      expect(text).toMatch(/— octocat, \d+y ago/);
      expect(text).not.toContain("Invalid");
    } finally {
      restore();
    }
  });

  it("never leaks the count of a capped list past the limit", async () => {
    const restore = stubTelegram();
    try {
      // 11 rows for a 10-row view: the last must be summarised, not listed.
      commitRows = Array.from({ length: 11 }, (_, i) =>
        row({ sha: `${i}`.repeat(40), message: `commit ${i}` }),
      );
      await handleMessage("111", "/recent", { telegramUserId: "tg-1", chatType: "private" });
      const text = sent[0]?.text ?? "";
      expect(text).toContain("commit 0");
      expect(text).not.toContain("commit 10");
      expect(text).toContain("+1 more");
    } finally {
      restore();
    }
  });
});
