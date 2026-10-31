import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { processJob } from "../src/worker.js";

const { enqueued } = vi.hoisted(() => ({ enqueued: [] as unknown[] }));

vi.mock("../src/db.js", () => ({
  prisma: {
    installation: { upsert: async () => ({}) },
    repo: {
      upsert: async () => ({ id: "r1", syncEtag: null as string | null }),
      findUnique: async () => ({ id: "r1" }),
      update: async () => ({}),
    },
    author: { upsert: async () => ({ id: "a1" }) },
    pullRequest: { upsert: async () => ({}) },
    commit: {
      findMany: async () => [],
      upsert: async () => ({}),
      update: async () => ({}),
    },
    userInstallation: { upsert: async () => ({}) },
    milestone: { upsert: async () => ({ id: "m1" }) },
    issue: { upsert: async () => ({}) },
    job: {
      update: async () => ({}),
      upsert: async (args: unknown) => {
        enqueued.push(args);
        return {};
      },
    },
  },
}));

function json(res: unknown, status = 200) {
  return new Response(JSON.stringify(res), { status });
}

describe("worker backfill job", () => {
  beforeEach(() => {
    enqueued.length = 0;
  });

  it("logs backfill_done with totals and completes the job", async () => {
    const saved = { ...process.env };
    const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    process.env.GITHUB_APP_ID = "42";
    process.env.GITHUB_APP_PRIVATE_KEY_BASE64 = Buffer.from(
      privateKey.export({ type: "pkcs8", format: "pem" }) as string,
    ).toString("base64");
    const savedFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      const target = url.toString();
      if (target.endsWith("/access_tokens")) {
        return json({ token: "tok", expires_at: new Date(Date.now() + 3600_000).toISOString() });
      }
      if (target.includes("/installation/repositories") || target.includes("/repositories?")) {
        return target.includes("page=1") || !target.includes("page=")
          ? json({ repositories: [{ full_name: "o/r" }] })
          : json({ repositories: [] });
      }
      if (target.endsWith("/repos/o/r")) return json({ default_branch: "main" });
      if (target.includes("/issues?") || target.includes("/pulls?")) return json([]);
      if (target.includes("/commits?")) return json([]);
      throw new Error(`unexpected ${target}`);
    }) as typeof fetch;
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: unknown) => {
      logs.push(String(msg));
    };
    try {
      await processJob({
        id: "j1",
        deliveryId: "d1",
        type: "backfill",
        payload: { installationId: "77" },
        status: "queued",
        attempts: 0,
        nextRetryAt: null,
      });
      const done = logs.map((l) => JSON.parse(l)).find((o) => o.msg === "backfill_done");
      expect(done).toMatchObject({ jobId: "j1", installationId: "77" });
      expect(done.totals).toMatchObject({ repos: 1 });
      // Nothing left to do: no continuation job is queued.
      expect(enqueued).toEqual([]);
    } finally {
      console.log = origLog;
      process.env = saved;
      globalThis.fetch = savedFetch;
    }
  });

  it("queues the rest of a big install as a continuation instead of dying mid-way", async () => {
    const saved = { ...process.env };
    const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    process.env.GITHUB_APP_ID = "42";
    process.env.GITHUB_APP_PRIVATE_KEY_BASE64 = Buffer.from(
      privateKey.export({ type: "pkcs8", format: "pem" }) as string,
    ).toString("base64");
    const savedFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      const target = url.toString();
      if (target.endsWith("/access_tokens")) {
        return json({ token: "tok", expires_at: new Date(Date.now() + 3600_000).toISOString() });
      }
      if (target.includes("/repositories?")) {
        return target.includes("page=1") || !target.includes("page=")
          ? json({ repositories: [{ full_name: "o/one" }, { full_name: "o/two" }] })
          : json({ repositories: [] });
      }
      if (target.endsWith("/repos/o/one") || target.endsWith("/repos/o/two")) {
        return json({ default_branch: "main" });
      }
      if (target.includes("/issues?") || target.includes("/pulls?")) return json([]);
      if (target.includes("/commits?")) return json([]);
      throw new Error(`unexpected ${target}`);
    }) as typeof fetch;
    const origLog = console.log;
    console.log = () => {};
    try {
      // Deadline already gone: the pass covers the first repo, then hands the
      // remaining index to a fresh job so the next tick continues there.
      await processJob(
        {
          id: "j1",
          deliveryId: "sync-77-auto-1",
          type: "backfill",
          payload: { installationId: "77" },
          status: "queued",
          attempts: 1,
          nextRetryAt: null,
        },
        { deadline: 0 },
      );
      expect(enqueued).toHaveLength(1);
      const call = enqueued[0] as {
        where: { deliveryId: string };
        update: object;
        create: { type: string; deliveryId: string; payload: object };
      };
      expect(call.create.type).toBe("backfill");
      // The `sync-77-` prefix is what cancelQueuedBackfills() cancels on uninstall.
      expect(call.create.deliveryId).toBe("sync-77-auto-1:r1");
      expect(call.create.payload).toEqual({ installationId: "77", resumeAt: 1 });
    } finally {
      console.log = origLog;
      process.env = saved;
      globalThis.fetch = savedFetch;
    }
  });
});
