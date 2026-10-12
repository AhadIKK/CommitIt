import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import linkHandler from "../api/link.js";
import { hashToken } from "../src/session.js";

vi.mock("../src/db.js", () => ({
  prisma: {
    linkToken: {
      create: async (args: { data: { tokenHash: string } }) => ({ tokenHash: args.data.tokenHash }),
      findUnique: async (args: { where: { tokenHash: string } }) => {
        if (args.where.tokenHash === hashToken("b".repeat(64))) {
          return {
            tokenHash: args.where.tokenHash,
            purpose: "telegram_link",
            usedAt: new Date(),
          };
        }
        return null;
      },
    },
    telegramLink: { findUnique: async () => null },
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

describe("api/link", () => {
  it("issues deep-link tokens when the bot is configured", async () => {
    const saved = process.env.TELEGRAM_BOT_NAME;
    process.env.TELEGRAM_BOT_NAME = "TestBot";
    try {
      const { res, done } = mockRes();
      await (linkHandler as Handler)(
        mockReq({
          method: "POST",
          url: "/api/link?op=issue",
          body: JSON.stringify({ repo: "o/r" }),
        }),
        res,
      );
      const out = await done;
      expect(out.status).toBe(200);
      const data = (out.body as { ok: boolean; data: { code: string; url: string } }).data;
      expect(data.code).toMatch(/^[0-9a-f]{64}$/);
      expect(data.url).toContain("t.me/TestBot?start=");
    } finally {
      if (saved !== undefined) process.env.TELEGRAM_BOT_NAME = saved;
      else delete process.env.TELEGRAM_BOT_NAME;
    }
  });

  it("rejects bad repos and missing bot config", async () => {
    const bad = mockRes();
    await (linkHandler as Handler)(
      mockReq({ method: "POST", url: "/api/link?op=issue", body: JSON.stringify({ repo: "x" }) }),
      bad.res,
    );
    expect((await bad.done).status).toBe(400);

    const saved = process.env.TELEGRAM_BOT_NAME;
    delete process.env.TELEGRAM_BOT_NAME;
    try {
      const nocfg = mockRes();
      await (linkHandler as Handler)(
        mockReq({
          method: "POST",
          url: "/api/link?op=issue",
          body: JSON.stringify({ repo: "o/r" }),
        }),
        nocfg.res,
      );
      expect((await nocfg.done).status).toBe(503);
    } finally {
      if (saved !== undefined) process.env.TELEGRAM_BOT_NAME = saved;
    }
  });

  it("polls claim state and 404s unknown ops", async () => {
    const claimed = mockRes();
    await (linkHandler as Handler)(
      mockReq({ url: `/api/link?op=poll&code=${"b".repeat(64)}` }),
      claimed.res,
    );
    expect(await claimed.done).toEqual({ status: 200, body: { ok: true, data: { claimed: true } } });

    const bad = mockRes();
    await (linkHandler as Handler)(mockReq({ url: "/api/link?op=poll&code=zzz" }), bad.res);
    expect((await bad.done).status).toBe(404);

    const unknown = mockRes();
    await (linkHandler as Handler)(mockReq({ url: "/api/link?op=nope" }), unknown.res);
    expect((await unknown.done).status).toBe(404);
  });

  it("validates claim input", async () => {
    const { res, done } = mockRes();
    await (linkHandler as Handler)(
      mockReq({ method: "POST", url: "/api/link?op=claim", body: JSON.stringify({ code: "!!" }) }),
      res,
    );
    expect((await done).status).toBe(400);
  });
});
