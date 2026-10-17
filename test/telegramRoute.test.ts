import type { ServerResponse } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The Telegram webhook must ride the EXISTING dynamic function, so Vercel
// Hobby still sees 12 functions. Proves the /api/telegram rewrite (and the
// /api/auth/telegram URL directly) reaches the same handler.
type FakeRes = {
  statusCode: number;
  setHeader: (k: string, v: string) => void;
  end: (b?: string) => void;
};

const mocks = vi.hoisted(() => ({
  webhook: vi.fn(async (_req: unknown, res: FakeRes) => {
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true }));
  }),
}));
vi.mock("../src/db.js", () => ({ prisma: {} }));
vi.mock("../src/telegramWebhook.js", () => ({
  handleTelegramWebhook: mocks.webhook,
}));

import handler from "../api/auth/[action].js";
import type { VercelRequest } from "../src/telegramWebhook.js";

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      res.headers[name] = String(value);
    },
    end(payload?: string) {
      resolve({ status: res.statusCode, body: payload ? JSON.parse(payload) : undefined });
    },
  };
  let resolve!: (v: { status: number; body: unknown }) => void;
  const done = new Promise<{ status: number; body: unknown }>((r) => (resolve = r));
  return { res: res as unknown as ServerResponse, done };
}

const req = (url: string) =>
  ({ method: "POST", url, headers: {} }) as unknown as VercelRequest;

beforeEach(() => {
  mocks.webhook.mockClear();
});

describe("api/auth/[action] telegram routing", () => {
  it("dispatches /api/telegram (rewrite target) to the webhook handler", async () => {
    const { res, done } = mockRes();
    await handler(req("/api/telegram"), res);
    expect(mocks.webhook).toHaveBeenCalledTimes(1);
    expect(await done).toEqual({ status: 200, body: { ok: true } });
  });

  it("dispatches /api/auth/telegram directly too", async () => {
    const { res, done } = mockRes();
    await handler(req("/api/auth/telegram"), res);
    expect(mocks.webhook).toHaveBeenCalledTimes(1);
    expect(await done).toEqual({ status: 200, body: { ok: true } });
  });

  it("works with a query string on the URL", async () => {
    const { res, done } = mockRes();
    await handler(req("/api/telegram?x=1"), res);
    expect(mocks.webhook).toHaveBeenCalledTimes(1);
    expect((await done).status).toBe(200);
  });

  it("still 404s unknown actions", async () => {
    const { res, done } = mockRes();
    await handler(req("/api/auth/nope"), res);
    expect(mocks.webhook).not.toHaveBeenCalled();
    expect(await done).toEqual({ status: 404, body: { ok: false, error: "not_found" } });
  });
});
