import { describe, expect, it } from "vitest";
import { classify } from "../src/brain/classify.js";

describe("classify", () => {
  it("conventional-commit fast path", () => {
    expect(classify("feat: add login")).toBe("feat");
    expect(classify("fix(auth): token expiry")).toBe("fix");
  });

  it("handles terrible messages", () => {
    expect(classify("fix")).toBe("fix");
    expect(classify("update")).toBe("chore");
    expect(classify("asdf qwerty")).toBe("other");
  });
});
