import { describe, expect, it, vi } from "vitest";
import { commitAuthorLogin } from "../src/worker.js";

// db is instantiated at import; the mock keeps this a pure unit test.
vi.mock("../src/db.js", () => ({ prisma: {} }));

describe("commitAuthorLogin", () => {
  it("prefers the GitHub username", () => {
    expect(commitAuthorLogin({ username: "octocat", name: "Octo Cat" })).toBe("octocat");
  });
  it("falls back to the display name", () => {
    expect(commitAuthorLogin({ name: "anon" })).toBe("anon");
  });
  it("is unknown only when both are absent", () => {
    expect(commitAuthorLogin(undefined)).toBe("unknown");
    expect(commitAuthorLogin({})).toBe("unknown");
    expect(commitAuthorLogin({ username: "   ", name: "" })).toBe("unknown");
  });
});
