import { beforeEach, describe, expect, it, vi } from "vitest";

const commitUpserts: any[] = [];
const summarizeCalls: any[] = [];

vi.mock("../src/brain/summarize.js", () => ({
  summarize: async (o: any) => {
    summarizeCalls.push(o);
    return { text: o.message, degraded: true };
  },
}));

vi.mock("../src/github-sync.js", () => ({
  syncRepoIssues: async () => null,
  fetchIssues: async () => ({ issues: [], milestones: [], truncated: false }),
  storeSyncedIssues: async () => null,
  weightFromLabels: () => 1,
}));

vi.mock("../src/telegram.js", () => ({
  sendMessage: async () => ({ ok: true, placeholder: false }),
  escapeHtml: (s: string) => s,
}));

vi.mock("../src/db.js", () => ({
  prisma: {
    repo: {
      upsert: async () => ({ id: "r1", aiEnabled: false }),
      findUnique: async () => ({ id: "r1", installActive: true }),
    },
    issue: {
      findMany: async () => [{ id: "i5", number: 5, title: "Login button broken", state: "open" }],
    },
    author: { upsert: async () => ({ id: "a1" }) },
    commit: {
      upsert: async (a: any) => {
        commitUpserts.push(a);
        return {};
      },
    },
    subscription: { findMany: async () => [] },
    notification: { create: async () => ({}) },
    job: { update: async () => ({}) },
  },
}));

import { processJob } from "../src/worker.js";

function pushJob(message: string) {
  return {
    id: "j1",
    deliveryId: "d1",
    type: "push",
    payload: {
      repository: { full_name: "o/r" },
      ref: "refs/heads/main",
      commits: [
        {
          id: "abc1234",
          message,
          timestamp: "2026-01-01T00:00:00Z",
          author: { username: "octocat" },
        },
      ],
    },
    status: "queued",
    attempts: 0,
    nextRetryAt: null,
  };
}

describe("worker push linking + ai flag", () => {
  beforeEach(() => {
    commitUpserts.length = 0;
    summarizeCalls.length = 0;
  });

  it("persists a strong link (closes #N) and respects ai_enabled=false", async () => {
    await processJob(pushJob("fix: closes #5") as any);
    expect(commitUpserts).toHaveLength(1);
    expect(commitUpserts[0].create.issueId).toBe("i5");
    // ai_enabled=false must reach summarize(), which returns the degraded
    // fallback (raw message) and never calls the provider.
    expect(summarizeCalls[0]?.aiEnabled).toBe(false);
  });

  it("never auto-assigns a heuristic suggestion", async () => {
    await processJob(pushJob("fix login button crash") as any);
    expect(commitUpserts).toHaveLength(1);
    // Same wording scores a suggestion for issue #5 — it must stay unlinked.
    expect(commitUpserts[0].create.issueId).toBeNull();
  });
});
