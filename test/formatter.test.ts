import { describe, expect, it } from "vitest";
import { formatPush } from "../src/formatter.js";

function commits(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    sha: `abc${String(i).padStart(4, "0")}def`,
    message: `feat: thing ${i}`,
    author: i % 2 === 0 ? "Fizan" : "Ahad",
    category: "feat",
  }));
}

describe("formatPush", () => {
  it("stays under 3800 chars on 20-commit push with compare link", () => {
    const html = formatPush({
      repo: "AhadIKK/CommitIt",
      branch: "main",
      commits: commits(20),
      compareUrl: "https://github.com/AhadIKK/CommitIt/compare/a...b",
    });
    expect(html.length).toBeLessThanOrEqual(3800);
    expect(html).toContain("+5 more");
  });

  it("marks a summary as a summary, so it cannot be mistaken for the subject", () => {
    const html = formatPush({
      repo: "r",
      branch: "main",
      commits: [
        {
          sha: "abc1234",
          message: "feat: add the thing",
          author: "Ahad",
          category: "feat",
          aiSummary: "Added the thing and wired it to the endpoint.",
        },
      ],
    });
    expect(html).toContain("🤖 Added the thing and wired it to the endpoint.");
    // The subject is replaced by the summary, not printed alongside it.
    expect(html).not.toContain("feat: add the thing");
  });

  it("shows the subject unmarked when there is no summary", () => {
    const html = formatPush({
      repo: "r",
      branch: "main",
      commits: [{ sha: "abc1234", message: "feat: add the thing", author: "Ahad", category: "feat" }],
    });
    expect(html).toContain("feat: add the thing");
    expect(html).not.toContain("🤖");
  });

  it("ignores a degraded summary, which is only the message repeated", () => {
    const html = formatPush({
      repo: "r",
      branch: "main",
      commits: [
        {
          sha: "abc1234",
          message: "feat: add the thing",
          author: "Ahad",
          category: "feat",
          aiSummary: "feat: add the thing",
          degraded: true,
        },
      ],
    });
    expect(html).toContain("feat: add the thing");
    expect(html).not.toContain("🤖");
  });

  it("escapes HTML in user content", () => {
    const html = formatPush({
      repo: "r",
      branch: "main",
      commits: [
        {
          sha: "abc1234",
          message: "<script>alert(1)</script>",
          author: "<b>evil</b>",
          category: "feat",
        },
      ],
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
