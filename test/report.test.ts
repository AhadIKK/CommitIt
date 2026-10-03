import { describe, expect, it } from "vitest";
import {
  buildWeeklySummary,
  digestToDoc,
  escapeHtml,
  weekLabel,
} from "../dashboard/src/report.js";

const issues = [
  { number: 14, title: "JWT middleware", state: "open" as const, weight: 5, milestone: "Auth" },
  { number: 15, title: "Login UI", state: "closed" as const, weight: 3, milestone: "Auth" },
];

const activity = {
  repo: "r",
  authors: [{ login: "a", commits: 3, mergedPRs: 1 }],
  totalCommits: 3,
  totalMergedPRs: 1,
};

const progress = {
  repo: "r",
  milestones: [],
  overall: {
    title: "Overall",
    percent: 62,
    closedPoints: 8,
    totalPoints: 13,
    open: 1,
    closed: 1,
    label: "62% (8/13 pts)",
  },
};

describe("buildWeeklySummary", () => {
  it("writes data-driven Progress/Plans/Problems", () => {
    const s = buildWeeklySummary(activity, progress, issues, []);
    expect(s.progress).toContain("3 commits");
    expect(s.progress).toContain("62%");
    expect(s.plans).toContain("#14 JWT middleware");
    expect(s.problems).toBe("No failures recorded.");
  });

  it("handles empty data without NaN or blanks", () => {
    const s = buildWeeklySummary(null, null, [], []);
    expect(s.progress).toContain("No commits");
    expect(s.plans).toContain("No open issues");
    expect(s.problems).toContain("No failures");
  });
});

describe("digestToDoc", () => {
  it("escapes user content and contains no scripts", () => {
    const evil = [{ number: 1, title: "<script>alert(1)</script>", state: "open" as const, weight: 1, milestone: null }];
    const doc = digestToDoc({
      repo: "r",
      weekLabel: "2026-09-27 to 2026-10-03",
      summary: buildWeeklySummary(null, null, evil, []),
      issues: evil,
      digests: [],
    });
    expect(doc).not.toContain("<script>");
    expect(doc).toContain("&lt;script&gt;");
    expect(doc).toContain("<h2>Progress</h2>");
    expect(doc).toContain("<table");
  });
});

describe("escapeHtml + weekLabel", () => {
  it("escapes quotes and angle brackets", () => {
    expect(escapeHtml('a"b<c>&')).toBe("a&quot;b&lt;c&gt;&amp;");
  });
  it("labels a 7-day window", () => {
    expect(weekLabel(new Date("2026-10-03T00:00:00Z"))).toBe("2026-09-27 to 2026-10-03");
  });
});
