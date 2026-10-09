import { describe, expect, it, vi } from "vitest";
import { diffIssues, pruneMilestone, reconcileRepo } from "../src/reconcile.js";

const ops: { op: string; args?: unknown }[] = [];

const dbIssues = [
  {
    id: "i1",
    number: 1,
    title: "One",
    state: "open",
    sizeWeight: 1,
    milestoneId: "m1",
    milestone: { id: "m1", githubId: 3 },
  },
  {
    id: "i2",
    number: 2,
    title: "Two",
    state: "open",
    sizeWeight: 1,
    milestoneId: "m9",
    milestone: { id: "m9", githubId: 9 },
  },
];

vi.mock("../src/db.js", () => ({
  prisma: {
    repo: {
      findUnique: async (args: { where: { fullName?: string } }) =>
        args.where.fullName === "o/missing" ? null : { id: "r1" },
      update: async () => ({}),
    },
    issue: {
      findMany: async () => dbIssues,
      update: async (args: unknown) => {
        ops.push({ op: "issue.update", args });
        return {};
      },
      upsert: async (args: unknown) => {
        ops.push({ op: "issue.upsert", args });
        return {};
      },
      updateMany: async (args: unknown) => {
        ops.push({ op: "issue.updateMany", args });
        return { count: 1 };
      },
    },
    milestone: {
      findMany: async () => [
        { id: "m1", githubId: 3 },
        { id: "m9", githubId: 9 },
      ],
      findUnique: async (args: { where: { repoId_githubId?: { githubId: number } } }) =>
        args.where.repoId_githubId?.githubId === 4 ? { id: "m4" } : null,
      upsert: async (args: unknown) => {
        ops.push({ op: "milestone.upsert", args });
        return { id: "m1" };
      },
      delete: async (args: unknown) => {
        ops.push({ op: "milestone.delete", args });
        return {};
      },
      deleteMany: async (args: unknown) => {
        ops.push({ op: "milestone.deleteMany", args });
        return { count: 1 };
      },
    },
  },
}));

function apiIssues() {
  return [
    { number: 1, title: "One", state: "closed" as const, sizeWeight: 1, milestoneNumber: 3 },
    { number: 5, title: "Five", state: "open" as const, sizeWeight: 3, milestoneNumber: undefined },
  ];
}

describe("diffIssues", () => {
  it("flags state flips, inserts, and prunes only when complete", () => {
    const byGithub = new Map([
      [3, "m1"],
      [9, "m9"],
    ]);
    const full = diffIssues(
      dbIssues.map((i) => ({
        id: i.id,
        number: i.number,
        title: i.title,
        state: i.state,
        sizeWeight: i.sizeWeight,
        milestoneId: i.milestoneId,
        milestoneGithubId: i.milestone.githubId,
      })),
      apiIssues(),
      byGithub,
      new Set([3]),
      true,
    );
    expect(full.toUpdate.map((u) => u.id)).toContain("i1"); // open -> closed
    expect(full.toInsert.map((i) => i.number)).toEqual([5]);
    expect(full.unassignIssueIds).toEqual(["i2"]); // milestone 9 vanished
    expect(full.orphanMilestoneIds).toEqual(["m9"]);

    const partial = diffIssues(
      dbIssues.map((i) => ({
        id: i.id,
        number: i.number,
        title: i.title,
        state: i.state,
        sizeWeight: i.sizeWeight,
        milestoneId: i.milestoneId,
        milestoneGithubId: i.milestone.githubId,
      })),
      apiIssues(),
      byGithub,
      new Set([3]),
      false, // truncated listing: never prune
    );
    expect(partial.unassignIssueIds).toEqual([]);
    expect(partial.orphanMilestoneIds).toEqual([]);
  });
});

describe("reconcileRepo", () => {
  it("applies the diff and stamps lastSyncAt", async () => {
    ops.length = 0;
    const savedFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      const target = url.toString();
      // NOTE: match the trailing page param exactly — "page=1" is a
      // substring of "per_page=100".
      const page = target.endsWith("page=1") ? [ {
          number: 1,
          title: "One",
          state: "closed",
          labels: [],
          milestone: { number: 3, title: "Auth" },
        } ] : [];
      return new Response(JSON.stringify(page), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    try {
      const out = await reconcileRepo("o/r");
      expect(out).toMatchObject({ updated: 1, inserted: 0 });
      expect(ops.map((o) => o.op)).toContain("issue.update");
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  it("returns null for unknown repos", async () => {
    const savedFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;
    try {
      await expect(reconcileRepo("o/missing")).resolves.toBeNull();
    } finally {
      globalThis.fetch = savedFetch;
    }
  });
});

describe("pruneMilestone", () => {
  it("unassigns issues then drops the row", async () => {
    ops.length = 0;
    await expect(pruneMilestone("o/r", 4)).resolves.toBe(true);
    expect(ops.map((o) => o.op)).toEqual(["issue.updateMany", "milestone.delete"]);
  });

  it("is a no-op for unknown repos or missing rows", async () => {
    await expect(pruneMilestone("o/missing", 4)).resolves.toBe(false);
    await expect(pruneMilestone("o/r", 404)).resolves.toBe(true);
  });
});
