import { describe, expect, it } from "vitest";
import { meDto } from "../src/workspace.js";
import { DEFAULT_REPO } from "../dashboard/src/lib/queries.js";
import { createMockApi } from "../dashboard/src/api/mock.js";

describe("user account and default repository", () => {
  it("defaults DEFAULT_REPO to empty so new visitors are not greeted with syncura", () => {
    expect(DEFAULT_REPO).toBe("");
  });

  it("meDto includes avatarUrl when a session is provided", async () => {
    const session = {
      id: "u_test",
      login: "octocat",
      avatarUrl: "https://avatars.githubusercontent.com/u/583231?v=4",
    };
    const me = await meDto(session);
    expect(me.signedIn).toBe(true);
    expect(me.login).toBe("octocat");
    expect(me.avatarUrl).toBe("https://avatars.githubusercontent.com/u/583231?v=4");
  }, 15000);

  it("meDto handles signed-out session gracefully", async () => {
    const me = await meDto(null);
    expect(me.signedIn).toBe(false);
    expect(me.login).toBeNull();
    expect(me.avatarUrl).toBeNull();
  }, 15000);

  it("mock api supports logout method and resolves ok", async () => {
    const mock = createMockApi();
    const result = await mock.logout();
    expect(result).toEqual({ ok: true });
  });
});
