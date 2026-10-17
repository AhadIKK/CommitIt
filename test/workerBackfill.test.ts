import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { processJob } from "../src/worker.js";

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
    job: { update: async () => ({}) },
  },
}));

function json(res: unknown, status = 200) {
  return new Response(JSON.stringify(res), { status });
}

describe("worker backfill job", () => {
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
    } finally {
      console.log = origLog;
      process.env = saved;
      globalThis.fetch = savedFetch;
    }
  });
});
