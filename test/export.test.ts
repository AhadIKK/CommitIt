import { describe, expect, it } from "vitest";
import {
  activityToCsv,
  exportFilename,
  issuesToCsv,
  toCsv,
} from "../dashboard/src/export.js";

describe("toCsv", () => {
  it("starts with a UTF-8 BOM Excel recognizes", () => {
    const out = toCsv(["a"], [[1]]);
    expect(out.codePointAt(0)).toBe(0xfeff);
  });

  it("quotes fields containing commas, quotes, or newlines", () => {
    const out = toCsv(["title"], [['say "hi", ok\nbye']]);
    expect(out).toContain('"say ""hi"", ok\nbye"');
  });
});

describe("issuesToCsv", () => {
  it("emits header + rows with empty milestone as blank", () => {
    const out = issuesToCsv([
      { number: 14, title: "JWT, middleware", state: "closed", weight: 3, milestone: null },
    ]);
    const lines = out.trim().split("\r\n");
    expect(lines[0]).toBe("number,title,state,weight,milestone");
    expect(lines[1]).toBe('14,"JWT, middleware",closed,3,');
  });
});

describe("activityToCsv", () => {
  it("emits one row per author", () => {
    const out = activityToCsv([{ login: "a", commits: 2, mergedPRs: 1 }]);
    expect(out).toContain("login,commits,merged_prs");
    expect(out).toContain("a,2,1");
  });
});

describe("exportFilename", () => {
  it("sanitizes owner/repo into a safe filename", () => {
    expect(exportFilename("AhadIKK/CommitIt", "issues")).toBe("AhadIKK-CommitIt-issues.csv");
  });
});
