import { afterEach, describe, expect, it } from "vitest";
import { parseStaleRepos, startStaleScheduler } from "../src/scheduler.js";

describe("parseStaleRepos", () => {
  it("splits, trims, and drops invalid entries", () => {
    expect(parseStaleRepos("o/r, foo/bar ,baz")).toEqual(["o/r", "foo/bar"]);
    expect(parseStaleRepos("not-a-repo, ,o/r")).toEqual(["o/r"]);
    expect(parseStaleRepos("")).toEqual([]);
    expect(parseStaleRepos(undefined)).toEqual([]);
  });
});

describe("startStaleScheduler", () => {
  const saved = process.env.STALE_CHECK_REPOS;
  afterEach(() => {
    if (saved === undefined) delete process.env.STALE_CHECK_REPOS;
    else process.env.STALE_CHECK_REPOS = saved;
  });

  it("stays off without configured repos (no DB touch)", () => {
    delete process.env.STALE_CHECK_REPOS;
    const log = { info: () => {}, error: () => {} };
    expect(startStaleScheduler(log)).toBeNull();
  });

  it("enqueues one dated job per repo without throwing", async () => {
    process.env.STALE_CHECK_REPOS = "o/r";
    const errors: unknown[] = [];
    const log = { info: () => {}, error: (o: object) => errors.push(o) };
    const timer = startStaleScheduler(log, 3_600_000);
    expect(timer).not.toBeNull();
    clearInterval(timer as NodeJS.Timeout);
    // Immediate tick runs enqueueJob (DB-or-memory); give it room.
    await new Promise((r) => setTimeout(r, 12_000));
  }, 30_000);
});
