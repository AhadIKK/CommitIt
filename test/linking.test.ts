import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { registerLinkingRoutes } from "../src/linking.js";
import { clearRateLimit } from "../src/rateLimit.js";

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(registerLinkingRoutes);
  return app;
}

afterEach(() => {
  clearRateLimit();
  delete process.env.TELEGRAM_BOT_NAME;
});

describe("link-token", () => {
  it("rejects a bad repo without touching the DB", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/link-token",
      payload: { repo: "not-a-repo" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: "invalid_repo" });
    await app.close();
  });

  it("reports bot_not_configured without a bot name", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/link-token",
      payload: { repo: "AhadIKK/CommitIt" },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ok: false, error: "bot_not_configured" });
    await app.close();
  });
});

describe("link-token status", () => {
  it("404s a malformed code without touching the DB", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/link-token/zzz" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ ok: false, error: "not_found" });
    await app.close();
  });
});

describe("link-code", () => {
  it("rejects malformed input without touching the DB", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/link-code",
      payload: { code: "!!", repo: "AhadIKK/CommitIt" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: "invalid_input" });
    await app.close();
  });

  it("degrades to unavailable when the DB is unreachable", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/link-code",
      payload: { code: "ABCDEF", repo: "AhadIKK/CommitIt" },
    });
    expect([404, 503]).toContain(res.statusCode);
    await app.close();
  }, 30_000);
});
