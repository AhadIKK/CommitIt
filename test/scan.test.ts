import { describe, expect, it } from "vitest";
import { scan } from "../src/brain/scan.js";

describe("scan", () => {
  it("flags AWS key with path only (never the value)", () => {
    const secret = "AKIAIOSFODNN7EXAMPLE";
    const res = scan([{ path: "src/a.ts", content: `key = "${secret}"` }]);
    expect(res.hasSecret).toBe(true);
    expect(res.hits[0]?.file).toBe("src/a.ts");
    expect(JSON.stringify(res)).not.toContain(secret);
  });

  it("passes clean content", () => {
    expect(scan([{ path: "ok.ts", content: "hello world" }]).hasSecret).toBe(
      false,
    );
  });
});
