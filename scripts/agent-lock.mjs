#!/usr/bin/env node
// Cross-agent lock, scoped by path, shared by OpenCode and Antigravity.
//
// Two rules shaped this:
//   1. "Read the table, then write it" is a check-then-act race — two agents
//      can both read IDLE and both write LOCKED, and the loser never finds
//      out. So every mutation of the state file happens inside a mutex, and
//      the mutex is a directory (mkdir fails atomically with EEXIST).
//   2. Agents work in parallel on disjoint areas (backend vs dashboard), so an
//      exclusive repo-wide lock would block the very thing it exists to
//      enable. Holders declare the paths they touch and acquisition is refused
//      only on overlap.
//
//   node scripts/agent-lock.mjs status
//   node scripts/agent-lock.mjs acquire --agent OpenCode --task "..." --files "src/**,test/**"
//   node scripts/agent-lock.mjs heartbeat
//   node scripts/agent-lock.mjs release
//   node scripts/agent-lock.mjs note --agent OpenCode --text "..."
//
// Exit codes: 0 = did it, 1 = refused (overlap, or not your lock).
// A holder with no heartbeat for STALE_MS is dropped automatically: a crashed
// agent, or a closed window, must never block the other one forever.

import { mkdirSync, readFileSync, writeFileSync, rmSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const LOCK_DIR = ".agent-lock";
const STATE_FILE = "state.json";
const MUTEX_DIR = ".mutex";
const MUTEX_STALE_MS = 10_000;
const STALE_MS = 20 * 60 * 1000;
const BOARD = "AGENT_SYNC.md";
const NOTE_MARKER = "<!-- notes:start -->";

function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function paths(root) {
  const lockDir = join(root, LOCK_DIR);
  return {
    lockDir,
    statePath: join(lockDir, STATE_FILE),
    mutexDir: join(lockDir, MUTEX_DIR),
    boardPath: join(root, BOARD),
  };
}

function readState(root) {
  const { statePath } = paths(root);
  if (!existsSync(statePath)) return { holders: {} };
  try {
    const parsed = JSON.parse(readFileSync(statePath, "utf8"));
    return parsed && typeof parsed === "object" && parsed.holders ? parsed : { holders: {} };
  } catch {
    return { holders: {} };
  }
}

function writeState(root, state) {
  const { lockDir, statePath } = paths(root);
  mkdirSync(lockDir, { recursive: true });
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function ageOf(iso) {
  const t = Date.parse(iso ?? "");
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : Date.now() - t;
}

/** Drop holders whose heartbeat is too old; returns the names dropped. */
function prune(state) {
  const dropped = [];
  for (const [name, holder] of Object.entries(state.holders)) {
    if (ageOf(holder.heartbeat ?? holder.started) > STALE_MS) {
      delete state.holders[name];
      dropped.push(name);
    }
  }
  return dropped;
}

function sleep(ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    /* tiny spin; only reached while another agent holds the mutex for <10ms */
  }
}

/** Run fn with exclusive access to the state file. */
function withMutex(root, fn) {
  const { lockDir, mutexDir } = paths(root);
  mkdirSync(lockDir, { recursive: true });

  let held = false;
  for (let attempt = 0; attempt < 200 && !held; attempt++) {
    try {
      mkdirSync(mutexDir);
      held = true;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      // A critical section lasts milliseconds; an older one means the holder
      // died inside it. Break it rather than deadlock both agents.
      let age = 0;
      try {
        age = Date.now() - statSync(mutexDir).mtimeMs;
      } catch {
        continue;
      }
      if (age > MUTEX_STALE_MS) rmSync(mutexDir, { recursive: true, force: true });
      else sleep(25);
    }
  }
  if (!held) throw new Error("could not acquire mutex");

  try {
    return fn();
  } finally {
    rmSync(mutexDir, { recursive: true, force: true });
  }
}

/** "src/**", "./src/", "src\\" -> "src"; a file stays a file. */
function normPath(p) {
  let out = String(p).trim().replace(/\\/g, "/").replace(/^\.\//, "");
  out = out.replace(/\/\*{1,2}$/, "").replace(/\/+$/, "");
  out = out.replace(/\*{1,2}$/, "");
  return out.replace(/\/+$/, "");
}

function splitFiles(files) {
  return String(files ?? "")
    .split(",")
    .map(normPath)
    .filter(Boolean);
}

/** Same path, or one contains the other. */
function overlaps(a, b) {
  if (!a || !b) return false;
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

export function status(root = process.cwd()) {
  const state = readState(root);
  const dropped = prune(state);
  const holders = Object.entries(state.holders).map(([agent, h]) => {
    const ageMs = ageOf(h.heartbeat ?? h.started);
    return {
      agent,
      task: h.task,
      files: h.files ?? [],
      started: h.started,
      ageMs,
      // Surfaced because an expired lock is silent for its owner: it just
      // stops protecting them while they are still working.
      expiresInMs: Math.max(0, STALE_MS - ageMs),
    };
  });
  return { state: holders.length ? "LOCKED" : "IDLE", holders, dropped };
}

export function acquire(root, { agent, task, files }) {
  return withMutex(root, () => {
    const state = readState(root);
    const dropped = prune(state);
    const mine = splitFiles(files);
    if (!mine.length) {
      return { ok: false, reason: "declare --files (comma-separated paths) so overlaps are detectable" };
    }

    for (const [name, holder] of Object.entries(state.holders)) {
      if (name === agent) continue;
      const conflict = mine.find((m) => (holder.files ?? []).some((f) => overlaps(m, f)));
      if (conflict) {
        const age = ageOf(holder.heartbeat ?? holder.started);
        return {
          ok: false,
          holder: { ...holder, agent: name, expiresInMs: Math.max(0, STALE_MS - age) },
          conflict,
        };
      }
    }

    const prev = state.holders[agent];
    state.holders[agent] = {
      task: task || prev?.task || "unspecified",
      files: mine,
      started: prev?.started ?? nowIso(),
      heartbeat: nowIso(),
    };
    writeState(root, state);
    return { ok: true, dropped, others: Object.keys(state.holders).filter((n) => n !== agent) };
  });
}

export function heartbeat(root, agent) {
  return withMutex(root, () => {
    const state = readState(root);
    prune(state);
    const holder = state.holders[agent];
    if (!holder) return { ok: false, reason: "you do not hold a lock" };
    holder.heartbeat = nowIso();
    writeState(root, state);
    return { ok: true };
  });
}

export function release(root, agent, force = false) {
  return withMutex(root, () => {
    const state = readState(root);
    prune(state);
    if (!state.holders[agent] && !force) return { ok: false, reason: "you do not hold a lock" };
    const was = state.holders[agent];
    delete state.holders[agent];
    writeState(root, state);
    return { ok: true, released: was };
  });
}

/** Newest-first note in the board's Message Board section. */
export function note(root, agent, text) {
  const { boardPath } = paths(root);
  if (!existsSync(boardPath)) return { ok: false, reason: `${BOARD} missing` };
  const oneLine = String(text).replace(/\s+/g, " ").trim();
  if (!oneLine) return { ok: false, reason: "empty note" };
  const line = `- **${agent}** (${nowIso()}): ${oneLine}`;
  const src = readFileSync(boardPath, "utf8");
  const idx = src.indexOf(NOTE_MARKER);
  if (idx === -1) return { ok: false, reason: `marker ${NOTE_MARKER} missing` };
  const at = idx + NOTE_MARKER.length;
  writeFileSync(boardPath, `${src.slice(0, at)}\n${line}${src.slice(at)}`, "utf8");
  return { ok: true };
}

// ---------------------------------------------------------------- CLI

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    } else {
      out._.push(argv[i]);
    }
  }
  return out;
}

