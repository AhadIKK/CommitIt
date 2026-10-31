import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The lock is what stops two agents editing the same file, so it gets tested
// like product code: the failure mode is silent, and a buggy lock is worse
// than no lock because both agents would believe they were safe.

const SCRIPT = join(process.cwd(), "scripts", "agent-lock.mjs");
const BOARD = [
  "# AGENT_SYNC.md",
  "",
  "## Message Board",
  "<!-- notes:start -->",
  "",
  "## Handoff & Activity Log",
  "",
].join("\n");

let root: string;

function run(...args: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args, "--root", root], { encoding: "utf8" });
  return { code: r.status, out: `${r.stdout}${r.stderr}`.trim() };
}

function lockExists() {
  return existsSync(join(root, ".agent-lock", "owner.md"));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "agent-lock-"));
  writeFileSync(join(root, "AGENT_SYNC.md"), BOARD, "utf8");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("agent-lock", () => {
  it("acquires, reports the holder, and releases", () => {
    expect(run("status").out).toContain("IDLE");

    const got = run("acquire", "--agent", "OpenCode", "--task", "t", "--files", "a.ts");
    expect(got.code).toBe(0);
    expect(got.out).toContain("ACQUIRED");

    const held = run("status").out;
    expect(held).toContain("LOCKED by OpenCode");
    expect(held).toContain("files: a.ts");

    expect(run("release", "--agent", "OpenCode").code).toBe(0);
    expect(run("status").out).toContain("IDLE");
    expect(lockExists()).toBe(false);
  });

  it("refuses the second agent instead of letting it overwrite the holder", () => {
    run("acquire", "--agent", "OpenCode", "--task", "first", "--files", "a.ts");

    const refused = run("acquire", "--agent", "Antigravity", "--task", "second", "--files", "b.ts");
    expect(refused.code).toBe(1);
    expect(refused.out).toContain("REFUSED");
    expect(refused.out).toContain("OpenCode");

    // The holder is untouched — that is the whole point of the atomic mkdir.
    const owner = readFileSync(join(root, ".agent-lock", "owner.md"), "utf8");
    expect(owner).toContain("agent: OpenCode");
    expect(owner).toContain("task: first");
  });

  it("reclaims a lock left behind by a crashed agent", () => {
    run("acquire", "--agent", "OpenCode", "--task", "crashed");
    const old = new Date(Date.now() - 31 * 60 * 1000);
    utimesSync(join(root, ".agent-lock", "owner.md"), old, old);

    expect(run("status").out).toContain("STALE");

    const took = run("acquire", "--agent", "Antigravity", "--task", "next");
    expect(took.code).toBe(0);
    expect(took.out).toContain("reclaimed");
    expect(run("status").out).toContain("LOCKED by Antigravity");
  });

  it("lets only the holder heartbeat or release", () => {
    run("acquire", "--agent", "OpenCode", "--task", "mine");

    expect(run("heartbeat", "--agent", "Antigravity").code).toBe(1);
    expect(run("release", "--agent", "Antigravity").code).toBe(1);
    expect(lockExists()).toBe(true);

    expect(run("heartbeat", "--agent", "OpenCode").code).toBe(0);
    expect(run("release", "--agent", "OpenCode").code).toBe(0);
  });

  it("posts notes newest-first without touching the lock", () => {
    run("acquire", "--agent", "OpenCode", "--task", "mine");
    expect(run("note", "--agent", "OpenCode", "--text", "first note").code).toBe(0);
    expect(run("note", "--agent", "Antigravity", "--text", "second\nnote").code).toBe(0);

    const board = readFileSync(join(root, "AGENT_SYNC.md"), "utf8");
    expect(board.indexOf("second note")).toBeLessThan(board.indexOf("first note"));
    expect(board).toContain("**Antigravity**");
    expect(lockExists()).toBe(true);
  });
});
