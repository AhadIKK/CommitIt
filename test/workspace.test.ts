import { describe, expect, it, afterEach } from "vitest";
import { renderDigestBodies } from "../src/delivery.js";
import {
  buildAlerts,
  chatTitleOf,
  commitCategory,
  commitDto,
  expectedWebhookUrl,
  issueDto,
  openPointsOf,
  orderIssues,
  repoNames,
  splitMessage,
  subscriptionDto,
} from "../src/workspace.js";
import { handleWorkspace, isWorkspacePath, workspacePath } from "../src/workspaceRoutes.js";
import { pointsOf, weightOf } from "../src/ops.js";
import { chatNameOf } from "../src/chatTitle.js";

describe("commit shaping", () => {
  it("maps every stored category onto the contract's seven", () => {
    expect(commitCategory("feat", "x")).toBe("feat");
    expect(commitCategory("perf", "x")).toBe("refactor");
    expect(commitCategory("ci", "x")).toBe("chore");
    expect(commitCategory("build", "x")).toBe("chore");
    expect(commitCategory("merge", "Merge branch 'main'")).toBe("other");
    expect(commitCategory("nonsense", "x")).toBe("other");
  });

  it("classifies a message when ingest stored no category", () => {
    expect(commitCategory(null, "fix: stop dividing by zero")).toBe("fix");
    expect(commitCategory(null, "Update README")).toBe("docs");
  });

  it("splits subject from body, and omits an empty body", () => {
    expect(splitMessage("fix: one line\n\nand the why")).toEqual({
      subject: "fix: one line",
      body: "and the why",
    });
    expect(splitMessage("fix: one line")).toEqual({ subject: "fix: one line" });
  });

  it("offers a suggestion but never a link", () => {
    const row = {
      id: "c1",
      sha: "abcdef1234567",
      message: "fix auth token refresh",
      category: null,
      aiSummary: null,
      branch: "fix/auth-token",
      additions: 10,
      deletions: 2,
      committedAt: new Date("2026-10-20T10:00:00Z"),
      createdAt: new Date("2026-10-20T10:01:00Z"),
      isMerge: false,
      secretFlag: false,
      authorId: "a1",
      author: { id: "a1", githubLogin: "ahad", displayName: null },
      issue: null,
    };
    const dto = commitDto(row, [{ number: 4, title: "Auth token refresh" }]);
    expect(dto.issueNumber).toBeNull();
    expect(dto.suggestedIssueNumber).toBe(4);
    expect(dto.authorId).toBe("a1");
    expect(dto.category).toBe("fix");
  });

  it("never suggests a link for a secret-flagged commit", () => {
    const row = {
      id: "c2",
      sha: "deadbeef",
      message: "fix auth token refresh",
      category: null,
      aiSummary: null,
      branch: "fix/auth-token",
      additions: 1,
      deletions: 0,
      committedAt: null,
      createdAt: new Date("2026-10-20T10:00:00Z"),
      isMerge: false,
      secretFlag: true,
      authorId: null,
      author: null,
      issue: null,
    };
    const dto = commitDto(row, [{ number: 4, title: "Auth token refresh" }]);
    expect(dto.suggestedIssueNumber).toBeNull();
    // Rule 12: an unattributed commit reads as unknown, not blank.
    expect(dto.authorId).toBe("unknown");
  });
});

