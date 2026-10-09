import { describe, expect, it, vi } from "vitest";
import { canAccessRepo, checkRepoAccess } from "../src/access.js";
import { sessionCookieValue } from "../src/session.js";

const SECRET = "test-access-secret";
const SID = "c".repeat(64);

// repo state per fullName; membership per `${userId}:${installationId}`
const repos: Record<
  string,
  { installationId: bigint | null; installActive: boolean; ownerUserId: string | null }
> = {
  "o/owned": { installationId: 1n, installActive: true, ownerUserId: "u1" },
  "o/member": { installationId: 2n, installActive: true, ownerUserId: "u9" },
  "o/stranger": { installationId: 3n, installActive: true, ownerUserId: "u9" },
  "o/suspended": { installationId: 4n, installActive: false, ownerUserId: "u1" },
  "o/manual": { installationId: null, installActive: true, ownerUserId: null },
};
const members = new Set(["u1:2"]);

vi.mock("../src/db.js", () => ({
  prisma: {
    repo: {
      findUnique: async (args: { where: { fullName: string } }) => repos[args.where.fullName] ?? null,
    },
    userInstallation: {
      findUnique: async (args: { where: { userId_installationId: { userId: string; installationId: bigint } } }) => {
        const { userId, installationId } = args.where.userId_installationId;
        return members.has(`${userId}:${installationId}`) ? { id: "m1" } : null;
      },
    },
    session: {
      findUnique: async () => ({
        revokedAt: null,
        expiresAt: new Date(Date.now() + 3600_000),
        user: { id: "u1", githubLogin: "octocat", avatarUrl: null },
      }),
    },
  },
}));

describe("canAccessRepo", () => {
  it("allows owners and members, denies the rest", async () => {
    await expect(canAccessRepo("u1", "o/owned")).resolves.toBe(true);
    await expect(canAccessRepo("u1", "o/member")).resolves.toBe(true);
    await expect(canAccessRepo("u1", "o/stranger")).resolves.toBe(false);
    await expect(canAccessRepo("u1", "o/missing")).resolves.toBe(false);
  });

  it("denies suspended installs and install-less repos", async () => {
    await expect(canAccessRepo("u1", "o/suspended")).resolves.toBe(false);
    await expect(canAccessRepo("u1", "o/manual")).resolves.toBe(false);
  });
});

describe("checkRepoAccess", () => {
  const cookie = sessionCookieValue(SID, SECRET);

  it("401s without a session, 403s without access, ok otherwise", async () => {
    await expect(checkRepoAccess(undefined, SECRET, "o/owned")).resolves.toEqual({
      denial: { status: 401, error: "logged_out" },
    });
    const forbidden = await checkRepoAccess(cookie, SECRET, "o/stranger");
    expect(forbidden).toEqual({ denial: { status: 403, error: "forbidden" } });
    const ok = await checkRepoAccess(cookie, SECRET, "o/owned");
    expect(ok).toMatchObject({ user: { id: "u1", login: "octocat" } });
  });
});
