import { describe, expect, it } from "vitest";
import { shapeActivity, shapeMilestones } from "../src/dashboard.js";

describe("shapeMilestones", () => {
  it("empty milestone stays empty, never NaN", () => {
    const out = shapeMilestones([{ title: "Auth", issues: [] }]);
    expect(out).toEqual([
      {
        title: "Auth",
        percent: 0,
        closedPoints: 0,
        totalPoints: 0,
        open: 0,
        closed: 0,
        label: "no issues yet",
      },
    ]);
  });

  it("computes weighted percent", () => {
    const out = shapeMilestones([
      {
        title: "Auth",
        issues: [
          { state: "closed", sizeWeight: 3 },
          { state: "open", sizeWeight: 1 },
        ],
      },
    ]);
    expect(out[0]?.percent).toBe(75);
    expect(out[0]?.open).toBe(1);
    expect(out[0]?.closed).toBe(1);
  });
});

describe("shapeActivity", () => {
  it("aggregates commits + merged PRs per author, sorted", () => {
    const out = shapeActivity(
      [{ authorLogin: "a" }, { authorLogin: "a" }, { authorLogin: "b" }],
      [{ authorLogin: "b" }, { authorLogin: "c" }],
    );
    expect(out).toEqual([
      { login: "a", commits: 2, mergedPRs: 0 },
      { login: "b", commits: 1, mergedPRs: 1 },
      { login: "c", commits: 0, mergedPRs: 1 },
    ]);
  });
});
