// diff.ts — turn a commit into per-file bodies so scan() and summarize() see
// code instead of only the commit message.
//
// Webhook payloads carry messages, not diffs (worker.ts used to note this as
// "Phase 6"). That left two gaps:
//   * rule 6 — scan() ran on the message, so a key committed in a source file
//     was never detected, which is the one thing this product claims to catch;
//   * rule 7 — the summariser got `diffExcerpt: ""`, capping summary quality
//     at "paraphrase the subject".
//
// Everything here degrades instead of throwing: a failed fetch must never take
// the push pipeline down, it just falls back to message-only behaviour.

import { getInstallationToken, type KeyMaterial } from "../githubAuth.js";
import { trim } from "./trim.js";

export type DiffFile = { path: string; content: string };

/** GitHub caps a commit diff anyway; this just stops a pathological one. */
const MAX_DIFF_CHARS = 512 * 1024;
const FETCH_TIMEOUT_MS = 4000;
/** Rule 7: char-cap is primary. 8 KB of excerpt, total, across files. */
const MAX_EXCERPT_CHARS = 8000;

function stripPrefix(p: string): string {
  return p.replace(/^[ab]\//, "");
}

/** Pure: split a unified diff into per-file bodies. */
export function parseUnifiedDiff(raw: string): DiffFile[] {
  const out: DiffFile[] = [];
  let path: string | null = null;
  let buf: string[] = [];

  const flush = () => {
    if (path) out.push({ path, content: buf.join("\n") });
    path = null;
    buf = [];
  };

  for (const line of String(raw).split("\n")) {
    if (line.startsWith("diff --git ")) {
      flush();
      continue;
    }
    if (line.startsWith("+++ ")) {
      const p = line.slice(4).trim();
      // `+++ /dev/null` means the file was deleted; keep the `---` name.
      if (p !== "/dev/null") path = stripPrefix(p);
      continue;
    }
    if (line.startsWith("--- ")) {
      // Deleted files have `+++ /dev/null`, so keep this as the fallback name.
      const p = line.slice(4).trim();
      if (p !== "/dev/null" && !path) path = stripPrefix(p);
      continue;
    }
    if (path) buf.push(line);
  }
  flush();
  return out;
}

/**
 * Pure: assemble the LLM payload. Files that tripped the secret scan are
 * excluded entirely (rule 6: path only, never the content), the trim()
 * skip-list still applies per file, and the total is capped at 8 KB.
 */
export function buildExcerpt(
  files: DiffFile[],
  exclude: ReadonlySet<string> = new Set(),
  cap = MAX_EXCERPT_CHARS,
): string {
  const parts: string[] = [];
  let total = 0;
  for (const f of files) {
    if (exclude.has(f.path)) continue;
    const t = trim(f.path, f.content);
    if (t.skipped || !t.text.trim()) continue;
    const piece = `--- ${f.path}\n${t.text}`;
    if (total + piece.length > cap) break;
    parts.push(piece);
    total += piece.length;
  }
  return parts.join("\n\n");
}

/** The files whose names may appear in an alert. Never the values. */
export function secretPaths(files: { file: string }[]): string[] {
  return [...new Set(files.map((f) => f.file))];
}

/**
 * Pure: keep only the lines that are entering the repo.
 *
 * A unified diff carries three kinds of line, and only one of them is an
 * event: `+` is entering, `-` is leaving, ` ` is already there. Scanning all
 * three means the commit that *fixes* a leak gets flagged as if it caused one
 * (its removed line still matches), and any commit that happens to touch a
 * hunk near a pre-existing secret gets flagged too. Both are false alarms on
 * the one alert that has to be believed, so the scan sees only additions.
 *
 * The excerpt still gets the whole diff — context is what makes a summary
 * readable; this only narrows what counts as a finding.
 */
export function addedLines(files: DiffFile[]): DiffFile[] {
  return files.map((f) => ({
    path: f.path,
    // Headers are already stripped by parseUnifiedDiff; the +++ guard keeps
    // hand-built inputs from being treated as an addition.
    content: f.content
      .split("\n")
      .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
      .join("\n"),
  }));
}

/**
 * Fetch a commit diff as the installation. Returns "" on any failure — the
 * caller then behaves exactly as it did before diffs were fetched.
 */
export async function fetchCommitDiff(opts: {
  installationId: bigint | number | string;
  keys: KeyMaterial;
  repo: string;
  sha: string;
  deps?: { fetchFn?: typeof fetch };
}): Promise<string> {
  const { installationId, keys, repo, sha, deps = {} } = opts;
  const doFetch = deps.fetchFn ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const token = await getInstallationToken(installationId, keys, deps);
    const res = await doFetch(`https://api.github.com/repos/${repo}/commits/${sha}`, {
      headers: {
        Accept: "application/vnd.github.v3.diff",
        "X-GitHub-Api-Version": "2022-11-28",
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    });
    if (!res.ok) return "";
    const text = await res.text();
    return text.length > MAX_DIFF_CHARS ? text.slice(0, MAX_DIFF_CHARS) : text;
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}
