import { describe, expect, it } from "vitest";
import {
  COMMIT_SUBJECT_MAX,
  commitSubject,
  meaningfulSummary,
  shapeCommits,
} from "../src/dashboard.js";

// "What each commit is about" reads the subject (first line) and the stored
// AI summary. These are pure shapers: no DB, no network.
describe("commitSubject", () => {
  it("keeps only the first line of a multi-line message", () => {
    expect(commitSubject("fix(queue): reclaim orphans\n\nLong body here\nmore")).toBe(
      "fix(queue): reclaim orphans",
    );
  });

  it("trims surrounding whitespace", () => {
    expect(commitSubject("   spaced out   ")).toBe("spaced out");
  });

  it("caps very long subjects with an ellipsis", () => {
    const out = commitSubject("x".repeat(COMMIT_SUBJECT_MAX + 50));
    expect(out.length).toBe(COMMIT_SUBJECT_MAX + 1);
    expect(out.endsWith("…")).toBe(true);
  });

  it("tolerates an empty message", () => {
    expect(commitSubject("")).toBe("");
    expect(commitSubject("\n\nbody only")).toBe("");
  });
});

describe("meaningfulSummary", () => {
  it("keeps a summary that says something the subject does not", () => {
    expect(
      meaningfulSummary(
        "fix(queue): reclaim orphans",
        "Hands jobs abandoned by a crashed worker back to the queue.",
      ),
    ).toBe("Hands jobs abandoned by a crashed worker back to the queue.");
  });

  it("drops the echo stub's canned 'AI summary:' restatement", () => {
    // What the default AI_PROVIDER=echo actually stores.
    expect(meaningfulSummary("feat: add marks", "AI summary: feat: add marks")).toBeNull();
  });

  it("drops the echo's 120-char slice of a longer subject", () => {
    const long = `feat(bot): ${"x".repeat(200)}`;
    const echoed = `AI summary: ${long.split("\n")[0]!.slice(0, 120)}`;
    expect(meaningfulSummary(long, echoed)).toBeNull();
  });

  it("drops a degraded summary that repeats the whole message", () => {
    const msg = "chore: tidy\n\nwith a body the model echoed back";
    expect(meaningfulSummary(msg, msg)).toBeNull();
  });

  it("treats missing and blank summaries as none", () => {
    expect(meaningfulSummary("fix: a", null)).toBeNull();
    expect(meaningfulSummary("fix: a", "")).toBeNull();
    expect(meaningfulSummary("fix: a", "   ")).toBeNull();
  });
});

describe("shapeCommits", () => {
  const at = new Date("2026-10-17T11:55:00.000Z");

  it("shapes a full row", () => {
    expect(
      shapeCommits([
        {
          sha: "9aa30ca1234567890abcdef",
          message: "feat(dashboard): section marks\n\nbody",
          aiSummary: "Adds theme-aware Telegram and GitHub marks.",
          category: "feature",
          branch: "main",
          committedAt: at,
          isMerge: false,
          secretFlag: false,
          author: { githubLogin: "AhadIKK" },
          issue: { number: 42 },
        },
      ]),
    ).toEqual([
      {
        sha: "9aa30ca1234567890abcdef",
        shortSha: "9aa30ca",
        subject: "feat(dashboard): section marks",
        aiSummary: "Adds theme-aware Telegram and GitHub marks.",
        author: "AhadIKK",
        category: "feature",
        branch: "main",
        committedAt: "2026-10-17T11:55:00.000Z",
        isMerge: false,
        secretFlag: false,
        issueNumber: 42,
      },
    ]);
  });

  it("reads an unattributed commit as 'unknown', never blank", () => {
    const [row] = shapeCommits([
      {
        sha: "abcdef1234567",
        message: "chore: tidy",
        aiSummary: null,
        category: null,
        branch: null,
        committedAt: null,
        isMerge: true,
        secretFlag: false,
        author: null,
        issue: null,
      },
    ]);
    // A blank author would look like a rendering bug rather than a data gap
    // (AGENTS.md rule 12), so the fallback is explicit.
    expect(row!.author).toBe("unknown");
    expect(row!.aiSummary).toBeNull();
    expect(row!.committedAt).toBeNull();
    expect(row!.issueNumber).toBeNull();
    expect(row!.isMerge).toBe(true);
  });

  it("carries the secret flag through so the UI can warn", () => {
    const [row] = shapeCommits([
      {
        sha: "deadbeef1234",
        message: "oops: add config",
        aiSummary: null, // never summarised: the file was skipped
        category: null,
        branch: "main",
        committedAt: at,
        isMerge: false,
        secretFlag: true,
        author: { githubLogin: "octocat" },
        issue: null,
      },
    ]);
    expect(row!.secretFlag).toBe(true);
    expect(row!.aiSummary).toBeNull();
  });

  it("returns an empty list for no rows", () => {
    expect(shapeCommits([])).toEqual([]);
  });
});
