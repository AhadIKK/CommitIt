import { describe, expect, it } from "vitest";
import { trim } from "../src/brain/trim.js";

describe("trim", () => {
  it("caps at 8KB/200 lines", () => {
    const big = Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n");
    const res = trim("src/a.ts", big);
    expect(res.truncated).toBe(true);
    expect(res.text.split("\n").length).toBeLessThanOrEqual(200);
    expect(res.text.length).toBeLessThanOrEqual(8000);
  });

  it("skips lockfiles/binaries/vendor", () => {
    expect(trim("package-lock.json", "x".repeat(100)).skipped).toBe(true);
    expect(trim("dist/bundle.min.js", "x".repeat(100)).skipped).toBe(true);
    expect(trim("a.png", "x".repeat(100)).skipped).toBe(true);
  });
});
