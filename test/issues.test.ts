import Fastify from "fastify";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { clearSeenDeliveries, webhookRoutes } from "../src/webhook.js";
import { clearRateLimit } from "../src/rateLimit.js";

async function buildApp() {
  const app = Fastify({ logger: false });
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (req, body, done) => {
      try {
        (req as unknown as { rawBody: string }).rawBody =
          typeof body === "string" ? body : "";
        done(null, body ? JSON.parse(body as string) : {});
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );
  await app.register(webhookRoutes);
  return app;
}

afterEach(() => {
  clearSeenDeliveries();
  clearRateLimit();
  delete process.env.GITHUB_WEBHOOK_SECRET;
});

describe("issues event", () => {
  it("accepts a reopened-issue payload for sync", async () => {
    const app = await buildApp();
    const body = readFileSync("test/fixtures/issues.json", "utf8");
    const res = await app.inject({
      method: "POST",
      url: "/webhook",
      headers: {
        "content-type": "application/json",
        "x-github-delivery": "issues-1",
        "x-github-event": "issues",
      },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  }, 30_000);

  it("rejects a malformed issues payload", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/webhook",
      headers: {
        "content-type": "application/json",
        "x-github-delivery": "issues-2",
        "x-github-event": "issues",
      },
      payload: JSON.stringify({ issue: { number: "not-a-number" } }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: "invalid_payload" });
    await app.close();
  });
});
