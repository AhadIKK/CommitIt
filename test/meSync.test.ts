import { EventEmitter } from "node:events";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import dataHandler from "../api/data/[view].js";
import { registerAuthRoutes } from "../src/auth.js";
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
      findUnique: async () => ({ id: "u1", githubLogin: "octocat" }),
    },
  },
}));

type Handler = (req: never, res: never) => Promise<void>;

function mockReq(opts: { method?: string; url?: string; body?: string } = {}) {
  const req = new EventEmitter() as EventEmitter & Record<string, unknown>;
  req.method = opts.method ?? "GET";
  req.headers = {};
  req.socket = { remoteAddress: "127.0.0.1" };
  (req as { url?: string }).url = opts.url ?? "/api/me";
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
  delete process.env.GITHUB_APP_ID;
});

describe("api/me sync op", () => {
  it("requires login", async () => {
    loggedIn = false;
    const { res, done } = mockRes();
    await (dataHandler as Handler)(mockReq({ method: "POST", url: "/api/me?op=sync" }), res);
    expect(await done).toEqual({ status: 401, body: { ok: false, error: "logged_out" } });
  });

  it("reports app_not_configured without app keys (not silent zero)", async () => {
    const { res, done } = mockRes();
    await (dataHandler as Handler)(mockReq({ method: "POST", url: "/api/me?op=sync" }), res);
    expect(await done).toEqual({
      status: 200,
      body: { ok: true, data: { synced: 0, status: "app_not_configured" } },
    });
  });

  it("404s unknown ops and keeps GET working", async () => {
    const bad = mockRes();
    await (dataHandler as Handler)(mockReq({ method: "POST", url: "/api/me?op=nope" }), bad.res);
    expect((await bad.done).status).toBe(404);
  });
});

describe("fastify POST /api/me", () => {
  it("requires login without touching the DB", async () => {
    loggedIn = false;
    const app = Fastify({ logger: false });
    await app.register(registerAuthRoutes);
    const res = await app.inject({ method: "POST", url: "/api/me?op=sync" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ ok: false, error: "logged_out" });
    await app.close();
  });
});
