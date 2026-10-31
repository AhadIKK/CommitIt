#!/usr/bin/env node
// Atomic cross-agent lock, shared by OpenCode and Antigravity.
//
// Why a script instead of a markdown table: "read the table, then write it"
// is a check-then-act race — two agents can both read IDLE and both write
// LOCKED, and the loser never finds out. `mkdir` is atomic on Windows and
// POSIX (it fails with EEXIST), so the directory itself is the lock and the
// owner file is only a description of who holds it.
//
//   node scripts/agent-lock.mjs status
//   node scripts/agent-lock.mjs acquire --agent OpenCode --task "..." --files "a.ts,b.ts"
//   node scripts/agent-lock.mjs heartbeat
//   node scripts/agent-lock.mjs release
//   node scripts/agent-lock.mjs note --agent OpenCode --text "..."
//
// Exit codes: 0 = did it, 1 = refused (someone else holds the lock).
// A lock older than STALE_MS is reclaimable: an agent that crashed or a
// closed window must never block the other one forever.

import { mkdirSync, readFileSync, writeFileSync, rmSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const LOCK_DIR = ".agent-lock";
const OWNER_FILE = "owner.md";
const STALE_MS = 20 * 60 * 1000;
const BOARD = "AGENT_SYNC.md";
const NOTE_MARKER = "<!-- notes:start -->";

function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function paths(root) {
  const lockDir = join(root, LOCK_DIR);
  return { lockDir, ownerPath: join(lockDir, OWNER_FILE), boardPath: join(root, BOARD) };
}

function readOwner(ownerPath) {
  if (!existsSync(ownerPath)) return null;
  const out = {};
  for (const line of readFileSync(ownerPath, "utf8").split(/\r?\n/)) {
    const m = /^([a-z]+):\s*(.*)$/i.exec(line.trim());
    if (m) out[m[1].toLowerCase()] = m[2].trim();
  }
  return out;
}

/** Age of the lock in ms, from the owner file (or the dir, mid-acquire). */
function lockAge(root) {
  const { lockDir, ownerPath } = paths(root);
  const target = existsSync(ownerPath) ? ownerPath : lockDir;
  try {
    return Date.now() - statSync(target).mtimeMs;
  } catch {
    return 0;
  }
}

export function status(root = process.cwd()) {
  const { lockDir, ownerPath } = paths(root);
  if (!existsSync(lockDir)) return { state: "IDLE" };
  const ageMs = lockAge(root);
  return { state: "LOCKED", owner: readOwner(ownerPath), ageMs, stale: ageMs > STALE_MS };
}

export function acquire(root, { agent, task, files }) {
  const { lockDir, ownerPath } = paths(root);
  const write = () => {
    const at = nowIso();
    const body =
      `agent: ${agent}\n` +
      `task: ${task || "unspecified"}\n` +
      `files: ${files || "unspecified"}\n` +
      `started: ${at}\n` +
      `heartbeat: ${at}\n`;
    writeFileSync(ownerPath, body, "utf8");
  };

  try {
    mkdirSync(lockDir);
    write();
    return { ok: true, reclaimedFrom: null };
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
  }

  // Held. Only take it if it is stale — otherwise this is a real conflict.
  const ageMs = lockAge(root);
  const holder = readOwner(ownerPath);
  if (ageMs <= STALE_MS) {
    return { ok: false, holder, ageMs };
  }
  rmSync(lockDir, { recursive: true, force: true });
  mkdirSync(lockDir);
  write();
  return { ok: true, reclaimedFrom: holder?.agent ?? "unknown", ageMs };
}

export function heartbeat(root, agent) {
  const { ownerPath } = paths(root);
  const owner = readOwner(ownerPath);
  if (!owner) return { ok: false, reason: "no lock" };
  if (agent && owner.agent !== agent) return { ok: false, reason: `held by ${owner.agent}` };
  const body = readFileSync(ownerPath, "utf8").replace(/^heartbeat:.*$/m, `heartbeat: ${nowIso()}`);
  writeFileSync(ownerPath, body, "utf8");
  return { ok: true, owner };
}

export function release(root, agent, force = false) {
  const { lockDir, ownerPath } = paths(root);
  const owner = readOwner(ownerPath);
  if (!existsSync(lockDir)) return { ok: false, reason: "no lock" };
  if (!force && agent && owner?.agent !== agent) {
    return { ok: false, reason: `held by ${owner?.agent ?? "unknown"}` };
  }
  rmSync(lockDir, { recursive: true, force: true });
  return { ok: true, owner };
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
        console.log("IDLE — no agent holds the lock.");
        process.exit(0);
      }
      const who = s.owner?.agent ?? "unknown";
      console.log(
        `LOCKED by ${who} (${humanAge(s.ageMs)}${s.stale ? ", STALE — reclaimable" : ""})`,
      );
      console.log(`  task:  ${s.owner?.task ?? "?"}`);
      console.log(`  files: ${s.owner?.files ?? "?"}`);
      console.log(`  since: ${s.owner?.started ?? "?"}`);
      process.exit(0);
      break;
    }
    case "acquire": {
      const r = acquire(root, { agent, task: args.task, files: args.files });
      if (!r.ok) {
        console.log(
          `REFUSED — ${r.holder?.agent ?? "unknown"} holds the lock (${humanAge(r.ageMs)}).`,
        );
        console.log(`  task:  ${r.holder?.task ?? "?"}`);
        console.log(`  files: ${r.holder?.files ?? "?"}`);
        console.log("Stop and tell the user; do not edit those files.");
        process.exit(1);
      }
      if (r.reclaimedFrom) {
        console.log(`ACQUIRED — reclaimed a stale lock from ${r.reclaimedFrom}.`);
      } else {
        console.log("ACQUIRED — you hold the lock.");
      }
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
