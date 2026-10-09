import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import authHandler from "../api/auth/[action].js";
import appWebhookHandler from "../api/github-app.js";
import meHandler from "../api/me.js";
import metaHandler from "../api/meta.js";
import repoHandler from "../api/repo.js";
import { signPayload } from "../src/verify.js";
import { SESSION_COOKIE, sessionCookieValue } from "../src/session.js";
import installationFixture from "./fixtures/installation.json";

vi.mock("../src/db.js", () => ({
  prisma: {
    user: {
      upsert: async () => ({ id: "u1" }),
      findUnique: async () => ({ id: "u1" }),
    },
    repo: {
      upsert: async () => ({ id: "r1" }),
      updateMany: async () => ({ count: 1 }),
      findUnique: async () => ({ installationId: 12345678n }),
      findMany: async () => [{ fullName: "AhadIKK/CommitIt" }],
    },
    installation: {
      upsert: async () => ({}),
      deleteMany: async () => ({ count: 1 }),
    },
    userInstallation: { upsert: async () => ({}) },
    session: {
      updateMany: async () => ({ count: 0 }),
      create: async () => ({}),
      findUnique: async () => ({
        revokedAt: null,
        expiresAt: new Date(Date.now() + 3600_000),
        user: { id: "u1", githubLogin: "octocat", avatarUrl: null },
      }),
    },
    event: { upsert: async () => ({}) },
    job: { upsert: async () => ({}) },
  },
}));

type Handler = (req: never, res: never) => Promise<void>;

function mockReq(opts: {
  method?: string;
  headers?: Record<string, string>;
  url?: string;
  body?: string;
} = {}) {
  const req = new EventEmitter() as EventEmitter & Record<string, unknown>;
  req.method = opts.method ?? "GET";
  req.headers = opts.headers ?? {};
  req.socket = { remoteAddress: "127.0.0.1" };
  (req as { url?: string }).url = opts.url;
  process.nextTick(() => {
    if (opts.body !== undefined) req.emit("data", Buffer.from(opts.body));
    req.emit("end");
  });
  return req as unknown as never;
}

function mockRes() {
  let resolve!: (v: { status: number; body: unknown; headers: Record<string, unknown> }) => void;
  const done = new Promise<{ status: number; body: unknown; headers: Record<string, unknown> }>(
    (r) => (resolve = r),
  );
  const res = {
    statusCode: 200,
    headers: {} as Record<string, unknown>,
    setHeader(k: string, v: unknown) {
      res.headers[k] = v;
    },
    end(payload?: string) {
      let body: unknown = null;
      try {
        body = payload ? JSON.parse(payload) : null;
      } catch {
        body = payload;
      }
      resolve({ status: res.statusCode, body, headers: res.headers });
    },
  };
  return { res: res as unknown as never, done };
}

const SECRET = "test-session-secret";
const APP_SECRET = "test-app-webhook-secret";