function humanAge(ms) {
  const m = Math.round(ms / 60000);
  return m < 1 ? `${Math.round(ms / 1000)}s` : `${m}m`;
}

/** Heartbeat warning threshold: a lock this close to expiring is about to fail. */
const EXPIRING_MS = 5 * 60 * 1000;

function expiry(holder) {
  if (holder.expiresInMs <= EXPIRING_MS) {
    return `  EXPIRING in ${humanAge(holder.expiresInMs)} — heartbeat now or it is dropped`;
  }
  return `  expires in ${humanAge(holder.expiresInMs)} unless heartbeat`;
}

// pathToFileURL, not string concat: on Windows import.meta.url is file:///C:/…
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  const root = resolve(args.root || process.cwd());
  const agent = args.agent || process.env.AGENT_NAME || "unknown-agent";

  switch (cmd) {
    case "status": {
      const s = status(root);
      if (s.state === "IDLE") {
        console.log("IDLE — nothing held. Anything that overlaps nobody is fair game.");
        process.exit(0);
      }
      console.log(`${s.holders.length} holder(s):`);
      for (const h of s.holders) {
        console.log(`  ${h.agent} (${humanAge(h.ageMs)})  files: ${h.files.join(", ") || "?"}`);
        console.log(`    task: ${h.task ?? "?"}  since ${h.started ?? "?"}`);
        console.log(expiry(h));
      }
      process.exit(0);
      break;
    }
    case "acquire": {
      const r = acquire(root, { agent, task: args.task, files: args.files });
      if (!r.ok) {
        if (r.reason) {
          console.log(`REFUSED — ${r.reason}.`);
        } else {
          console.log(`REFUSED — ${r.holder?.agent ?? "another agent"} holds ${r.conflict}.`);
          console.log(`  task:  ${r.holder?.task ?? "?"}`);
          console.log(`  files: ${(r.holder?.files ?? []).join(", ")}`);
          if (typeof r.holder?.expiresInMs === "number") {
            console.log(`  drops in ${humanAge(r.holder.expiresInMs)} if they stop heartbeating`);
          }
          console.log("Pick paths that do not overlap, or stop and tell the user.");
        }
        process.exit(1);
      }
      if (r.dropped?.length) console.log(`ACQUIRED — dropped stale holder(s): ${r.dropped.join(", ")}.`);
      else console.log("ACQUIRED — you hold your declared paths.");
      if (r.others?.length) console.log(`  also working: ${r.others.join(", ")} (disjoint paths)`);
      console.log("  Heartbeat every ~15m: after 20m the lock drops itself, silently.");
      process.exit(0);
      break;
    }
    case "heartbeat": {
      const r = heartbeat(root, agent);
      console.log(r.ok ? "HEARTBEAT ok." : `REFUSED — ${r.reason}.`);
      process.exit(r.ok ? 0 : 1);
      break;
    }
    case "release": {
      const r = release(root, agent, Boolean(args.force));
      console.log(r.ok ? "RELEASED." : `REFUSED — ${r.reason}.`);
      process.exit(r.ok ? 0 : 1);
      break;
    }
    case "note": {
      const r = note(root, agent, args.text ?? "");
      console.log(r.ok ? "NOTE added." : `REFUSED — ${r.reason}.`);
      process.exit(r.ok ? 0 : 1);
      break;
    }
    default:
      console.log("usage: agent-lock.mjs <status|acquire|heartbeat|release|note> [--flags]");
      process.exit(2);
  }
}
