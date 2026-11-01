import { describe, expect, it, vi } from "vitest";
import { addedLines, buildExcerpt, fetchCommitDiff, parseUnifiedDiff, secretPaths } from "../src/brain/diff.js";
import { scan } from "../src/brain/scan.js";

vi.mock("../src/githubAuth.js", () => ({
  getInstallationToken: vi.fn(async () => "tok"),
}));

const TWO_FILES = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 111..222 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,2 +1,3 @@",
  " const x = 1;",
  "-const y = 2;",
  "+const y = 3;",
  "+const z = 4;",
  "diff --git a/src/b.ts b/src/b.ts",
  "index 333..444 100644",
  "--- a/src/b.ts",
  "+++ b/src/b.ts",
  "@@ -1 +1 @@",
  "-old",
  "+new",
].join("\n");

describe("parseUnifiedDiff", () => {
  it("splits per file and strips the a/ b/ prefixes", () => {
    const files = parseUnifiedDiff(TWO_FILES);
    expect(files.map((f) => f.path)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(files[0].content).toContain("+const z = 4;");
    expect(files[1].content).toContain("+new");
    // Header lines are not part of the body that would reach the model.
    expect(files[0].content).not.toContain("index 111..222");
  });

  it("names a deleted file from the --- side, since +++ is /dev/null", () => {
    const raw = [
      "diff --git a/src/gone.ts b/src/gone.ts",
      "deleted file mode 100644",
      "--- a/src/gone.ts",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-const secret = 'x';",
    ].join("\n");
    const files = parseUnifiedDiff(raw);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("src/gone.ts");
  });

  it("returns nothing for input with no diff headers", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
    expect(parseUnifiedDiff("just some text")).toEqual([]);
  });
});

describe("addedLines", () => {
  // Built at runtime on purpose: written literally, this fixture would itself
  // trip scan() and fire a false secret alert on any push touching this file.
  const FAKE_AWS_KEY = "AKIA" + "IOSFODNN7EXAMPLE";

  it("flags a secret that is being added", () => {
    const files = parseUnifiedDiff(
      [
        "diff --git a/src/config.ts b/src/config.ts",
        "--- a/src/config.ts",
        "+++ b/src/config.ts",
        "@@ -1 +1,2 @@",
        "+const key = 'AKIA" + "IOSFODNN7EXAMPLE';",
      ].join("\n"),
    );
    expect(scan(addedLines(files)).hasSecret).toBe(true);
  });

  it("does not flag the commit that removes a secret", () => {
    // This is the shape of 6e14dd4: the fix that deletes the literal. The
    // removed line still matches the pattern, but nothing is entering the repo.
    const files = parseUnifiedDiff(
      [
        "diff --git a/src/config.ts b/src/config.ts",
        "--- a/src/config.ts",
        "+++ b/src/config.ts",
        "@@ -1 +1 @@",
        "-const key = 'AKIA" + "IOSFODNN7EXAMPLE';",
        "+const key = process.env.KEY;",
      ].join("\n"),
    );
    expect(scan(files).hasSecret).toBe(true); // old behaviour: flagged
    expect(scan(addedLines(files)).hasSecret).toBe(false); // new: not an event
  });

  it("does not flag an unchanged context line that already held a secret", () => {
    const files = parseUnifiedDiff(
      [
        "diff --git a/src/config.ts b/src/config.ts",
        "--- a/src/config.ts",
        "+++ b/src/config.ts",
        "@@ -1,3 +1,3 @@",
        " const key = 'AKIA" + "IOSFODNN7EXAMPLE';",
        "-const debug = false;",
        "+const debug = true;",
      ].join("\n"),
    );
    expect(scan(addedLines(files)).hasSecret).toBe(false);
  });
});

describe("buildExcerpt", () => {
  const FAKE_AWS_KEY = "AKIA" + "IOSFODNN7EXAMPLE";

  it("excludes files that tripped the secret scan, keeping the path out of the payload", () => {
    const files = parseUnifiedDiff(
      [
        "diff --git a/.env b/.env",
        "--- a/.env",
        "+++ b/.env",
        `+AWS_KEY=${FAKE_AWS_KEY}`,
        "diff --git a/src/ok.ts b/src/ok.ts",
        "--- a/src/ok.ts",
        "+++ b/src/ok.ts",
        "+export const ok = true;",
      ].join("\n"),
    );

    const hits = scan(files);
    expect(hits.hasSecret).toBe(true);
    expect(secretPaths(hits.hits)).toEqual([".env"]);

    const excerpt = buildExcerpt(files, new Set(secretPaths(hits.hits)));
    expect(excerpt).toContain("src/ok.ts");
    expect(excerpt).not.toContain(".env");
    expect(excerpt).not.toContain(FAKE_AWS_KEY);
  });

  it("caps the whole payload at 8 KB even with many files", () => {
    const files = Array.from({ length: 20 }, (_, i) => ({
      path: `src/f${i}.ts`,
      content: `+${"x".repeat(900)}`,
    }));
    const excerpt = buildExcerpt(files, new Set());
    expect(excerpt.length).toBeLessThanOrEqual(8000);
    expect(excerpt).toContain("src/f0.ts");
  });

  it("still honours the trim() skip-list for lockfiles and binaries", () => {
    const files = [
      { path: "package-lock.json", content: '{"lockfileVersion": 3}' },
      { path: "assets/logo.png", content: "binary-ish" },
      { path: "src/real.ts", content: "+const a = 1;" },
    ];
    const excerpt = buildExcerpt(files, new Set());
    expect(excerpt).toContain("src/real.ts");
    expect(excerpt).not.toContain("package-lock.json");
    expect(excerpt).not.toContain("logo.png");
  });
});

describe("fetchCommitDiff", () => {
  const keys = { appId: "1", privateKeyPem: "pem" };

  it("asks GitHub for the diff media type and returns the body", async () => {
    const fetchFn = vi.fn(async () => new Response(TWO_FILES, { status: 200 }));
    const out = await fetchCommitDiff({
      installationId: 42n,
      keys,
      repo: "o/r",
      sha: "abc123",
      deps: { fetchFn: fetchFn as unknown as typeof fetch },
    });

    expect(out).toContain("diff --git a/src/a.ts");
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/o/r/commits/abc123");
    expect((init.headers as Record<string, string>).Accept).toBe("application/vnd.github.v3.diff");
  });

  it("returns empty rather than throwing when GitHub refuses", async () => {
    const fetchFn = vi.fn(async () => new Response("nope", { status: 404 }));
    const out = await fetchCommitDiff({
      installationId: 42n,
      keys,
      repo: "o/r",
      sha: "abc",
      deps: { fetchFn: fetchFn as unknown as typeof fetch },
    });
    expect(out).toBe("");
  });

  it("returns empty rather than throwing when the network dies", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    const out = await fetchCommitDiff({
      installationId: 42n,
      keys,
      repo: "o/r",
      sha: "abc",
      deps: { fetchFn: fetchFn as unknown as typeof fetch },
    });
    expect(out).toBe("");
  });
});
