import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  formatCIFailed,
  formatCIFixed,
  formatPRMerged,
  formatPush,
  formatSecretAlert,
  formatStaleAlert,
} from "../src/formatter.js";
import { findStaleBranches } from "../src/stale.js";

const SECRET = "AKIAIOSFODNN7EXAMPLE";

describe("phase 6 formatters", () => {
  it("PR merged message links the PR, no AI summary", () => {
    const html = formatPRMerged({
      repo: "AhadIKK/CommitIt",
      prNumber: 15,
      title: "feat: add JWT middleware",
      author: "ahadikk",
    });
    expect(html).toContain("merged PR #15");
    expect(html).toContain("ahadikk");
    expect(html.length).toBeLessThanOrEqual(3800);
  });

  it("CI failed matches instant template", () => {
    const html = formatCIFailed({
      repo: "r",
      branch: "main",
      build: "142",
      commitMsg: "Add login route",
      author: "Fizan",
      runUrl: "https://example.com/run/142",
    });
    expect(html).toContain("🔴 CI failed on main — build #142");
    expect(html).toContain("Fizan");
    expect(html).toContain("View run");
  });

  it("CI fixed is green and short", () => {
    const html = formatCIFixed({ repo: "r", branch: "main", build: "143" });
    expect(html).toContain("🟢 CI fixed on main");
    expect(html.length).toBeLessThanOrEqual(3800);
  });

  it("secret alert carries path only, never the value", () => {
    const html = formatSecretAlert({
      repo: "r",
      branch: "main",
      sha: "abc1234",
      file: "src/auth.ts",
      author: "x",
    });
    expect(html).toContain("🔑");
    expect(html).toContain("src/auth.ts");
    expect(html).toContain("withheld");
    expect(html).not.toContain(SECRET);
  });

  it("direct-to-main push carries a risk line", () => {
    const html = formatPush({
      repo: "r",
      branch: "main",
      directToMain: true,
      commits: [{ sha: "abc1234", message: "fix: typo", author: "a", category: "fix" }],
    });
    expect(html).toContain("direct push to main");
  });

  it("stale alert lists inactive branches", () => {
    const html = formatStaleAlert({
      repo: "r",
      branches: [{ name: "feat/profile", days: 6 }],
    });
    expect(html).toContain("feat/profile");
    expect(html).toContain("6d");
  });
});

describe("findStaleBranches", () => {
  const now = new Date("2026-10-01T00:00:00Z");
  it("flags branches idle >= threshold, skips main/master", () => {
    const out = findStaleBranches(
      [
        { name: "feat/profile", lastActivityAt: "2026-09-20T00:00:00Z" },
        { name: "fix/x", lastActivityAt: "2026-09-29T00:00:00Z" },
        { name: "main", lastActivityAt: "2026-01-01T00:00:00Z" },
      ],
      now,
      6,
    );
    expect(out).toEqual([{ name: "feat/profile", days: 11 }]);
  });
});

describe("phase 6 fixtures", () => {
  it("pull_request + check_run fixtures parse", () => {
    const pr = JSON.parse(readFileSync("test/fixtures/pull_request.json", "utf8"));
    expect(pr.pull_request.merged).toBe(true);
    expect(pr.pull_request.body).toContain("Closes #14");
    const cr = JSON.parse(readFileSync("test/fixtures/check_run.json", "utf8"));
    expect(cr.check_run.conclusion).toBe("failure");
  });
});
