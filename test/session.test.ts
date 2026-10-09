import { describe, expect, it, vi } from "vitest";
import {
  SESSION_TTL_SEC,
  createSession,
  genSessionId,
  genState,
  getSessionUser,
  hashToken,
  parseCookies,
  parseSessionCookie,
  revokeSession,
  safeEqual,
  sessionCookieValue,
} from "../src/session.js";

const SECRET = "test-session-secret";

const rows = new Map<string, { userId: string; expiresAt: Date; revokedAt: Date | null }>();

vi.mock("../src/db.js", () => ({
  prisma: {
    session: {
      create: async (args: { data: { userId: string; tokenHash: string; expiresAt: Date } }) => {
        rows.set(args.data.tokenHash, {
          userId: args.data.userId,
          expiresAt: args.data.expiresAt,
          revokedAt: null,
        });
        return { id: "s1" };
      },
      findUnique: async (args: { where: { tokenHash: string } }) => {
        const row = rows.get(args.where.tokenHash);
        if (!row) return null;
        return {
          ...row,
          user: { id: row.userId, githubLogin: "octocat", avatarUrl: null },
        };
      },
      updateMany: async (args: { where: { tokenHash: string } }) => {
        const row = rows.get(args.where.tokenHash);
        if (row && !row.revokedAt) {
          row.revokedAt = new Date();
          return { count: 1 };
        }
        return { count: 0 };
      },
    },
  },
}));

describe("session ids and hashes", () => {
  it("generates unique 64-hex ids", () => {
    const a = genSessionId();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(genSessionId()).not.toBe(a);
  });

  it("hashes deterministically with constant-time compare", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
    expect(hashToken("abc")).toHaveLength(64);
    expect(safeEqual(hashToken("abc"), hashToken("abc"))).toBe(true);
    expect(safeEqual(hashToken("abc"), hashToken("abd"))).toBe(false);
    expect(safeEqual("short", hashToken("abc"))).toBe(false);
  });

  it("round-trips signed cookies and rejects tampering", () => {
    const value = sessionCookieValue("a".repeat(64), SECRET);
    expect(parseSessionCookie(value, SECRET)).toBe("a".repeat(64));
    expect(parseSessionCookie(value, "wrong-secret", )).toBeNull();
    expect(parseSessionCookie(value.slice(0, -2) + "AA", SECRET)).toBeNull();
    expect(parseSessionCookie("garbage", SECRET)).toBeNull();
    expect(parseSessionCookie(undefined, SECRET)).toBeNull();
  });

  it("generates unique 32-hex OAuth states", () => {
    expect(genState()).toMatch(/^[0-9a-f]{32}$/);
  });

  it("parses cookie headers", () => {
    expect(parseCookies("a=1; b=hello%20world; a=ignored")).toEqual({
      a: "1",
      b: "hello world",
    });
    expect(parseCookies(undefined)).toEqual({});
  });
});

describe("server-side sessions", () => {
  it("creates, resolves, and revokes", async () => {
    rows.clear();
    const now = 1_700_000_000_000;
    const sid = await createSession("u1", SESSION_TTL_SEC, now);
    expect(sid).toMatch(/^[0-9a-f]{64}$/);
    // Only the hash is stored — the raw id must not appear as a key.
    expect(rows.has(sid)).toBe(false);
    expect(rows.has(hashToken(sid))).toBe(true);

    const value = sessionCookieValue(sid, SECRET);
    const user = await getSessionUser(value, SECRET, now);
    expect(user).toMatchObject({ id: "u1", login: "octocat" });

    await revokeSession(value);
    await expect(getSessionUser(value, SECRET, now)).resolves.toBeNull();
  });

  it("rejects expired sessions", async () => {
    rows.clear();
    const now = 1_700_000_000_000;
    const sid = await createSession("u1", 60, now);
    const value = sessionCookieValue(sid, SECRET);
    await expect(getSessionUser(value, SECRET, now + 61_000)).resolves.toBeNull();
  });
});
