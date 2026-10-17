import { afterEach, describe, expect, it, vi } from "vitest";
import { DIGEST_MODES } from "../src/notifyPrefs.js";
import { HELP } from "../src/telegramBot.js";
import {
  BOT_COMMANDS,
  CALLBACK_DATA_MAX,
  digestKeyboard,
  digestView,
  reposKeyboard,
  reposView,
  startKeyboard,
  UI_DIGEST_MODES,
  websiteUrl,
} from "../src/telegramUi.js";

// telegramUi is pure, but notifyPrefs/telegramBot reach prisma on import.
vi.mock("../src/db.js", () => ({ prisma: {} }));

afterEach(() => {
  delete process.env.APP_URL;
});

describe("the / command menu", () => {
  it("stays inside Telegram's setMyCommands limits", () => {
    expect(BOT_COMMANDS.length).toBeGreaterThan(0);
    expect(BOT_COMMANDS.length).toBeLessThanOrEqual(32);
    for (const c of BOT_COMMANDS) {
      expect(c.command).toMatch(/^[a-z0-9_]{1,32}$/);
      expect(c.description.length).toBeGreaterThan(0);
      expect(c.description.length).toBeLessThanOrEqual(256);
    }
  });

  // The menu and the help text are two views of one list; drift means autofill
  // offers something the bot doesn't document, or vice versa.
  it("advertises exactly the commands the help text lists", () => {
    const advertised = [...HELP.matchAll(/^\/([a-z]+)/gm)].map((m) => m[1]);
    expect(new Set(advertised)).toEqual(new Set(BOT_COMMANDS.map((c) => c.command)));
  });

  it("keeps the UI mode list in step with the digest modes", () => {
    expect([...UI_DIGEST_MODES]).toEqual([...DIGEST_MODES]);
  });
});

describe("website button", () => {
  it("prefers APP_URL and falls back to the deployed site", () => {
    process.env.APP_URL = "https://commitit.example/";
    expect(websiteUrl()).toBe("https://commitit.example");
    expect(startKeyboard().inline_keyboard[0]?.[0]).toEqual({
      text: "🌐 Open CommitIt",
      url: "https://commitit.example",
    });

    delete process.env.APP_URL;
    expect(websiteUrl()).toContain("commitit-web.vercel.app");
  });
});

describe("repos keyboard", () => {
  it("toggles per repo and skips names that would overflow callback_data", () => {
    const tooLong = `${"a".repeat(70)}/r`;
    expect(Buffer.byteLength(`sub:${tooLong}`)).toBeGreaterThan(CALLBACK_DATA_MAX);

    const kb = reposKeyboard([
      { repo: "o/r", bound: false },
      { repo: "o/b", bound: true },
      { repo: tooLong, bound: false },
    ]);
    expect(kb?.inline_keyboard).toEqual([
      [{ text: "＋ o/r", callback_data: "sub:o/r" }],
      [{ text: "✓ o/b", callback_data: "unsub:o/b" }],
    ]);
  });

  it("returns no markup when nothing can be a button", () => {
    expect(reposKeyboard([])).toBeUndefined();
    expect(reposKeyboard([{ repo: `${"a".repeat(70)}/r`, bound: false }])).toBeUndefined();
  });

  it("keeps the ✓/· listing and only hints at tapping when buttons exist", () => {
    const tappable = reposView(["o/r", "o/b"], new Set(["o/r"]));
    expect(tappable.text).toContain("✓ <code>o/r</code>");
    expect(tappable.text).toContain("· <code>o/b</code>");
    expect(tappable.text).toContain("tap a repo below");
    expect(tappable.keyboard).toBeDefined();

    const tooLong = reposView([`${"a".repeat(70)}/r`], new Set());
    expect(tooLong.keyboard).toBeUndefined();
    expect(tooLong.text).not.toContain("tap a repo below");
    expect(tooLong.text).toContain("/bind owner/repo to add.");
  });

  it("caps the listing at 15 with a +N more line", () => {
    const repos = Array.from({ length: 17 }, (_, i) => `o/r${i}`);
    const view = reposView(repos, new Set());
    expect(view.text).toContain("+2 more");
    expect(view.keyboard?.inline_keyboard).toHaveLength(15);
  });
});

describe("digest keyboard and view", () => {
  it("marks the current mode and pins the repo when it fits", () => {
    const kb = digestKeyboard("daily", "o/r");
    expect(kb.inline_keyboard[0]).toHaveLength(4);
    const daily = kb.inline_keyboard[0]?.find((b) => b.text === "• Daily");
    expect(daily?.callback_data).toBe("digest:daily:o/r");
    expect(kb.inline_keyboard[0]?.[1]?.text).toBe("Hourly");
  });

  it("drops the repo pin rather than send oversized callback_data", () => {
    const kb = digestKeyboard(undefined, `${"a".repeat(60)}/r`);
    expect(kb.inline_keyboard[0]?.[0]?.callback_data).toBe("digest:instant");
  });

  it("handles none, one and many subscriptions", () => {
    expect(digestView([]).text).toBe("This chat has no subscriptions.");

    const one = digestView([{ repo: "o/r", digestMode: "daily", isMuted: false }]);
    expect(one.text).toContain("<code>o/r</code> → daily");
    expect(one.text).toContain("tap a mode below");
    expect(one.keyboard?.inline_keyboard[0]?.[2]?.callback_data).toBe("digest:daily:o/r");

    const many = digestView([
      { repo: "o/r", digestMode: "daily", isMuted: false },
      { repo: "o/b", digestMode: "weekly", isMuted: true },
    ]);
    expect(many.text).toContain("<code>o/b</code> → weekly (muted)");
    expect(many.text).not.toContain("tap a mode below");
    // Modes differ, so nothing is marked current and the tap is chat-wide.
    for (const b of many.keyboard?.inline_keyboard[0] ?? []) {
      expect(b.text.startsWith("• ")).toBe(false);
      expect(b.callback_data).toMatch(/^digest:[a-z]+$/);
    }
  });
});