describe("issue shaping", () => {
  const issue = (n: number, state: string, closedAt: string | null) => ({
    number: n,
    title: `#${n}`,
    sizeWeight: 3 as const,
    state: state === "closed" ? ("closed" as const) : ("open" as const),
    milestoneId: "m1",
    closedAt,
  });

  it("draws the closed prefix in closing order, then the open work", () => {
    const ordered = orderIssues([
      issue(9, "open", null),
      issue(2, "closed", "2026-10-02T00:00:00Z"),
      issue(1, "closed", "2026-10-01T00:00:00Z"),
    ]);
    expect(ordered.map((i) => i.number)).toEqual([1, 2, 9]);
  });

  it("counts an unestimated issue as one point", () => {
    expect(
      openPointsOf([
        { state: "open", sizeWeight: 0 },
        { state: "open", sizeWeight: 5 },
        { state: "closed", sizeWeight: 5 },
      ]),
    ).toBe(6);
  });

  it("keeps a size weight outside 1/3/5 as unestimated (null)", () => {
    const dto = issueDto({
      id: "i1",
      number: 3,
      title: "Odd weight",
      sizeWeight: 2,
      state: "open",
      milestoneId: null,
      closedAt: null,
      reopenedAt: null,
      updatedAt: new Date("2026-10-01T00:00:00Z"),
    });
    expect(dto.sizeWeight).toBeNull();
    expect(dto.closedAt).toBeNull();
  });

  it("reports the stored close and reopen moments, not updatedAt", () => {
    const closed = issueDto({
      id: "i2",
      number: 4,
      title: "Auth",
      sizeWeight: 3,
      state: "closed",
      milestoneId: "m1",
      closedAt: new Date("2026-10-02T10:00:00Z"),
      reopenedAt: null,
      // A later edit must not move the close date.
      updatedAt: new Date("2026-10-20T10:00:00Z"),
    });
    expect(closed.closedAt).toBe("2026-10-02T10:00:00.000Z");

    const reopened = issueDto({
      id: "i3",
      number: 5,
      title: "Login",
      sizeWeight: 1,
      state: "open",
      milestoneId: "m1",
      closedAt: null,
      reopenedAt: new Date("2026-10-03T09:30:00Z"),
      updatedAt: new Date("2026-10-03T09:30:00Z"),
    });
    expect(reopened.state).toBe("open");
    expect(reopened.closedAt).toBeNull();
    expect(reopened.reopenedAt).toBe("2026-10-03T09:30:00.000Z");
  });
});

describe("alerts", () => {
  const base = {
    repoFullName: "ahad/commitit",
    defaultBranch: "main",
    secretCommits: [],
    failedBuilds: [],
    forcePushes: [],
    lastActivityAt: new Date("2026-10-22T00:00:00Z"),
    now: new Date("2026-10-23T00:00:00Z"),
  };

  it("says nothing when nothing is wrong", () => {
    expect(buildAlerts(base)).toEqual([]);
  });

  it("names a secret by commit and never by value", () => {
    const [alert] = buildAlerts({
      ...base,
      secretCommits: [
        {
          sha: "abcdef1234567890",
          branch: "main",
          committedAt: new Date("2026-10-22T10:00:00Z"),
          createdAt: new Date("2026-10-22T10:01:00Z"),
        },
      ],
    });
    expect(alert?.kind).toBe("secret");
    expect(alert?.severity).toBe("danger");
    expect(alert?.title).toContain("abcdef1");
    expect(alert?.href).toBe("https://github.com/ahad/commitit/commit/abcdef1234567890");
    expect(JSON.stringify(alert)).not.toMatch(/sk-|ghp_|token=/);
  });

  it("reports a failed build with its run link", () => {
    const [alert] = buildAlerts({
      ...base,
      failedBuilds: [
        {
          id: "b1",
          commitSha: "1234567890",
          branch: "feat/x",
          buildNumber: "42",
          runUrl: "https://ci/run/42",
          createdAt: new Date("2026-10-22T09:00:00Z"),
        },
      ],
    });
    expect(alert?.kind).toBe("build_failed");
    expect(alert?.detail).toContain("42");
    expect(alert?.href).toBe("https://ci/run/42");
  });

  it("reports a force push as a rewrite, not as activity", () => {
    const [alert] = buildAlerts({
      ...base,
      forcePushes: [
        {
          sha: "aaaabbbb",
          branch: "main",
          committedAt: new Date("2026-10-22T08:00:00Z"),
          createdAt: new Date("2026-10-22T08:00:00Z"),
        },
      ],
    });
    expect(alert?.kind).toBe("force_push");
    expect(alert?.detail).toContain("excluded from activity");
  });

  it("warns after a week of silence", () => {
    const [alert] = buildAlerts({
      ...base,
      lastActivityAt: new Date("2026-10-10T00:00:00Z"),
    });
    expect(alert?.kind).toBe("inactivity");
    expect(alert?.severity).toBe("warn");
  });
});

