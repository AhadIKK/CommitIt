import { describe, expect, it, vi } from "vitest";
import dataHandler from "../api/data/[view].js";
import { SESSION_COOKIE, sessionCookieValue } from "../src/session.js";

// The dashboard's single call: /api/data/all. Five endpoints were collapsed
// into api/data/[view].ts (rewritten by vercel.json) so one page load costs one
// round trip instead of five, and so the server can pick the default repo with
// the account in hand instead of the client asking twice.
//
// Mutable state so a test can flip the account between "owns repos" and
// "installed nothing yet".
const state = vi.hoisted(() => ({ owned: ["AhadIKK/CommitIt"] as string[] }));
const seen = vi.hoisted(() => ({ progress: [] as string[], activity: [] as string[] }));

vi.mock("../src/dashboard.js", () => ({
  getProgress: async (repo: string) => {
    seen.progress.push(repo);
    return { repo, milestones: [{ title: "v1" }], overall: null };
  },
  getActivity: async (repo: string) => {
    seen.activity.push(repo);
    return {
      repo,
      authors: [{ login: "AhadIKK", commits: 2 }],
      commits: [],
      totalCommits: 2,
      totalMergedPRs: 0,
      totalCommitsAllTime: 2,
      totalMergedPRsAllTime: 0,
      githubMainCommits: null,
    };
  },
  getIssues: async () => [{ number: 1 }],
  getDigests: async () => [{ id: "d1" }],
}));

vi.mock("../src/db.js", () => ({
  prisma: {
    session: {
      findUnique: async () => ({
        revokedAt: null,
        expiresAt: new Date(Date.now() + 3_600_000),
        user: { id: "u1", githubLogin: "AhadIKK", avatarUrl: null },
      }),
    },
    repo: {
      findUnique: async (args: { where: { fullName: string } }) =>
        args.where.fullName.startsWith("AhadIKK/")
          ? { installationId: 1n, installActive: true, ownerUserId: "u1" }
          : null,
      findMany: async () => state.owned.map((fullName) => ({ fullName })),
    },
    userInstallation: { findUnique: async () => null },
  },
}));

const SECRET = "test-session-secret";
const COOKIE = `${SESSION_COOKIE}=${encodeURIComponent(sessionCookieValue("d".repeat(64), SECRET))}`;

function mockRes(): { res: never; done: Promise<{ status: number; body: unknown }> } {
  let settle: (v: { status: number; body: unknown }) => void = () => {};
  const done = new Promise<{ status: number; body: unknown }>((resolve) => {
    settle = resolve;
  });
  const res = {
    statusCode: 0,
    setHeader: () => {},
    end: (raw?: string) => {
      settle({ status: res.statusCode, body: raw ? JSON.parse(raw) : undefined });
    },
  };
  return { res: res as unknown as never, done };
}

function get(url: string, cookie = COOKIE) {
  return {
    method: "GET",
    headers: { cookie },
    socket: { remoteAddress: "127.0.0.1" },
    url,
  } as never;
}

/** Run one request with auth on (the production configuration). */
async function request(url: string, cookie = COOKIE) {
  const saved = { client: process.env.GITHUB_CLIENT_ID, secret: process.env.SESSION_SECRET };
  process.env.GITHUB_CLIENT_ID = "client-123";
  process.env.SESSION_SECRET = SECRET;
  try {
    const { res, done } = mockRes();
    await (dataHandler as unknown as (r: never, s: never) => Promise<void>)(get(url, cookie), res);
    return (await done) as { status: number; body: { ok: boolean; data?: Data } };
  } finally {
    if (saved.client !== undefined) process.env.GITHUB_CLIENT_ID = saved.client;
    else delete process.env.GITHUB_CLIENT_ID;
    if (saved.secret !== undefined) process.env.SESSION_SECRET = saved.secret;
    else delete process.env.SESSION_SECRET;
  }
}

type Data = {
  repo: string;
  me: { login: string; repos: string[] } | null;
  denied?: { status: number; error: string };
  progress?: { repo: string; milestones: unknown[] };
  activity?: unknown;
  issues?: unknown[];
  digests?: unknown[];
};

describe("api/data/all — the dashboard's one request", () => {
  it("returns every panel and the account, and picks the repo itself", async () => {
    state.owned = ["AhadIKK/CommitIt"];
    seen.progress.length = 0;
    seen.activity.length = 0;

    const { status, body } = await request("/api/data/all?repo=nope%2Fnothing-here&prefer=1");

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    const d = body.data as Data;
    // The placeholder was replaced by the account's own first repo, server-side.
    expect(d.repo).toBe("AhadIKK/CommitIt");
    expect(d.me).toEqual({ login: "AhadIKK", avatarUrl: null, repos: ["AhadIKK/CommitIt"] });
    expect(d.progress?.milestones).toHaveLength(1);
    expect(d.activity).toBeTruthy();
    expect(d.issues).toHaveLength(1);
    expect(d.digests).toHaveLength(1);
    // Every panel was read for the picked repo, not the placeholder.
    expect(seen.progress).toEqual(["AhadIKK/CommitIt"]);
    expect(seen.activity).toEqual(["AhadIKK/CommitIt"]);
  });

  it("never overrides a repo the caller named explicitly", async () => {
    state.owned = ["AhadIKK/CommitIt", "AhadIKK/other"];
    seen.progress.length = 0;

    const { body } = await request("/api/data/all?repo=AhadIKK%2Fother&prefer=1");

    const d = body.data as Data;
    expect(d.repo).toBe("AhadIKK/other");
    expect(seen.progress).toEqual(["AhadIKK/other"]);
  });

  it("still says who is asking when the repo is denied", async () => {
    state.owned = []; // logged in, nothing installed yet

    const { status, body } = await request("/api/data/all?repo=nope%2Fnothing-here&prefer=1");

    // 200, not 403: the account rides along so Welcome can offer the right
    // step (install the App, not link GitHub). The client re-throws `denied`.
    expect(status).toBe(200);
    const d = body.data as Data;
    expect(d.denied).toEqual({ status: 403, error: "forbidden" });
    expect(d.me).toEqual({ login: "AhadIKK", avatarUrl: null, repos: [] });
    // No data fields at all, so the dashboard keeps its empty/Welcome state.
    expect(d).not.toHaveProperty("progress");
    expect(d).not.toHaveProperty("activity");
  });

  it("denies 401 with no account when logged out", async () => {
    const { status, body } = await request("/api/data/all?repo=nope%2Fnothing-here", "");

    expect(status).toBe(200);
    const d = body.data as Data;
    expect(d.denied).toEqual({ status: 401, error: "logged_out" });
    expect(d.me).toBeNull();
  });

  it("requires a repo, like the endpoints it replaced", async () => {
    const { status, body } = await request("/api/data/all");

    expect(status).toBe(400);
    expect(body).toEqual({ ok: false, error: "missing_repo" });
  });

  it("keeps the plain status codes on the single-panel views", async () => {
    const { status, body } = await request("/api/data/progress?repo=AhadIKK%2FCommitIt", "");

    expect(status).toBe(401);
    expect(body).toEqual({ ok: false, error: "logged_out" });
  });
});
