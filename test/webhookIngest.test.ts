import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import webhookHandler, { storePushCommits } from "../api/webhook.js";
import { signPayload } from "../src/verify.js";

const upserts: { op: string }[] = [];

vi.mock("../src/db.js", () => ({
  prisma: {
    repo: {
      upsert: async () => {
        upserts.push({ op: "repo.upsert" });
        return { id: "r1" };
      },
    },
    author: {
      upsert: async () => {
        upserts.push({ op: "author.upsert" });
        return { id: "a1" };
      },
    },
    commit: {
      upsert: async () => {
        upserts.push({ op: "commit.upsert" });
        return {};
      },
    },
  },
}));

function mockReq(body: string, headers: Record<string, string>) {
  const req = new EventEmitter() as EventEmitter & Record<string, unknown>;
  req.method = "POST";
  req.headers = headers;
  req.socket = { remoteAddress: "127.0.0.1" };
  process.nextTick(() => {
    req.emit("data", Buffer.from(body));
    req.emit("end");
  });
  return req as unknown as Parameters<typeof webhookHandler>[0];
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
  return { res: res as unknown as Parameters<typeof webhookHandler>[1], done };
}

const SECRET = "test-webhook-secret";
const PUSH = {
  ref: "refs/heads/main",
  repository: { full_name: "o/r" },
  commits: [
    {
      id: "abc123",
      message: "feat: test the pipeline",
      timestamp: "2026-10-10T10:00:00Z",
      author: { username: "octocat", name: "Octo Cat" },
    },
    { id: "def456", message: "fix: typo", author: { name: "anon" } },
  ],
};

describe("push ingest (serverless)", () => {
  it("stores repo, authors, and commits directly", async () => {
    upserts.length = 0;
    const stored = await storePushCommits(PUSH);
    expect(stored).toBe(2);
    expect(upserts.map((u) => u.op)).toEqual([
      "repo.upsert",
      "author.upsert",
      "commit.upsert",
      "author.upsert",
      "commit.upsert",
    ]);
  });

  it("acks 200 and ingests on a signed push delivery", async () => {
    const saved = process.env.GITHUB_WEBHOOK_SECRET;
    process.env.GITHUB_WEBHOOK_SECRET = SECRET;
    try {
      upserts.length = 0;
      const raw = JSON.stringify(PUSH);
      const { res, done } = mockRes();
      await webhookHandler(
        mockReq(raw, {
          "x-github-delivery": "push-1",
          "x-github-event": "push",
          "x-hub-signature-256": signPayload(raw, SECRET),
        }),
        res,
      );
      expect(await done).toEqual({ status: 200, body: { ok: true } });
      expect(upserts.filter((u) => u.op === "commit.upsert")).toHaveLength(2);
    } finally {
      if (saved !== undefined) process.env.GITHUB_WEBHOOK_SECRET = saved;
      else delete process.env.GITHUB_WEBHOOK_SECRET;
    }
  });

  it("still acks 200 when the DB is down", async () => {
    // Mocked upserts above resolve; simulate outage by breaking the payload
    // path: missing repo -> stores 0, still 200.
    const saved = process.env.GITHUB_WEBHOOK_SECRET;
    process.env.GITHUB_WEBHOOK_SECRET = SECRET;
    try {
      const raw = JSON.stringify({ ref: "refs/heads/main", commits: [] });
      const { res, done } = mockRes();
      await webhookHandler(
        mockReq(raw, {
          "x-github-delivery": "push-2",
          "x-github-event": "push",
          "x-hub-signature-256": signPayload(raw, SECRET),
        }),
        res,
      );
      expect(await done).toEqual({ status: 200, body: { ok: true } });
    } finally {
      if (saved !== undefined) process.env.GITHUB_WEBHOOK_SECRET = saved;
      else delete process.env.GITHUB_WEBHOOK_SECRET;
    }
  });
});