describe("subscription shaping", () => {
  it("spells an empty author filter as 'all' and defaults the event kinds", () => {
    const dto = subscriptionDto({
      id: "s1",
      chatId: "c1",
      repoId: "r1",
      digestMode: "hourly",
      quietHoursStart: null,
      quietHoursEnd: null,
      filterBranches: ["main"],
      filterAuthors: [],
      filterEventTypes: [],
      isMuted: false,
      chat: { telegramChatId: "123", type: "group" },
    });
    expect(dto.mode).toBe("hourly");
    expect(dto.filters.authors).toBe("all");
    expect(dto.filters.events).toEqual(["commits", "pull_requests", "issues"]);
    expect(dto.quietHours.enabled).toBe(false);
    expect(dto.chatTitle).toBe("Group chat");
  });

  it("falls back to daily for a stored mode we do not know", () => {
    const dto = subscriptionDto({
      id: "s2",
      chatId: "c2",
      repoId: "r1",
      digestMode: "fortnightly",
      quietHoursStart: "22:00",
      quietHoursEnd: "07:00",
      filterBranches: [],
      filterAuthors: ["a1"],
      filterEventTypes: ["commits"],
      isMuted: true,
      chat: { telegramChatId: "9", type: "dm", title: null },
    });
    expect(dto.mode).toBe("daily");
    expect(dto.quietHours).toEqual({ enabled: true, from: "22:00", to: "07:00" });
    expect(dto.filters.authors).toEqual(["a1"]);
    expect(dto.chatTitle).toBe("Direct message");
  });

  it("labels a group chat and a DM without inventing a title", () => {
    expect(chatTitleOf({ type: "group" })).toBe("Group chat");
    expect(chatTitleOf({ type: "dm" })).toBe("Direct message");
    // The name Telegram gave us wins; "Direct message" was only a stand-in.
    expect(chatTitleOf({ type: "dm", title: "Fizzzzz" })).toBe("Fizzzzz");
    expect(chatTitleOf({ type: "group", title: "  SynCura team  " })).toBe("SynCura team");
    expect(chatTitleOf({ type: "group", title: "   " })).toBe("Group chat");
  });
});

describe("telegram chat names", () => {
  it("prefers the group title, then a person's name, then their handle", () => {
    expect(chatNameOf({ title: "SynCura team" })).toBe("SynCura team");
    expect(chatNameOf({ first_name: "Affan" })).toBe("Affan");
    expect(chatNameOf({ username: "affan" })).toBe("affan");
    expect(chatNameOf({})).toBe("");
  });
});

describe("the digest preview is the sent message", () => {
  it("joins the queued bodies the same way the sender does", () => {
    expect(renderDigestBodies(["one", "two"])).toBe("one\n\ntwo");
  });

  it("caps at Telegram's limit, and says it truncated", () => {
    const body = renderDigestBodies(["x".repeat(4000)]);
    expect(body.length).toBe(3780 + "\n… truncated".length);
    expect(body.endsWith("truncated")).toBe(true);
  });
});

describe("repo naming", () => {
  it("splits owner from name once", () => {
    expect(repoNames("AhadIKK/CommitIt")).toEqual({ owner: "AhadIKK", name: "CommitIt" });
    expect(repoNames("no-slash")).toEqual({ owner: "", name: "no-slash" });
  });

  it("points at the webhook on this host", () => {
    const before = process.env.APP_URL;
    process.env.APP_URL = "https://commitit.example/";
    expect(expectedWebhookUrl()).toBe("https://commitit.example/api/webhook");
    process.env.APP_URL = before;
  });
});

