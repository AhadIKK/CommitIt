import { EventEmitter } from "node:events";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import linkHandler from "../api/link.js";
import { unlinkByProof } from "../src/linkTokens.js";
import { registerLinkingRoutes } from "../src/linking.js";
import { clearRateLimit } from "../src/rateLimit.js";
import { hashToken } from "../src/session.js";

let dbDown = false;
let subExists = true;

vi.mock("../src/db.js", () => ({
  prisma: {
    linkToken: {
      findUnique: async (args: { where: { tokenHash: string } }) => {
        if (dbDown) throw new Error("db down");
        if (args.where.tokenHash === hashToken("c".repeat(64))) {
          return {
            tokenHash: args.where.tokenHash,
            purpose: "telegram_link",
            chatId: "chat-tg-1",
            usedAt: new Date(),
          };
        }
        if (args.where.tokenHash === hashToken("d".repeat(64))) {
          return {
            tokenHash: args.where.tokenHash,
            purpose: "telegram_link",
            chatId: null,
            usedAt: null,
          };
        }
        return null;
      },
    },
    telegramLink: {
      findUnique: async (args: { where: { code?: string } }) => {
        if (dbDown) throw new Error("db down");
        if (args.where.code === "ABCDEF") {
          return { chatId: "chat-tg-2", usedAt: new Date() };
        }
        return null;
      },
    },
    chat: {
      findUnique: async () => {
        if (dbDown) throw new Error("db down");
        return { id: "chat-db-1" };
      },
    },
    repo: {
      findUnique: async (args: { where: { fullName?: string } }) => {
        if (dbDown) throw new Error("db down");
        return args.where.fullName === "o/r" ? { id: "repo-1" } : null;
      },
    },
    subscription: {
      findUnique: async () => {
        if (dbDown) throw new Error("db down");
        return subExists ? { id: "sub-1" } : null;
      },
      deleteMany: async () => {
        if (dbDown) throw new Error("db down");
        return { count: 1 };
      },
    },
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

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(registerLinkingRoutes);
  return app;
}

afterEach(() => {
  clearRateLimit();
  dbDown = false;
  subExists = true;
});

describe("unlinkByProof", () => {
  it("deletes via claimed deep-link token", async () => {
    expect(await unlinkByProof("c".repeat(64), "o/r")).toEqual({ deleted: 1 });
  });

  it("deletes via legacy claimed code", async () => {
    expect(await unlinkByProof("abcdef", "o/r")).toEqual({ deleted: 1 });
  });

  it("rejects unknown, unclaimed, and missing rows", async () => {
    expect(await unlinkByProof("e".repeat(64), "o/r")).toEqual({ error: "invalid" });
    expect(await unlinkByProof("d".repeat(64), "o/r")).toEqual({ error: "invalid" });
    expect(await unlinkByProof("c".repeat(64), "o/missing")).toEqual({ error: "invalid" });
  });

  it("degrades on DB failure", async () => {
    dbDown = true;
    expect(await unlinkByProof("c".repeat(64), "o/r")).toEqual({ error: "unavailable" });
  });
});

describe("fastify unlink-sub + link-status", () => {
  it("rejects malformed input without touching the DB", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/link?op=unlink-sub",
      payload: { repo: "o/r", proof: "!!" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: "invalid_input" });
    const st = await app.inject({
      method: "GET",
      url: "/api/link?op=link-status&repo=o/r&code=",
    });
    expect(st.statusCode).toBe(400);
    await app.close();
  });

  it("unlinks and reports link status", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/link?op=unlink-sub",
      payload: { repo: "o/r", proof: "c".repeat(64) },
    });
    expect(res.json()).toEqual({ ok: true, data: { deleted: 1 } });
    const st = await app.inject({
      method: "GET",
      url: `/api/link?op=link-status&repo=o/r&code=${"c".repeat(64)}`,
    });
    expect(st.json()).toEqual({ ok: true, data: { linked: true } });
    subExists = false;
    const st2 = await app.inject({
      method: "GET",
      url: `/api/link?op=link-status&repo=o/r&code=${"c".repeat(64)}`,
    });
    expect(st2.json()).toEqual({ ok: true, data: { linked: false } });
    await app.close();
  });

  it("404s unknown proofs", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/link?op=unlink-sub",
      payload: { repo: "o/r", proof: "e".repeat(64) },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ ok: false, error: "invalid_or_expired" });
    await app.close();
  });
});

describe("api/link unlink-sub + link-status mirror", () => {
  it("mirrors happy paths and validation", async () => {
    const un = mockRes();
    await (linkHandler as Handler)(
      mockReq({
        method: "POST",
        url: "/api/link?op=unlink-sub",
        body: JSON.stringify({ repo: "o/r", proof: "c".repeat(64) }),
      }),
      un.res,
    );
    expect(await un.done).toEqual({ status: 200, body: { ok: true, data: { deleted: 1 } } });

    const st = mockRes();
    await (linkHandler as Handler)(
      mockReq({ url: `/api/link?op=link-status&repo=o/r&code=${"c".repeat(64)}` }),
      st.res,
    );
    expect(await st.done).toEqual({ status: 200, body: { ok: true, data: { linked: true } } });

    const bad = mockRes();
    await (linkHandler as Handler)(
      mockReq({
        method: "POST",
        url: "/api/link?op=unlink-sub",
        body: JSON.stringify({ repo: "o/r", proof: "" }),
      }),
      bad.res,
    );
    expect((await bad.done).status).toBe(400);
  });
});
