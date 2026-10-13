import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  RateLimitedError,
  backfillInstallation,
  backfillRepoIssues,
  backfillRepoPRs,
  repairCommitAuthors,
} from "../src/backfill.js";

const upserts: { op: string }[] = [];

vi.mock("../src/db.js", () => ({
  prisma: {
    repo: {
      upsert: async () => {
        upserts.push({ op: "repo.upsert" });
        return { id: "r1", syncEtag: null as string | null };
      },
      findUnique: async () => ({ id: "r1" }),
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
    author: {
      upsert: async () => {
        upserts.push({ op: "author.upsert" });
        return { id: "a1" };
      },
    },
    pullRequest: {
      upsert: async () => {
        upserts.push({ op: "pullRequest.upsert" });
        return { id: "p1" };
      },
    },
    commit: {
      findMany: async () => [],
      update: async () => {
        upserts.push({ op: "commit.update" });
        return {};
      },
    },
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

describe("backfillRepoPRs", () => {
  const MERGED = {
    number: 3,
    title: "Add login",
    state: "closed",
    merged_at: "2026-10-01T10:00:00Z",
    user: { login: "octocat" },
    base: { ref: "main" },
    head: { ref: "feat/login" },
  };
  const UNMERGED = {
    number: 4,
    title: "WIP",
    state: "closed",
    merged_at: null,
    user: { login: "octocat" },
    base: { ref: "main" },
    head: { ref: "feat/wip" },
  };

  it("stores merged PRs, skips closed-unmerged ones", async () => {
    upserts.length = 0;
    const fetchFn = (async (url: string | URL | Request) => {
      const target = url.toString();
      if (target.includes("/pulls?")) return json([MERGED, UNMERGED]);
      throw new Error(`unexpected ${target}`);
    }) as typeof fetch;
    const out = await backfillRepoPRs("o/r", "tok", { fetchFn });
    expect(out).toEqual({ prs: 1, merged: 1 });
    const ops = upserts.map((u) => u.op);
    expect(ops).toContain("author.upsert");
    expect(ops.filter((o) => o === "pullRequest.upsert")).toHaveLength(1);
  });

  it("returns null when GitHub errors", async () => {
    const fetchFn = (async () => new Response("nope", { status: 500 })) as typeof fetch;
    await expect(backfillRepoPRs("o/r", "tok", { fetchFn })).resolves.toBeNull();
  });
});

describe("repairCommitAuthors", () => {
  it("resolves unattributed SHAs and links authors", async () => {
    const { prisma } = await import("../src/db.js");
    const origFindMany = prisma.commit.findMany;
    (prisma.commit as unknown as { findMany: unknown }).findMany = async () => [
      { id: "c1", sha: "abc123" },
    ];
    const fetchFn = (async (url: string | URL | Request) => {
      const target = url.toString();
      if (target.includes("/commits/abc123")) {
        return json({ sha: "abc123", author: { login: "octocat" } });
      }
      throw new Error(`unexpected ${target}`);
    }) as typeof fetch;
    try {
      upserts.length = 0;
      const out = await repairCommitAuthors("o/r", "tok", { fetchFn });
      expect(out).toEqual({ repaired: 1 });
      const ops = upserts.map((u) => u.op);
      expect(ops).toContain("author.upsert");
      expect(ops).toContain("commit.update");
    } finally {
      (prisma.commit as unknown as { findMany: unknown }).findMany = origFindMany;
    }
  });

  it("repairs zero when nothing is unattributed", async () => {
    const fetchFn = (async () => {
      throw new Error("must not call GitHub with no rows");
    }) as typeof fetch;
    await expect(repairCommitAuthors("o/r", "tok", { fetchFn })).resolves.toEqual({
      repaired: 0,
    });
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
      if (target.includes("/pulls?")) return json([]);
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
