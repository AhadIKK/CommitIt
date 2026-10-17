import { describe, expect, it } from "vitest";
import { formatRecent, timeAgo } from "../src/formatter.js";

const NOW = new Date("2026-10-18T12:00:00Z");

type RecentInput = Parameters<typeof formatRecent>[0]["commits"][number];

function commit(over: Partial<RecentInput> = {}): RecentInput {
  return {
    repo: "o/r",
    sha: "a1b2c3d4e5f6a7b8",
    message: "add /recent command",
    author: "octocat",
    category: "feat",
    at: new Date("2026-10-18T10:00:00Z"),
    ...over,
  };
}

describe("timeAgo", () => {
  it("buckets minutes, hours, days, months and years", () => {
    expect(timeAgo(NOW, NOW)).toBe("just now");
    expect(timeAgo(new Date(NOW.getTime() - 30_000), NOW)).toBe("just now");
    expect(timeAgo(new Date(NOW.getTime() - 5 * 60_000), NOW)).toBe("5m ago");
    expect(timeAgo(new Date(NOW.getTime() - 3 * 3_600_000), NOW)).toBe("3h ago");
    expect(timeAgo(new Date(NOW.getTime() - 2 * 86_400_000), NOW)).toBe("2d ago");
    expect(timeAgo(new Date(NOW.getTime() - 60 * 86_400_000), NOW)).toBe("2mo ago");
    expect(timeAgo(new Date(NOW.getTime() - 400 * 86_400_000), NOW)).toBe("1y ago");
  });

  it("reads a future date (clock skew) as just now, never 'in X'", () => {
    expect(timeAgo(new Date(NOW.getTime() + 600_000), NOW)).toBe("just now");
  });
});

describe("formatRecent", () => {
  it("names the repo in the header when every commit is from one repo", () => {
    const out = formatRecent({ commits: [commit()], now: NOW });
    expect(out).toContain("🕒 <b>Recent commits</b> — <code>o/r</code>");
    expect(out).toContain(
      "<code>a1b2c3d</code> <b>feat</b> add /recent command — octocat, 2h ago",
    );
    // single repo: no per-line repo prefix to waste width
    expect(out).not.toContain("<code>o/r</code> <code>a1b2c3d</code>");
  });

  it("prefixes each line with its repo when the list spans several", () => {
    const out = formatRecent({
      commits: [commit(), commit({ repo: "o/other", sha: "deadbee1234" })],
      now: NOW,
    });
    expect(out).toContain("— 2 repos");
    expect(out).toContain("<code>o/other</code> <code>deadbee</code>");
    expect(out).toContain("<code>o/r</code> <code>a1b2c3d</code>");
  });

  it("withholds the subject of a flagged commit, like formatPush does", () => {
    const out = formatRecent({
      commits: [commit({ secretFlag: true, message: "AWS_KEY=AKIAIOSFODNN7EXAMPLE" })],
      now: NOW,
    });
    expect(out).toContain("🔑 possible secret — subject withheld");
    expect(out).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  it("marks merges and linked issues", () => {
    const out = formatRecent({ commits: [commit({ isMerge: true, issueNumber: 42 })], now: NOW });
    expect(out).toContain("(merge) → #42");
  });

  it("counts the remainder and links the repo when given a url", () => {
    const out = formatRecent({
      commits: [commit()],
      more: 7,
      commitsUrl: "https://github.com/o/r/commits",
      now: NOW,
    });
    expect(out).toContain('<a href="https://github.com/o/r/commits">+7 more</a>');
  });

  it("falls back to plain text when there is no url", () => {
    const out = formatRecent({ commits: [commit()], more: 3, now: NOW });
    expect(out).toContain("+3 more");
    expect(out).not.toContain("<a href");
  });

  it("shows one line per commit, never the whole body", () => {
    const out = formatRecent({
      commits: [commit({ message: "subject line\n\nbody paragraph" })],
      now: NOW,
    });
    expect(out).toContain("subject line");
    expect(out).not.toContain("body paragraph");
  });

  it("escapes user content so Telegram cannot reject the message", () => {
    const out = formatRecent({
      commits: [commit({ message: "fix <script> & co", author: "a&b" })],
      now: NOW,
    });
    expect(out).toContain("fix &lt;script&gt; &amp; co");
    expect(out).toContain("a&amp;b");
  });

  it("keeps unparseable dates honest instead of printing 'Invalid Date'", () => {
    const out = formatRecent({ commits: [commit({ at: null })], now: NOW });
    expect(out).toContain("— octocat");
    expect(out).not.toContain("Invalid");
  });

  it("says so plainly when there is nothing yet", () => {
    expect(formatRecent({ commits: [] })).toBe(
      "🕒 No commits recorded yet for this chat's repos.",
    );
  });

  it("stays inside Telegram's 3800-char cap at the listing limit", () => {
    // cmdRecent asks for at most 10 rows; this is the worst case for width.
    const many = Array.from({ length: 10 }, (_, i) =>
      commit({ sha: String(i).repeat(40), message: "wide ".repeat(60) }),
    );
    expect(formatRecent({ commits: many, more: 900, now: NOW }).length).toBeLessThanOrEqual(3800);
  });
});
