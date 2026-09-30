import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import webhookHandler from "../api/webhook.js";
import healthHandler from "../api/health.js";
import { signPayload } from "../src/verify.js";
import { clearRateLimit } from "../src/rateLimit.js";

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
