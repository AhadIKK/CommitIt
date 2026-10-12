import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import linkHandler from "../api/link.js";
import { isDigestMode, mySubscriptions, setMyDigestMode } from "../src/notifyPrefs.js";
import { clearRateLimit } from "../src/rateLimit.js";

let loggedIn = true;

vi.mock("../src/session.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/session.js")>();
  return {
    ...mod,
    getSessionUser: async () =>
      loggedIn ? { id: "u1", login: "octocat", avatarUrl: null } : null,
  };
});

vi.mock("../src/db.js", () => ({
  prisma: {
    user: {
      findUnique: async (args: { where: { id?: string } }) =>
        args.where.id === "u1" ? { telegramUserId: "tg-1" } : null,
    },
    chat: {
      findMany: async () => [{ id: "chat-1" }],
      findUnique: async () => ({ id: "chat-1" }),
    },
    repo: {
      findUnique: async (args: { where: { fullName?: string } }) =>
        args.where.fullName === "o/r"
          ? { id: "r1", installationId: 1n, installActive: true, ownerUserId: "u1" }
          : null,
    },
    subscription: {
      findMany: async () => [{ repo: { fullName: "o/r" }, digestMode: "daily", isMuted: false }],
      updateMany: async () => ({ count: 1 }),
    },
    userInstallation: { findUnique: async () => ({}) },
  },
}));

type Handler = (req: never, res: never) => Promise<void>;

function mockReq(opts: { method?: string; url?: string; body?: string } = {}) {
  const req = new EventEmitter() as EventEmitter & Record<string, unknown>;
  req.method = opts.method ?? "GET";
  req.headers = {};
  req.socket = { remoteAddress: "127.0.0.1" };
  (req as { url?: string }).url = opts.url ?? "/api/link";
  process.nextTick(() => {
    if (opts.body !== undefined) req.emit("data", Buffer.from(opts.body));
    req.emit("end");
  });
  return req as unknown as never;
}

function mockRes() {
  let resolve!: (v: { status: number; body: unknown }) => void;
  const done = new Promise<{ status: number; body: unknown }>((r) => (resolve = r));
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
  return { res: res as unknown as never, done };
}

afterEach(() => {
  clearRateLimit();
  loggedIn = true;
  delete process.env.TELEGRAM_BOT_NAME;
});

describe("isDigestMode", () => {
  it("accepts only the four modes", () => {
    expect(isDigestMode("instant")).toBe(true);
    expect(isDigestMode("weekly")).toBe(true);
    expect(isDigestMode("sometimes")).toBe(false);
    expect(isDigestMode(undefined)).toBe(false);
  });
});

describe("mySubscriptions", () => {
  it("lists DM subscriptions for the session user", async () => {
    expect(await mySubscriptions("u1")).toEqual([
      { repo: "o/r", digestMode: "daily", isMuted: false },
    ]);
  });
});

describe("setMyDigestMode", () => {
  it("updates an accessible repo", async () => {
    expect(await setMyDigestMode("u1", "o/r", "instant")).toEqual({ updated: 1 });
  });
  it("forbids repos the account cannot access", async () => {
    expect(await setMyDigestMode("u1", "o/foreign", "instant")).toEqual({ error: "forbidden" });
  });
});

describe("api/link subscription ops", () => {
  it("requires login", async () => {
    loggedIn = false;
    const { res, done } = mockRes();
    await (linkHandler as Handler)(mockReq({ url: "/api/link?op=my-subscriptions" }), res);
    expect(await done).toEqual({ status: 401, body: { ok: false, error: "logged_out" } });
  });

  it("lists my subscriptions when logged in", async () => {
    const { res, done } = mockRes();
    await (linkHandler as Handler)(mockReq({ url: "/api/link?op=my-subscriptions" }), res);
    expect(await done).toEqual({
      status: 200,
      body: { ok: true, data: [{ repo: "o/r", digestMode: "daily", isMuted: false }] },
    });
  });

  it("validates set-digest input before touching anything", async () => {
    const badMode = mockRes();
    await (linkHandler as Handler)(
      mockReq({
        method: "POST",
        url: "/api/link?op=set-digest",
        body: JSON.stringify({ repo: "o/r", mode: "sometimes" }),
      }),
      badMode.res,
    );
    expect((await badMode.done).status).toBe(400);

    const badRepo = mockRes();
    await (linkHandler as Handler)(
      mockReq({
        method: "POST",
        url: "/api/link?op=set-digest",
        body: JSON.stringify({ repo: "x", mode: "instant" }),
      }),
      badRepo.res,
    );
    expect((await badRepo.done).status).toBe(400);
  });

  it("sets digest mode when allowed", async () => {
    const { res, done } = mockRes();
    await (linkHandler as Handler)(
      mockReq({
        method: "POST",
        url: "/api/link?op=set-digest",
        body: JSON.stringify({ repo: "o/r", mode: "hourly" }),
      }),
      res,
    );
    expect(await done).toEqual({ status: 200, body: { ok: true, data: { updated: 1 } } });
  });

  it("forbids repos outside the account", async () => {
    const { res, done } = mockRes();
    await (linkHandler as Handler)(
      mockReq({
        method: "POST",
        url: "/api/link?op=set-digest",
        body: JSON.stringify({ repo: "o/foreign", mode: "instant" }),
      }),
      res,
    );
    expect((await done).status).toBe(403);
  });
});
