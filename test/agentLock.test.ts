import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The lock decides whether two agents may work at once, so it is tested like
// product code: its failure modes are silent, and a buggy lock is worse than
// none because both agents would believe they were safe.

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

function statePath() {
  return join(root, ".agent-lock", "state.json");
}

function readState() {
  return JSON.parse(readFileSync(statePath(), "utf8")) as {
    holders: Record<string, { task: string; files: string[]; started: string; heartbeat: string }>;
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "agent-lock-"));
  writeFileSync(join(root, "AGENT_SYNC.md"), BOARD, "utf8");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("agent-lock", () => {
  it("acquires, reports the holder and its paths, then releases", () => {
    expect(run("status").out).toContain("IDLE");

    const got = run("acquire", "--agent", "OpenCode", "--task", "backfill", "--files", "src/**,test/**");
    expect(got.code).toBe(0);
    expect(got.out).toContain("ACQUIRED");

    const held = run("status").out;
    expect(held).toContain("OpenCode");
    expect(held).toContain("src, test");

    expect(run("release", "--agent", "OpenCode").code).toBe(0);
    expect(run("status").out).toContain("IDLE");
    expect(readState().holders).toEqual({});
  });

  it("lets two agents work at once when their paths are disjoint", () => {
    expect(run("acquire", "--agent", "OpenCode", "--task", "backend", "--files", "src/**,test/**").code).toBe(0);

    const parallel = run("acquire", "--agent", "Antigravity", "--task", "frontend", "--files", "dashboard/**");
    expect(parallel.code).toBe(0);
    expect(parallel.out).toContain("ACQUIRED");
    expect(parallel.out).toContain("also working: OpenCode");

    const holders = readState().holders;
    expect(Object.keys(holders).sort()).toEqual(["Antigravity", "OpenCode"]);
  });

  it("refuses an overlapping scope without disturbing the holder", () => {
    run("acquire", "--agent", "OpenCode", "--task", "backend", "--files", "src/**");

    const refused = run("acquire", "--agent", "Antigravity", "--task", "tweak formatter", "--files", "src/formatter.ts");
    expect(refused.code).toBe(1);
    expect(refused.out).toContain("REFUSED");
    expect(refused.out).toContain("src/formatter.ts");

    expect(readState().holders.OpenCode.task).toBe("backend");
    expect(readState().holders.Antigravity).toBeUndefined();
  });

  it("treats a parent directory as overlapping its children", () => {
    run("acquire", "--agent", "OpenCode", "--task", "wide", "--files", "src/**");
    expect(run("acquire", "--agent", "Antigravity", "--task", "narrow", "--files", "src/brain/scan.ts").code).toBe(1);
  });

  it("drops a holder that stopped heartbeating, so a crashed agent cannot block", () => {
    run("acquire", "--agent", "OpenCode", "--task", "crashed", "--files", "src/**");

    const state = readState();
    const old = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    state.holders.OpenCode.heartbeat = old;
    writeFileSync(statePath(), JSON.stringify(state), "utf8");

    const took = run("acquire", "--agent", "Antigravity", "--task", "next", "--files", "src/**");
    expect(took.code).toBe(0);
    expect(took.out).toContain("stale holder(s): OpenCode");
    expect(Object.keys(readState().holders)).toEqual(["Antigravity"]);
  });

  it("requires a path scope, because an unscoped lock cannot be checked", () => {
    const got = run("acquire", "--agent", "OpenCode", "--task", "vague");
    expect(got.code).toBe(1);
    expect(got.out).toContain("--files");
  });

  it("says who it is when an identity is missing, instead of blaming the lock", () => {
    run("acquire", "--agent", "OpenCode", "--task", "mine", "--files", "src/**");
    const anon = run("heartbeat");
    expect(anon.code).toBe(2);
    expect(anon.out).toContain("--agent");
    expect(anon.out).not.toContain("you do not hold a lock");
  });

  it("lets only the holder heartbeat or release", () => {
    run("acquire", "--agent", "OpenCode", "--task", "mine", "--files", "src/**");

    expect(run("heartbeat", "--agent", "Antigravity").code).toBe(1);
    expect(run("release", "--agent", "Antigravity").code).toBe(1);
    expect(readState().holders.OpenCode).toBeDefined();

    expect(run("heartbeat", "--agent", "OpenCode").code).toBe(0);
    expect(run("release", "--agent", "OpenCode").code).toBe(0);
  });

  it("shows how long a holder has left, so a silent expiry is visible", () => {
    run("acquire", "--agent", "OpenCode", "--task", "long job", "--files", "src/**");
    const shown = run("status").out;
    expect(shown).toMatch(/expires in \d+m/);

    // 18 minutes in, a 20-minute lock is two minutes from vanishing without a
    // word; status has to say so rather than keep printing "LOCKED".
    const state = readState();
    state.holders.OpenCode.heartbeat = new Date(Date.now() - 18 * 60 * 1000).toISOString();
    writeFileSync(statePath(), JSON.stringify(state), "utf8");
    expect(run("status").out).toContain("EXPIRING");
  });

  it("posts notes newest-first without disturbing holders", () => {
    run("acquire", "--agent", "OpenCode", "--task", "mine", "--files", "src/**");
    expect(run("note", "--agent", "OpenCode", "--text", "first note").code).toBe(0);
    expect(run("note", "--agent", "Antigravity", "--text", "second\nnote").code).toBe(0);

    const board = readFileSync(join(root, "AGENT_SYNC.md"), "utf8");
    expect(board.indexOf("second note")).toBeLessThan(board.indexOf("first note"));
    expect(board).toContain("**Antigravity**");
    expect(readState().holders.OpenCode).toBeDefined();
  });
});
