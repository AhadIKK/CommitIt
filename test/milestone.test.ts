import Fastify from "fastify";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { clearRateLimit } from "../src/rateLimit.js";
import { MilestoneSchema, clearSeenDeliveries, webhookRoutes } from "../src/webhook.js";
import closedFixture from "./fixtures/milestone_closed.json";

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

describe("milestone webhook validation", () => {
  it("accepts the closed fixture shape", () => {
    expect(MilestoneSchema.safeParse(closedFixture).success).toBe(true);
  });

  it("rejects malformed payloads before the DB", () => {
    expect(MilestoneSchema.safeParse({ action: "closed" }).success).toBe(true); // all-optional
    expect(MilestoneSchema.safeParse({ milestone: { title: "x" } }).success).toBe(false);
    expect(MilestoneSchema.safeParse(null).success).toBe(false);
  });

  it("routes milestone events into the pipeline", async () => {
    const app = await buildApp();
    const body = readFileSync("test/fixtures/milestone_closed.json", "utf8");
    const res = await app.inject({
      method: "POST",
      url: "/webhook",
      headers: {
        "content-type": "application/json",
        "x-github-delivery": "mile-1",
        "x-github-event": "milestone",
      },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
    // NOTE: without a reachable DB the inject waits out the Prisma
    // connection timeout before hitting the memory fallback.
  }, 90_000);
});