describe("api/me", () => {
  it("rejects non-GET with 405", async () => {
    const { res, done } = mockRes();
    await (meHandler as Handler)(mockReq({ method: "POST" }), res);
    expect((await done).status).toBe(405);
  });

  it("returns 401 when logged out", async () => {
    const { res, done } = mockRes();
    await (meHandler as Handler)(mockReq(), res);
    expect(await done).toMatchObject({ status: 401, body: { ok: false } });
  });

  it("returns the login and owned repos for a valid session", async () => {
    const saved = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = SECRET;
    try {
      const token = sessionCookieValue("b".repeat(64), SECRET);
      const { res, done } = mockRes();
      await (meHandler as Handler)(
        mockReq({ headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` } }),
        res,
      );
      expect(await done).toMatchObject({
        status: 200,
        body: { ok: true, data: { login: "octocat", repos: ["AhadIKK/CommitIt"] } },
      });
    } finally {
      if (saved !== undefined) process.env.SESSION_SECRET = saved;
      else delete process.env.SESSION_SECRET;
    }
  });
});

describe("api/meta", () => {
  it("degrades when the App is not configured", async () => {
    const saved = { ...process.env };
    delete process.env.GITHUB_APP_SLUG;
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_APP_ID;
    try {
      const { res, done } = mockRes();
      await (metaHandler as Handler)(mockReq(), res);
      expect(await done).toMatchObject({
        status: 200,
        body: {
          ok: true,
          data: { installUrl: null, authEnabled: false, appConfigured: false },
        },
      });
    } finally {
      process.env = saved;
    }
  });
});

describe("api/repo", () => {
  it("reports install state", async () => {
    const { res, done } = mockRes();
    await (repoHandler as Handler)(mockReq({ url: "/api/repo?repo=AhadIKK%2FCommitIt" }), res);
    expect(await done).toMatchObject({
      status: 200,
      body: { ok: true, data: { fullName: "AhadIKK/CommitIt", installed: true } },
    });
  });

  it("requires the repo param", async () => {
    const { res, done } = mockRes();
    await (repoHandler as Handler)(mockReq({ url: "/api/repo" }), res);
    expect((await done).status).toBe(400);
  });
});

describe("api/auth/github", () => {
  it("redirects with state when configured", async () => {
    const saved = process.env.GITHUB_CLIENT_ID;
    process.env.GITHUB_CLIENT_ID = "client-123";
    try {
      const { res, done } = mockRes();
      await (authHandler as Handler)(mockReq({ url: "/api/auth/github" }), res);
      const out = await done;
      expect(out.status).toBe(302);
      const headers = out.headers as Record<string, unknown>;
      expect(String(headers["Location"])).toContain("github.com/login/oauth/authorize");
      expect(String(headers["Location"])).toContain("client_id=client-123");
      expect(String(headers["Set-Cookie"])).toContain("commitit_oauth_state=");
    } finally {
      if (saved !== undefined) process.env.GITHUB_CLIENT_ID = saved;
      else delete process.env.GITHUB_CLIENT_ID;
    }
  });

  it("503s when OAuth is not configured", async () => {
    const saved = process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_ID;
    try {
      const { res, done } = mockRes();
      await (authHandler as Handler)(mockReq({ url: "/api/auth/github" }), res);
      expect((await done).status).toBe(503);
    } finally {
      if (saved !== undefined) process.env.GITHUB_CLIENT_ID = saved;
    }
  });
});

describe("api/auth/callback", () => {
  it("rejects state mismatch without network", async () => {
    const { res, done } = mockRes();
    await (authHandler as Handler)(
      mockReq({
        url: "/api/auth/callback?code=abc&state=wrong",
        headers: { cookie: "commitit_oauth_state=right" },
      }),
      res,
    );
    expect(await done).toMatchObject({ status: 400, body: { ok: false } });
  });
});

describe("api/auth/logout", () => {
  it("clears the session cookie on POST", async () => {
    const { res, done } = mockRes();
    await (authHandler as Handler)(
      mockReq({ method: "POST", url: "/api/auth/logout" }),
      res,
    );
    const out = await done;
    expect(out.status).toBe(200);
    expect(String((out.headers as Record<string, unknown>)["Set-Cookie"])).toContain(
      "commitit_session=;",
    );
  });
});

describe("api/github-app", () => {
  it("rejects bad signatures with 401", async () => {
    const saved = process.env.GITHUB_APP_WEBHOOK_SECRET;
    process.env.GITHUB_APP_WEBHOOK_SECRET = APP_SECRET;
    try {
      const { res, done } = mockRes();
      await (appWebhookHandler as Handler)(
        mockReq({
          method: "POST",
          headers: {
            "x-github-delivery": "d1",
            "x-github-event": "push",
            "x-hub-signature-256": "sha256=deadbeef",
          },
          body: "{}",
        }),
        res,
      );
      expect((await done).status).toBe(401);
    } finally {
      if (saved !== undefined) process.env.GITHUB_APP_WEBHOOK_SECRET = saved;
      else delete process.env.GITHUB_APP_WEBHOOK_SECRET;
    }
  });

  it("applies installation events and ignores unknown ones", async () => {
    const saved = process.env.GITHUB_APP_WEBHOOK_SECRET;
    delete process.env.GITHUB_APP_WEBHOOK_SECRET; // dev-skip path, no network needed
    try {
      const raw = JSON.stringify(installationFixture);
      const { res, done } = mockRes();
      await (appWebhookHandler as Handler)(
        mockReq({
          method: "POST",
          headers: { "x-github-delivery": "d2", "x-github-event": "installation" },
          body: raw,
        }),
        res,
      );
      expect(await done).toMatchObject({ status: 200, body: { ok: true } });

      const second = mockRes();
      await (appWebhookHandler as Handler)(
        mockReq({
          method: "POST",
          headers: { "x-github-delivery": "d3", "x-github-event": "ping" },
          body: "{}",
        }),
        second.res,
      );
      expect(await second.done).toMatchObject({ status: 200, body: { ok: true, ignored: true } });
    } finally {
      if (saved !== undefined) process.env.GITHUB_APP_WEBHOOK_SECRET = saved;
    }
  });

  it("enqueues push events with a valid signature", async () => {
    const saved = process.env.GITHUB_APP_WEBHOOK_SECRET;
    process.env.GITHUB_APP_WEBHOOK_SECRET = APP_SECRET;
    try {
      const raw = JSON.stringify({ ref: "refs/heads/main" });
      const { res, done } = mockRes();
      await (appWebhookHandler as Handler)(
        mockReq({
          method: "POST",
          headers: {
            "x-github-delivery": "d4",
            "x-github-event": "push",
            "x-hub-signature-256": signPayload(raw, APP_SECRET),
          },
          body: raw,
        }),
        res,
      );
      expect(await done).toMatchObject({ status: 200, body: { ok: true } });
    } finally {
      if (saved !== undefined) process.env.GITHUB_APP_WEBHOOK_SECRET = saved;
      else delete process.env.GITHUB_APP_WEBHOOK_SECRET;
    }
  });

  it("routes milestone events into the pipeline", async () => {
    const saved = process.env.GITHUB_APP_WEBHOOK_SECRET;
    delete process.env.GITHUB_APP_WEBHOOK_SECRET; // dev-skip path
    try {
      const raw = JSON.stringify({
        action: "closed",
        milestone: { number: 3, title: "Auth" },
        repository: { full_name: "o/r" },
      });
      const { res, done } = mockRes();
      await (appWebhookHandler as Handler)(
        mockReq({
          method: "POST",
          headers: { "x-github-delivery": "d5", "x-github-event": "milestone" },
          body: raw,
        }),
        res,
      );
      expect(await done).toMatchObject({ status: 200, body: { ok: true } });
    } finally {
      if (saved !== undefined) process.env.GITHUB_APP_WEBHOOK_SECRET = saved;
    }
  });
});
