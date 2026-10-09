import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import webhookHandler from "../api/webhook.js";
import healthHandler from "../api/health.js";
import progressHandler from "../api/progress.js";
import activityHandler from "../api/activity.js";
import issuesHandler from "../api/issues.js";
import digestsHandler from "../api/digests.js";
import { signPayload } from "../src/verify.js";
import { clearRateLimit } from "../src/rateLimit.js";
import { sessionCookieValue } from "../src/session.js";

function mockReq(
  opts: { method?: string; headers?: Record<string, string>; body?: string } = {},
) {
  const req = new EventEmitter() as EventEmitter & {
    method: string;
    headers: Record<string, string>;
    socket: { remoteAddress: string };
  };
  req.method = opts.method ?? "POST";
  req.headers = opts.headers ?? {};
  req.socket = { remoteAddress: "127.0.0.1" };
  process.nextTick(() => {
    if (opts.body !== undefined) req.emit("data", Buffer.from(opts.body));
    req.emit("end");
  });
  return req as unknown as Parameters<typeof webhookHandler>[0];
}

function mockRes() {
  let resolve!: (v: { status: number; body: unknown }) => void;
  const done = new Promise<{ status: number; body: unknown }>(
    (r) => (resolve = r),
  );
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    setHeader(k: string, v: string) {
      res.headers[k] = v;
    },
    end(payload: string) {
      resolve({ status: res.statusCode, body: JSON.parse(payload) });
    },
  };
  return { res: res as unknown as Parameters<typeof webhookHandler>[1], done };
}

const SECRET = "test-secret";

describe("api/webhook handler", () => {
  it("rejects non-POST with 405", async () => {
    const { res, done } = mockRes();
    await webhookHandler(mockReq({ method: "GET" }), res);
    expect(await done).toEqual({
      status: 405,
      body: { ok: false, error: "method_not_allowed" },
    });
  });

  it("rejects bad signature with 401", async () => {
    clearRateLimit();
    process.env.GITHUB_WEBHOOK_SECRET = SECRET;
    const { res, done } = mockRes();
    await webhookHandler(
      mockReq({
        headers: { "x-hub-signature-256": "sha256=deadbeef" },
        body: "{}",
      }),
      res,
    );
    expect(await done).toEqual({
      status: 401,
      body: { ok: false, error: "bad_signature" },
    });
  });

  it("accepts valid HMAC signature with 200", async () => {
    clearRateLimit();
    process.env.GITHUB_WEBHOOK_SECRET = SECRET;
    const raw = JSON.stringify({ zen: "hello" });
    const { res, done } = mockRes();
    await webhookHandler(
      mockReq({
        headers: {
          "x-hub-signature-256": signPayload(raw, SECRET),
          "x-github-event": "ping",
          "x-github-delivery": "abc-123",
        },
        body: raw,
      }),
      res,
    );
    expect(await done).toEqual({ status: 200, body: { ok: true } });
  });

  it("rejects invalid JSON with 400", async () => {
    clearRateLimit();
    delete process.env.GITHUB_WEBHOOK_SECRET;
    const { res, done } = mockRes();
    await webhookHandler(mockReq({ body: "not-json{" }), res);
    expect(await done).toEqual({
      status: 400,
      body: { ok: false, error: "invalid_json" },
    });
  });
});

describe("api/health handler", () => {
  it("returns { ok: true }", async () => {
    const { res, done } = mockRes();
    await healthHandler(
      mockReq({ method: "GET" }) as never,
      res as never,
    );
    expect(await done).toEqual({ status: 200, body: { ok: true } });
  });
});

function mockGetReq(url: string, headers: Record<string, string> = {}) {
  return {
    method: "GET",
    headers,
    socket: { remoteAddress: "127.0.0.1" },
    url,
  } as unknown as Parameters<typeof progressHandler>[0];
}

describe("dashboard api handlers (Phase C gates)", () => {
  // Regression: these endpoints 500d on Vercel when the DB was unreachable.
  // Phase C adds gates: no session -> 401, no access -> 403, and data
  // queries still degrade to 200 + empty on DB failure. Prisma is mocked
  // to fail fast so the test never touches the network.
  vi.mock("../src/db.js", () => ({
    prisma: {
      session: {
        findUnique: async () => ({
          revokedAt: null,
          expiresAt: new Date(Date.now() + 3600_000),
          user: { id: "u1", githubLogin: "octocat", avatarUrl: null },
        }),
      },
      repo: {
        // Owned + active for access checks; data queries throw (db down).
        findUnique: async (args: { where: { fullName: string } }) => {
          if (args.where.fullName === "o/denied") {
            return { installationId: 9n, installActive: true, ownerUserId: "u9" };
          }
          return { installationId: 1n, installActive: true, ownerUserId: "u1" };
        },
      },
      userInstallation: { findUnique: async () => null },
    },
  }));

  const SID = "d".repeat(64);
  const AUTH_SECRET = "test-session-secret";

  function authedHeaders(): { headers: Record<string, string>; restore: () => void } {
    const saved = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = AUTH_SECRET;
    return {
      headers: { cookie: `commitit_session=${encodeURIComponent(sessionCookieValue(SID, AUTH_SECRET))}` },
      restore: () => {
        if (saved !== undefined) process.env.SESSION_SECRET = saved;
        else delete process.env.SESSION_SECRET;
      },
    };
  }

  it("401s without a session", async () => {
    const { res, done } = mockRes();
    await (progressHandler as typeof progressHandler)(
      mockGetReq("/api/progress?repo=AhadIKK%2FCommitIt"),
      res as never,
    );
    expect(await done).toEqual({ status: 401, body: { ok: false, error: "logged_out" } });
  });

  it("403s without repo access", async () => {
    const { headers, restore } = authedHeaders();
    try {
      const { res, done } = mockRes();
      await (progressHandler as typeof progressHandler)(
        mockGetReq("/api/progress?repo=o%2Fdenied", headers),
        res as never,
      );
      expect(await done).toEqual({ status: 403, body: { ok: false, error: "forbidden" } });
    } finally {
      restore();
    }
  });

  it("return 200 + empty data when the DB is unreachable", async () => {
    const { headers, restore } = authedHeaders();
    try {
    const cases = [
        {
          handler: progressHandler,
          url: "/api/progress?repo=AhadIKK%2FCommitIt",
          data: { repo: "AhadIKK/CommitIt", milestones: [], overall: null },
        },
        {
          handler: activityHandler,
          url: "/api/activity?repo=AhadIKK%2FCommitIt&days=7",
          data: {
            repo: "AhadIKK/CommitIt",
            authors: [],
            totalCommits: 0,
            totalMergedPRs: 0,
          },
        },
        {
          handler: issuesHandler,
          url: "/api/issues?repo=AhadIKK%2FCommitIt",
          data: [],
        },
        {
          handler: digestsHandler,
          url: "/api/digests?repo=AhadIKK%2FCommitIt",
          data: [],
        },
      ] as const;
      for (const { handler, url, data } of cases) {
        const { res, done } = mockRes();
        await (handler as typeof progressHandler)(mockGetReq(url, headers), res as never);
        expect(await done).toEqual({ status: 200, body: { ok: true, data } });
      }
    } finally {
      restore();
    }
  });
});
