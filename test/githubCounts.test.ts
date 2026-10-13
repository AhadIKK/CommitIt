import { describe, expect, it, vi } from "vitest";
import {
  clearCountCache,
  getMainBranchCommitCount,
  parseLastPage,
} from "../src/githubCounts.js";

function jsonRes(body: unknown, status = 200, link: string | null = null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: link ? { link } : {},
  });
}

describe("parseLastPage", () => {
  it("reads the last page from a Link header", () => {
    expect(
      parseLastPage(
        '<https://api.github.com/repositories/1/commits?sha=main&per_page=1&page=2>; rel="next", <https://api.github.com/repositories/1/commits?sha=main&per_page=1&page=53>; rel="last"',
      ),
    ).toBe(53);
  });
  it("returns null without a last rel", () => {
    expect(parseLastPage(null)).toBeNull();
    expect(parseLastPage('<https://x?page=2>; rel="next"')).toBeNull();
    expect(parseLastPage("garbage")).toBeNull();
  });
});

describe("getMainBranchCommitCount", () => {
  it("counts via Link header using the known default branch", async () => {
    clearCountCache();
    const fetchFn = vi.fn(async (url: string | URL | Request) =>
      jsonRes([{ sha: "a" }], 200, '<https://x?page=53>; rel="last"'),
    );
    const out = await getMainBranchCommitCount("o/r", {
      defaultBranch: "main",
      fetchFn: fetchFn as typeof fetch,
    });
    expect(out).toEqual({ count: 53, defaultBranch: "main" });
    expect(fetchFn).toHaveBeenCalledTimes(1); // no repo lookup needed
  });

  it("resolves the default branch then counts", async () => {
    clearCountCache();
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const target = url.toString();
      if (target === "https://api.github.com/repos/o/r") {
        return jsonRes({ default_branch: "master" });
      }
      return jsonRes([{ sha: "a" }], 200, '<https://x?page=7>; rel="last"');
    });
    const out = await getMainBranchCommitCount("o/r", { fetchFn: fetchFn as typeof fetch });
    expect(out).toEqual({ count: 7, defaultBranch: "master" });
  });

  it("handles single-page repos via the body", async () => {
    clearCountCache();
    const fetchFn = vi.fn(async () => jsonRes([{ sha: "a" }]));
    const out = await getMainBranchCommitCount("o/r", {
      defaultBranch: "main",
      fetchFn: fetchFn as typeof fetch,
    });
    expect(out).toEqual({ count: 1, defaultBranch: "main" });
  });

  it("degrades to null on GitHub errors", async () => {
    clearCountCache();
    const fetchFn = vi.fn(async () => new Response("nope", { status: 404 }));
    const out = await getMainBranchCommitCount("o/r", {
      defaultBranch: "main",
      fetchFn: fetchFn as typeof fetch,
    });
    expect(out).toEqual({ count: null, defaultBranch: "main" });
  });

  it("caches within the TTL", async () => {
    clearCountCache();
    const fetchFn = vi.fn(async () => jsonRes([{ sha: "a" }], 200, '<https://x?page=9>; rel="last"'));
    const opts = { defaultBranch: "main", fetchFn: fetchFn as typeof fetch, nowMs: 1_000 };
    await expect(getMainBranchCommitCount("o/r", opts)).resolves.toEqual({
      count: 9,
      defaultBranch: "main",
    });
    await expect(
      getMainBranchCommitCount("o/r", { ...opts, nowMs: 2_000 }),
    ).resolves.toEqual({ count: 9, defaultBranch: "main" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
