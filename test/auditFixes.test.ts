import { describe, expect, it } from "vitest";
import { truncateHtml } from "../src/formatter.js";
import { shapeActivityFromCounts } from "../src/dashboard.js";
import { weightFromLabels } from "../src/github-sync.js";

const ELLIPSIS = "\n… truncated";

describe("truncateHtml (Telegram-safe)", () => {
  it("returns short strings unchanged", () => {
    expect(truncateHtml("<b>hi</b>", 100)).toBe("<b>hi</b>");
  });

  it("backs off to before an unterminated tag", () => {
    // Budget lands inside `<a href="http://x">`; a raw slice would leave a
    // dangling `<`, which Telegram rejects as an unparseable entity.
    const s = 'ab<a href="http://x">z</a>';
    const out = truncateHtml(s, 20);
    expect(out).toBe("ab" + ELLIPSIS);
    expect(out.lastIndexOf("<")).toBe(-1);
  });

  it("never leaves a dangling entity", () => {
    const s = "x".repeat(45) + "&amp;" + "y".repeat(100);
    const out = truncateHtml(s, 60);
    expect(out).toBe("x".repeat(45) + ELLIPSIS);
    expect(out).not.toMatch(/&[a-z]*$/i);
  });

  it("keeps a sliced result within the limit", () => {
    const s = "<b>" + "z".repeat(5000) + "</b>";
    const out = truncateHtml(s, 100);
    expect(out.length).toBeLessThanOrEqual(100);
  });
});

describe("shapeActivityFromCounts", () => {
  it("sums counts per author and sorts by total activity", () => {
    const out = shapeActivityFromCounts(
      [
        { authorLogin: "ann", count: 3 },
        { authorLogin: "bob", count: 1 },
        { authorLogin: "unknown", count: 2 },
      ],
      [{ authorLogin: "bob", count: 4 }],
    );
    expect(out[0]).toEqual({ login: "bob", commits: 1, mergedPRs: 4 });
    expect(out.find((a) => a.login === "ann")).toEqual({ login: "ann", commits: 3, mergedPRs: 0 });
    expect(out.reduce((n, a) => n + a.commits, 0)).toBe(6);
    expect(out.reduce((n, a) => n + a.mergedPRs, 0)).toBe(4);
  });

  it("returns an empty rollup when there is no activity", () => {
    expect(shapeActivityFromCounts([], [])).toEqual([]);
  });
});

describe("weightFromLabels", () => {
  it("matches whole size labels", () => {
    expect(weightFromLabels([{ name: "S" }])).toBe(1);
    expect(weightFromLabels([{ name: "small" }])).toBe(1);
    expect(weightFromLabels([{ name: "size/m" }])).toBe(3);
    expect(weightFromLabels([{ name: "Medium" }])).toBe(3);
    expect(weightFromLabels([{ name: "size: L" }])).toBe(5);
    expect(weightFromLabels([{ name: "5" }])).toBe(5);
    expect(weightFromLabels([])).toBe(1);
  });

  it("does not mis-size unrelated labels that merely contain a digit", () => {
    // The old `includes("3")` / `includes("5")` matched these wrongly.
    expect(weightFromLabels([{ name: "p3" }])).toBe(1);
    expect(weightFromLabels([{ name: "fix 5 bugs" }])).toBe(1);
    expect(weightFromLabels([{ name: "size/xl" }])).toBe(1);
  });
});
