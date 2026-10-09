import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  RateLimitedError,
  backfillInstallation,
  backfillRepoIssues,
} from "../src/backfill.js";

const upserts: { op: string }[] = [];

vi.mock("../src/db.js", () => ({
  prisma: {
    repo: {
      upsert: async () => {
        upserts.push({ op: "repo.upsert" });
        return { id: "r1", syncEtag: null as string | null };
      },
      update: async () => {
        upserts.push({ op: "repo.update" });
        return {};
      },
      updateMany: async () => {
        upserts.push({ op: "repo.updateMany" });
        return { count: 1 };
      },
    },
    milestone: { upsert: async () => ({ id: "m1" }) },
    issue: { upsert: async () => ({}) },
  },
}));

function json(res: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(res), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

const ISSUE = {
  number: 7,
  title: "Seven",
  state: "open",
  labels: [{ name: "M" }],
  milestone: { number: 3, title: "Auth" },
};

describe("backfillRepoIssues", () => {
  it("pages issues, stores rows, saves the ETag", async () => {
    upserts.length = 0;
    const seen: string[] = [];
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      const target = url.toString();
      seen.push(target);
      if (target.includes("/issues?")) {
        if (target.includes("page=1")) {
          return json([ISSUE], 200, { etag: '"abc123"' });
        }
        return json([]);
      }
      throw new Error(`unexpected ${target}`);
    }) as typeof fetch;
    const out = await backfillRepoIssues("o/r", "tok", { fetchFn });
    expect(out).toMatchObject({ issues: 1, milestones: 1, skipped: false });
    expect(seen.some((u) => u.includes("page=1"))).toBe(true);
    expect(upserts.map((u) => u.op)).toContain("repo.update"); // etag saved
  });

  it("304 touches lastSyncAt and skips storing", async () => {
    upserts.length = 0;
    const fetchFn = (async () => new Response(null, { status: 304 })) as typeof fetch;
    const out = await backfillRepoIssues("o/r", "tok", { fetchFn });
    expect(out).toMatchObject({ skipped: true, issues: 0 });
  });

  it("429 throws RateLimitedError for worker backoff", async () => {
    const fetchFn = (async () =>
      new Response("limited", { status: 429, headers: { "retry-after": "2" } })) as typeof fetch;
    const err = await backfillRepoIssues("o/r", "tok", { fetchFn }).catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitedError);
    expect((err as RateLimitedError).retryAfterMs).toBe(2000);
  });
});

describe("backfillInstallation", () => {
  it("lists repos and backfills each", async () => {
    upserts.length = 0;
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      const target = url.toString();
      if (target.endsWith("/access_tokens")) {
        return json(
          { token: "inst-tok", expires_at: new Date(Date.now() + 3600_000).toISOString() },
        );
      }
      if (target.includes("/installation/repositories") || target.includes("/repositories?")) {
        return target.includes("page=1") || !target.includes("page=")
          ? json({ repositories: [{ full_name: "o/r" }] })
          : json({ repositories: [] });
      }
      if (target.includes("/issues?")) return json([]);
      throw new Error(`unexpected ${target}`);
    }) as typeof fetch;
    const keys = {
      appId: "42",
      privateKeyPem: crypto
        .generateKeyPairSync("rsa", { modulusLength: 2048 })
        .privateKey.export({ type: "pkcs8", format: "pem" }) as string,
    };
    const out = await backfillInstallation(99, keys, { fetchFn });
    expect(out.repos).toBe(1);
  });
});
