import { describe, expect, it } from "vitest";
import { milestoneProgress } from "../src/progress.js";

describe("milestoneProgress", () => {
  it("empty milestone returns no issues yet (no div/0)", () => {
    expect(milestoneProgress([])).toEqual({
      empty: true,
      label: "no issues yet",
    });
  });

  it("recomputes weighted progress", () => {
    const res = milestoneProgress([
      { state: "closed", sizeWeight: 3 },
      { state: "open", sizeWeight: 1 },
    ]);
    expect(res.empty).toBe(false);
    if (!res.empty) {
      expect(res.percent).toBe(75);
      expect(res.label).toContain("75%");
    }
  });
});
