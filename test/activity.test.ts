import { beforeEach, describe, expect, it, vi } from "vitest";

// Capture the commit where-clause so we can assert the activity window uses
// real commit dates, not row insert time.
let lastWhere: unknown = null;
const commits: {
  sha: string;
  message: string;
  aiSummary: string | null;
  category: string | null;
  branch: string | null;
  committedAt: Date | null;
  isMerge: boolean;
  secretFlag: boolean;
  author: { githubLogin: string } | null;
  issue: { number: number } | null;
}[] = [];

vi.mock("../src/db.js", () => ({
  prisma: {
    repo: { findUnique: async () => ({ id: "r1", defaultBranch: "main", installationId: null }) },
    commit: {
      findMany: async (args: { where: unknown }) => {
        lastWhere = args.where;
        return commits;
      },
      groupBy: async (args: { where: unknown }) => {
        lastWhere = args.where;
        return commits.length ? [{ authorId: "a1", _count: { _all: commits.length } }] : [];
      },
      count: async () => commits.length,
    },
    pullRequest: {
      findMany: async () => [],
      groupBy: async () => [],
      count: async () => 0,
    },
    author: { findMany: async () => [{ id: "a1", githubLogin: "octocat" }] },
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
    commits.push({
      sha: "9aa30ca1234567890",
      message: "fix(queue): reclaim orphans\n\nbody",
      aiSummary: "Hands orphaned jobs back to the queue.",
      category: "fix",
      branch: "main",
      committedAt: new Date(),
      isMerge: false,
      secretFlag: false,
      author: { githubLogin: "octocat" },
      issue: null,
    });
    const out = await getActivity("o/r", 7);
    expect(out.totalCommits).toBe(1);
    expect(lastWhere).toMatchObject({
      repoId: "r1",
      OR: [
        { committedAt: { gte: expect.any(Date) } },
        { committedAt: null, createdAt: { gte: expect.any(Date) } },
      ],
    });
    // The same window feeds the per-commit list the dashboard renders.
    expect(out.commits).toHaveLength(1);
    expect(out.commits[0]).toMatchObject({
      shortSha: "9aa30ca",
      subject: "fix(queue): reclaim orphans",
      aiSummary: "Hands orphaned jobs back to the queue.",
      author: "octocat",
    });
  });
});
