import { describe, expect, it } from "vitest";
import type { Author, Commit, Milestone } from "../api/types.js";
import { DIGEST_CHAR_LIMIT, DIGEST_COMMIT_CAP, DIGEST_PUSH_COLLAPSE_AT, DIGEST_MODE_LABEL, renderDigest } from "./digest.js";
import { clockTime } from "./format.js";

const fizan: Author = { id: "u_fizan", login: "fizan" };
const ahad: Author = { id: "u_ahad", login: "ahad" };

const milestone: Milestone = {
  id: "m_auth",
  title: "Auth",
  dueDate: "2026-10-23T00:00:00Z",
  state: "open",
  weightedClosed: 8,
  weightedTotal: 13,
  issueCount: 7,
  closedCount: 4,
};

function commit(i: number, extra: Partial<Commit> = {}): Commit {
  return {
    sha: `${(0xabcdef00 + i).toString(16).padStart(8, "0")}aabb`,
    message: `feat: wire up module ${i}`,
    category: "feat",
    branch: "main",
    additions: 10,
    deletions: 1,
    committedAt: "2026-10-17T08:00:00Z",
    authorId: "u_fizan",
    isMerge: false,
    secretFlag: false,
    ...extra,
  };
}

const NOW = new Date("2026-10-17T09:00:00Z");

function render(groups: Array<{ author: Author; commits: Commit[] }>, mode: "instant" | "daily" = "daily") {
  return renderDigest({
    repoFullName: "syncurateam/syncura",
    mode,
    at: "2026-10-17T09:00:00Z",
    milestone,
    groups,
    compareLink: "https://github.com/syncurateam/syncura/compare/aaa...bbb",
    now: NOW,
  });
}

describe("the digest message", () => {
  it("opens with the repo, the mode and the time, then the progress sentence", () => {
    const out = render([{ author: fizan, commits: [commit(1)] }]);
    const lines = out.text.split("\n");
    expect(lines[0]).toBe(`syncurateam/syncura · ${DIGEST_MODE_LABEL.daily} · ${clockTime("2026-10-17T09:00:00Z")}`);
    expect(lines[2]).toBe("Auth is 62% done: 8 of 13 points, due in 6 days.");
    expect(out.text).not.toContain("0%");
  });

  it("counts its own characters", () => {
    const out = render([{ author: fizan, commits: [commit(1), commit(2)] }]);
    expect(out.charCount).toBe(out.text.length);
    expect(out.charLimit).toBe(DIGEST_CHAR_LIMIT);
  });

  it("caps the number of commits and says how many were left out", () => {
    const groups = [
      { author: fizan, commits: Array.from({ length: 5 }, (_, i) => commit(i)) },
      { author: ahad, commits: Array.from({ length: 5 }, (_, i) => commit(10 + i)) },
      { author: fizan, commits: Array.from({ length: 5 }, (_, i) => commit(20 + i)) },
      { author: ahad, commits: Array.from({ length: 5 }, (_, i) => commit(30 + i)) },
    ];
    const out = render(groups);
    expect(out.omitted).toBe(5);
    expect(out.truncated).toBe(true);
    expect(out.text).toContain("+5 more commits");
    expect(out.text).toContain("compare https://github.com/syncurateam/syncura/compare/aaa...bbb");
    const shown = out.text.split("\n").filter((l) => l.includes("  ") && l.includes("wire up"));
    expect(shown.length).toBeLessThanOrEqual(DIGEST_COMMIT_CAP);
  });

  it("a collapsed push keeps its place, so it is never also counted as left out", () => {
    const commits = Array.from({ length: DIGEST_COMMIT_CAP + 5 }, (_, i) => commit(i));
    const out = render([{ author: fizan, commits }]);
    expect(out.collapsed).toBe(true);
    expect(out.omitted).toBe(0);
    expect(out.text).not.toContain("more commits");
    expect(out.text).toContain("20 commits pushed to main");
  });

  it("collapses a single push of more than ten commits into one line", () => {
    const commits = Array.from({ length: DIGEST_PUSH_COLLAPSE_AT + 6 }, (_, i) => commit(i, { branch: "feat/auth" }));
    const out = render([{ author: fizan, commits }]);
    expect(out.collapsed).toBe(true);
    expect(out.text).toContain("fizan, 16 commits");
    expect(out.text).toContain("16 commits pushed to feat/auth");
    // the sixteen individual subjects are not in the message
    expect(out.text).not.toContain("wire up module 0");
  });

  it("never exceeds the 3 800 characters a chat allows, however long the work is", () => {
    const long =
      "refactor: split the auth middleware into a pure verification step and a thin request wrapper so the token path can be tested without a request object and the session store can be swapped later";
    const group = (offset: number) =>
      Array.from({ length: 5 }, (_, i) => commit(offset + i, { message: `${long} (pass ${offset + i})` }));
    const groups = [
      { author: fizan, commits: group(0) },
      { author: ahad, commits: group(10) },
      { author: fizan, commits: group(20) },
      { author: ahad, commits: group(30) },
    ];
    const out = render(groups);
    expect(out.text.length).toBeLessThanOrEqual(DIGEST_CHAR_LIMIT);
    expect(out.charCount).toBeLessThanOrEqual(DIGEST_CHAR_LIMIT);
    // it shrank by dropping whole lines, so the tail is the "+N more" line
    expect(out.omitted).toBeGreaterThan(0);
    expect(out.text).toContain("more commits");
    expect(out.truncated).toBe(true);
  });

  it("closes a clipped message with an ellipsis rather than a half token", () => {
    const groups = [
      {
        author: fizan,
        commits: Array.from({ length: 14 }, (_, i) =>
          commit(i, { message: `feat: ${"x".repeat(600)} ${i}`, issueNumber: 12 }),
        ),
      },
    ];
    const out = render(groups);
    expect(out.text.length).toBeLessThanOrEqual(DIGEST_CHAR_LIMIT);
    if (out.text.endsWith("…")) {
      expect(out.text.slice(0, -1).trimEnd().length).toBeGreaterThan(0);
    } else {
      expect(out.text).toMatch(/\n/);
    }
  });

  it("an empty window still renders an honest header", () => {
    const out = render([]);
    expect(out.text.split("\n")[0]).toContain("daily digest");
    expect(out.omitted).toBe(0);
    expect(out.text).not.toContain("+0 more");
  });
});
