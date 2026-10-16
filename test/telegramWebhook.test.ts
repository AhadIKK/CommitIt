import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import telegramHandler from "../api/telegram.js";
import { startBotPolling } from "../src/telegramBot.js";

vi.mock("../src/db.js", () => ({ prisma: {} }));

type Handler = (req: never, res: never) => Promise<void>;

function mockReq(body: string, headers: Record<string, string> = {}) {
  const req = new EventEmitter() as EventEmitter & Record<string, unknown>;
  req.method = "POST";
  req.headers = headers;
  req.socket = { remoteAddress: "127.0.0.1" };
  process.nextTick(() => {
    req.emit("data", Buffer.from(body));
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

const SECRET = "test-webhook-secret";
const update = (text: string) =>
  JSON.stringify({ update_id: 7, message: { chat: { id: 99, type: "private" }, from: { id: 42 }, text } });

afterEach(() => {
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_USE_WEBHOOK;
});

describe("api/telegram webhook", () => {
  it("503s when no secret is configured (never accept forgeries)", async () => {
    const { res, done } = mockRes();
    await (telegramHandler as Handler)(mockReq(update("/start"), {}), res);
    expect(await done).toEqual({ status: 503, body: { ok: false, error: "webhook_not_configured" } });
  });

  it("401s on a wrong secret", async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
    const { res, done } = mockRes();
    await (telegramHandler as Handler)(
      mockReq(update("/start"), { "x-telegram-bot-api-secret-token": "nope" }),
      res,
    );
    expect(await done).toEqual({ status: 401, body: { ok: false, error: "bad_secret" } });
  });

  it("dispatches /start and always 200s", async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
    const { res, done } = mockRes();
    await (telegramHandler as Handler)(
      mockReq(update("/start"), { "x-telegram-bot-api-secret-token": SECRET }),
      res,
    );
    expect(await done).toEqual({ status: 200, body: { ok: true } });
  });

  it("200s poison updates instead of retry-storming", async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
    const { res, done } = mockRes();
    await (telegramHandler as Handler)(
      mockReq("{{not json", { "x-telegram-bot-api-secret-token": SECRET }),
      res,
    );
    expect(await done).toEqual({ status: 200, body: { ok: true } });
  });
});

describe("startBotPolling gate", () => {
  const log = { info: () => {}, error: () => {} };

  it("idles when webhook mode is on", () => {
    process.env.TELEGRAM_BOT_TOKEN = "tok";
    process.env.TELEGRAM_USE_WEBHOOK = "1";
    expect(startBotPolling(log)).toBeNull();
  });

  it("polls otherwise", () => {
    process.env.TELEGRAM_BOT_TOKEN = "tok";
    const timer = startBotPolling(log, 60_000);
    expect(timer).not.toBeNull();
    if (timer) clearInterval(timer);
  });
});
