import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleTelegramWebhook, type VercelRequest } from "../src/telegramWebhook.js";

// dispatchUpdate is mocked out: this suite is about the HTTP gate and body
// parsing, not command handling (telegramButtons.test.ts covers dispatch).
const mocks = vi.hoisted(() => ({ dispatchUpdate: vi.fn(async () => {}) }));
vi.mock("../src/telegramBot.js", () => ({ dispatchUpdate: mocks.dispatchUpdate }));

const SECRET = "s3cret-token";

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      res.headers[name] = value;
    },
    end(payload?: string) {
      resolve({ status: res.statusCode, body: payload ? JSON.parse(payload) : undefined });
    },
  };
  let resolve!: (v: { status: number; body: unknown }) => void;
  const done = new Promise<{ status: number; body: unknown }>((r) => (resolve = r));
  return { res: res as unknown as ServerResponse, done };
}

/** Vercel Node runtime: JSON body already parsed and the stream drained. */
function parsedReq(body: unknown, headers: Record<string, string> = {}, method = "POST") {
  return { method, headers, body } as unknown as VercelRequest;
}

/** Bare node request: nothing parsed, body arrives as a stream. */
function streamReq(raw: string, headers: Record<string, string> = {}, method = "POST") {
  const req = new EventEmitter() as EventEmitter & Record<string, unknown>;
  req.method = method;
  req.headers = headers;
  process.nextTick(() => {
    req.emit("data", Buffer.from(raw));
    req.emit("end");
  });
  return req as unknown as VercelRequest;
}

const message = (text: string) =>
  JSON.stringify({
    update_id: 7,
    message: { chat: { id: 99, type: "private" }, from: { id: 42 }, text },
  });

const authed = { "x-telegram-bot-api-secret-token": SECRET };

beforeEach(() => {
  mocks.dispatchUpdate.mockClear();
});

afterEach(() => {
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
});

describe("telegram webhook gate", () => {
  it("405s non-POST methods", async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
    const { res, done } = mockRes();
    await handleTelegramWebhook(parsedReq(undefined, authed, "GET"), res);
    expect(await done).toEqual({ status: 405, body: { ok: false, error: "method_not_allowed" } });
  });

  it("503s when no secret is configured (never accept forgeries)", async () => {
    const { res, done } = mockRes();
    await handleTelegramWebhook(parsedReq({}, {}), res);
    expect(await done).toEqual({
      status: 503,
      body: { ok: false, error: "webhook_not_configured" },
    });
    expect(mocks.dispatchUpdate).not.toHaveBeenCalled();
  });

  it("401s on a wrong secret", async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
    const { res, done } = mockRes();
    await handleTelegramWebhook(
      parsedReq({}, { "x-telegram-bot-api-secret-token": "nope" }),
      res,
    );
    expect(await done).toEqual({ status: 401, body: { ok: false, error: "bad_secret" } });
    expect(mocks.dispatchUpdate).not.toHaveBeenCalled();
  });

  it("401s when the header is absent entirely", async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
    const { res, done } = mockRes();
    await handleTelegramWebhook(parsedReq({}, {}), res);
    expect((await done).status).toBe(401);
  });
});

describe("telegram webhook dispatch", () => {
  beforeEach(() => {
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
  });

  // Regression: Vercel drains the request stream to parse JSON. Reading it
  // again yields {} — which silently dropped every update in the first
  // webhook attempt. The pre-parsed body must win.
  it("dispatches from the pre-parsed body Vercel provides", async () => {
    const { res, done } = mockRes();
    await handleTelegramWebhook(parsedReq(JSON.parse(message("/start abc")), authed), res);
    expect(await done).toEqual({ status: 200, body: { ok: true } });
    expect(mocks.dispatchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({ text: "/start abc" }),
      }),
    );
  });

  it("falls back to the raw stream when no parsed body exists", async () => {
    const { res, done } = mockRes();
    await handleTelegramWebhook(streamReq(message("/repos"), authed), res);
    expect(await done).toEqual({ status: 200, body: { ok: true } });
    expect(mocks.dispatchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.objectContaining({ text: "/repos" }) }),
    );
  });

  it("accepts a stringified body", async () => {
    const { res, done } = mockRes();
    await handleTelegramWebhook(parsedReq(message("/link"), authed), res);
    expect(await done).toEqual({ status: 200, body: { ok: true } });
    expect(mocks.dispatchUpdate).toHaveBeenCalledTimes(1);
  });

  it("dispatches a button tap (callback_query) too", async () => {
    const { res, done } = mockRes();
    await handleTelegramWebhook(
      parsedReq(
        {
          update_id: 9,
          callback_query: {
            id: "cb-1",
            data: "sub:o/r",
            from: { id: 42 },
            message: { message_id: 5, chat: { id: 99, type: "private" } },
          },
        },
        authed,
      ),
      res,
    );
    expect(await done).toEqual({ status: 200, body: { ok: true } });
    expect(mocks.dispatchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        callback_query: expect.objectContaining({ data: "sub:o/r" }),
      }),
    );
  });

  it("200s poison updates instead of retry-storming", async () => {
    const { res, done } = mockRes();
    await handleTelegramWebhook(streamReq("{{not json", authed), res);
    expect(await done).toEqual({ status: 200, body: { ok: true } });
    expect(mocks.dispatchUpdate).not.toHaveBeenCalled();
  });

  it("200s non-message updates without dispatching", async () => {
    const { res, done } = mockRes();
    await handleTelegramWebhook(
      parsedReq({ update_id: 8, edited_message: { chat: { id: 5 } } }, authed),
      res,
    );
    expect(await done).toEqual({ status: 200, body: { ok: true } });
    expect(mocks.dispatchUpdate).not.toHaveBeenCalled();
  });

  it("200s even when the command handler throws", async () => {
    mocks.dispatchUpdate.mockRejectedValueOnce(new Error("db down"));
    const { res, done } = mockRes();
    await handleTelegramWebhook(parsedReq(JSON.parse(message("/start")), authed), res);
    expect(await done).toEqual({ status: 200, body: { ok: true } });
  });
});
