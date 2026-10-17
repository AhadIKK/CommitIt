import { beforeEach, describe, expect, it, vi } from "vitest";

// Capture the commit where-clause so we can assert the activity window uses
// real commit dates, not row insert time.
let lastWhere: unknown = null;
const commits: { author: { githubLogin: string } | null }[] = [];

vi.mock("../src/db.js", () => ({
  prisma: {
    repo: { findUnique: async () => ({ id: "r1", defaultBranch: "main", installationId: null }) },
    commit: {
      findMany: async (args: { where: unknown }) => {
        lastWhere = args.where;
        return commits;
      },
      count: async () => commits.length,
    },
    pullRequest: { findMany: async () => [], count: async () => 0 },
  },
}));

vi.mock("../src/githubCounts.js", () => ({
  getMainBranchCommitCount: async () => ({ count: null, defaultBranch: null }),
}));

const { getActivity } = await import("../src/dashboard.js");

describe("getActivity window", () => {
  beforeEach(() => {
    lastWhere = null;
    commits.length = 0;
  });

  it("filters commits by committedAt, falling back to createdAt for null", async () => {
    commits.push({ author: { githubLogin: "octocat" } });
    const out = await getActivity("o/r", 7);
    expect(out.totalCommits).toBe(1);
    expect(lastWhere).toMatchObject({
      repoId: "r1",
      OR: [
        { committedAt: { gte: expect.any(Date) } },
        { committedAt: null, createdAt: { gte: expect.any(Date) } },
      ],
    });
  });
});
