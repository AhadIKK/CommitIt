import Fastify from "fastify";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { clearRateLimit } from "../src/rateLimit.js";
import { clearSeenDeliveries, webhookRoutes } from "../src/webhook.js";

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

describe("duplicate delivery", () => {
  it("second delivery of the same id is deduped, not re-enqueued", async () => {
    const app = await buildApp();
    const body = readFileSync("test/fixtures/push.json", "utf8");
    const headers = {
      "content-type": "application/json",
      "x-github-delivery": "dup-1",
      "x-github-event": "push",
    };
    const first = await app.inject({ method: "POST", url: "/webhook", headers, payload: body });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ ok: true });
    const second = await app.inject({ method: "POST", url: "/webhook", headers, payload: body });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ ok: true, deduped: true });
    await app.close();
    // NOTE: without a reachable DB each inject waits out the Prisma
    // connection timeout before hitting the memory fallback.
  }, 90_000);

  it("different delivery ids are both accepted", async () => {
    const app = await buildApp();
    const body = readFileSync("test/fixtures/push.json", "utf8");
    for (const id of ["dup-a", "dup-b"]) {
      const res = await app.inject({
        method: "POST",
        url: "/webhook",
        headers: {
          "content-type": "application/json",
          "x-github-delivery": id,
          "x-github-event": "push",
        },
        payload: body,
      });
      expect(res.json()).toEqual({ ok: true });
    }
    await app.close();
  }, 90_000);
});