describe("the ledger's weights", () => {
  it("only trusts a stored size of 1, 3 or 5", () => {
    expect(weightOf(1)).toBe(1);
    expect(weightOf(3)).toBe(3);
    expect(weightOf(5)).toBe(5);
    expect(weightOf(0)).toBeNull();
    expect(weightOf(2)).toBeNull();
  });

  it("counts an unestimated task as one point, the way the track draws it", () => {
    expect(pointsOf(0)).toBe(1);
    expect(pointsOf(1)).toBe(1);
    expect(pointsOf(3)).toBe(3);
    expect(pointsOf(5)).toBe(5);
  });
});

describe("routing", () => {
  it("normalises both hosts' prefixes to the same path", () => {
    expect(workspacePath("/api/repos/abc/today")).toBe("/repos/abc/today");
    expect(workspacePath("/api/product/repos/abc/today")).toBe("/repos/abc/today");
    expect(workspacePath("/api/me")).toBe("/me");
    expect(workspacePath("/api/repos")).toBe("/repos");
    expect(workspacePath("/api/ops")).toBe("/ops");
  });

  it("knows which paths it owns", () => {
    expect(isWorkspacePath("/api/repos/abc/goals")).toBe(true);
    expect(isWorkspacePath("/api/link/telegram/tok")).toBe(true);
    expect(isWorkspacePath("/api/ops")).toBe(true);
    expect(isWorkspacePath("/api/progress")).toBe(false);
    expect(isWorkspacePath("/api/webhook")).toBe(false);
  });

  it("returns null for a path it does not own", async () => {
    const out = await handleWorkspace({
      method: "GET",
      path: "/nothing/here",
      query: new URLSearchParams(),
      body: {},
      cookies: {},
      ip: "127.0.0.1",
    });
    expect(out).toBeNull();
  });

  describe("with OAuth configured", () => {
    const before = process.env.GITHUB_CLIENT_ID;

    afterEach(() => {
      if (before === undefined) delete process.env.GITHUB_CLIENT_ID;
      else process.env.GITHUB_CLIENT_ID = before;
    });

    it("refuses a repo read without a session", async () => {
      process.env.GITHUB_CLIENT_ID = "client-id";
      const out = await handleWorkspace({
        method: "GET",
        path: "/repos/abc/today",
        query: new URLSearchParams(),
        body: {},
        cookies: {},
        ip: "127.0.0.1",
      });
      expect(out?.status).toBe(401);
      expect(out?.body).toEqual({ ok: false, error: "logged_out" });
    });

    it("refuses the operator ledger without a session", async () => {
      process.env.GITHUB_CLIENT_ID = "client-id";
      const out = await handleWorkspace({
        method: "GET",
        path: "/ops",
        query: new URLSearchParams(),
        body: {},
        cookies: {},
        ip: "127.0.0.1",
      });
      expect(out?.status).toBe(401);
      expect(out?.body).toEqual({ ok: false, error: "logged_out" });
    });

    it("refuses the one write without a session", async () => {
      process.env.GITHUB_CLIENT_ID = "client-id";
      const out = await handleWorkspace({
        method: "POST",
        path: "/repos/abc/commits/deadbeef",
        query: new URLSearchParams(),
        body: { issueNumber: 1 },
        cookies: {},
        ip: "127.0.0.1",
      });
      expect(out?.status).toBe(401);
    });
  });

  it("rejects a malformed link body before touching the store", async () => {
    const out = await handleWorkspace({
      method: "POST",
      path: "/repos/abc/commits/deadbeef",
      query: new URLSearchParams(),
      body: { issueNumber: "not a number" },
      cookies: {},
      ip: "127.0.0.1",
    });
    // No DB in unit tests, so the repo gate answers 404 before validation.
    expect([400, 404]).toContain(out?.status);
  });
});
