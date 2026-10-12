import { describe, expect, it, vi } from "vitest";
import {
  claimLinkToken,
  createLinkToken,
  genLinkToken,
  isTokenClaimed,
} from "../src/linkTokens.js";
import { hashToken } from "../src/session.js";

type Row = {
  tokenHash: string;
  purpose: string;
  chatId: string | null;
  repoFullName: string | null;
  githubLogin: string | null;
  expiresAt: Date;
  usedAt: Date | null;
};
const rows = new Map<string, Row>();
const users = new Map<string, { id: string; telegramUserId: string | null }>([
  ["octocat", { id: "u1", telegramUserId: null }],
]);

vi.mock("../src/db.js", () => ({
  prisma: {
    linkToken: {
      create: async (args: { data: Omit<Row, "usedAt" | "chatId"> & { chatId?: null } }) => {
        const row: Row = { ...args.data, chatId: null, usedAt: null };
        rows.set(row.tokenHash, row);
        return row;
      },
      findUnique: async (args: { where: { tokenHash: string } }) =>
        rows.get(args.where.tokenHash) ?? null,
      update: async (args: { where: { tokenHash: string }; data: Partial<Row> }) => {
        const row = rows.get(args.where.tokenHash);
        if (!row) throw new Error("missing");
        Object.assign(row, args.data);
        return row;
      },
    },
    user: {
      findUnique: async (args: { where: { githubLogin?: string } }) =>
        args.where.githubLogin ? (users.get(args.where.githubLogin) ?? null) : null,
      update: async (args: { where: { id: string }; data: { telegramUserId: string } }) => {
        for (const u of users.values()) {
          if (u.id === args.where.id) u.telegramUserId = args.data.telegramUserId;
        }
        return {};
      },
    },
  },
}));

describe("link tokens (hash-only)", () => {
  it("mints 32-byte tokens and stores only the hash", async () => {
    rows.clear();
    const issued = await createLinkToken("o/r");
    expect(issued?.token).toMatch(/^[0-9a-f]{64}$/);
    expect([...rows.keys()]).toEqual([hashToken(issued?.token ?? "")]);
    expect([...rows.values()][0]).toMatchObject({ purpose: "telegram_link", usedAt: null });
  });

  it("claims once, then rejects reuse", async () => {
    rows.clear();
    const issued = await createLinkToken("o/r");
    const token = issued?.token ?? "";
    await expect(claimLinkToken(token, "chat-1")).resolves.toMatchObject({
      status: "linked",
      repoFullName: "o/r",
    });
    await expect(isTokenClaimed(token)).resolves.toBe(true);
    await expect(claimLinkToken(token, "chat-2")).resolves.toMatchObject({ status: "invalid" });
  });

  it("rejects tampered, malformed, and expired tokens", async () => {
    rows.clear();
    const issued = await createLinkToken("o/r");
    const token = issued?.token ?? "";
    const tampered = token.slice(0, -1) + (token.endsWith("0") ? "1" : "0");
    await expect(claimLinkToken(tampered, "c")).resolves.toMatchObject({ status: "invalid" });
    await expect(claimLinkToken("not-hex!!", "c")).resolves.toMatchObject({ status: "invalid" });
    const row = rows.get(hashToken(token));
    if (row) row.expiresAt = new Date(Date.now() - 1000);
    await expect(claimLinkToken(token, "c")).resolves.toMatchObject({ status: "invalid" });
    await expect(isTokenClaimed("z".repeat(64))).resolves.toBe(false);
  });

  it("joins the Telegram sender to the issuing account (first wins)", async () => {
    rows.clear();
    users.set("octocat", { id: "u1", telegramUserId: null });
    const issued = await createLinkToken("o/r", "octocat");
    const token = issued?.token ?? "";
    await expect(claimLinkToken(token, "chat-1", "tg-1")).resolves.toMatchObject({
      status: "linked",
    });
    expect(users.get("octocat")?.telegramUserId).toBe("tg-1");

    // Second claim attempt on a fresh token must not steal the mapping.
    const second = await createLinkToken("o/r", "octocat");
    await claimLinkToken(second?.token ?? "", "chat-2", "tg-2");
    expect(users.get("octocat")?.telegramUserId).toBe("tg-1");
  });

  it("skips binding for anonymous tokens", async () => {
    rows.clear();
    users.set("octocat", { id: "u1", telegramUserId: null });
    const issued = await createLinkToken("o/r");
    await claimLinkToken(issued?.token ?? "", "chat-1", "tg-9");
    expect(users.get("octocat")?.telegramUserId).toBeNull();
  });
});
