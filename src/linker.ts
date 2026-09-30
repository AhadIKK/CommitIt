import { suggestLink } from "./brain/suggest.js";

// linkCommit(): closes #N (strong) > #N/branch (weak) > PR inherit >
// heuristic suggest as Unlinked work. Never auto-assigns the suggestion.

export type LinkResult =
  | { kind: "strong"; issue: number }
  | { kind: "weak"; issue: number }
  | { kind: "pr"; issue: number }
  | { kind: "suggest"; issue: number }
  | { kind: "unlinked" };

const STRONG_RE = /clos(?:e|es|ed|ing)\s+#(\d+)/i;
const WEAK_RE = /(?:^|\s)#(\d+)\b/;
const BRANCH_RE = /(?:^|[/-])(\d{1,5})(?:[-/]|$)/;

export function linkCommit(opts: {
  message: string;
  branch: string;
  prLinkedIssues?: number[];
  openIssues?: { number: number; title: string }[];
}): LinkResult {
  const strong = STRONG_RE.exec(opts.message);
  if (strong) return { kind: "strong", issue: Number(strong[1]) };

  const weak = WEAK_RE.exec(opts.message);
  if (weak) return { kind: "weak", issue: Number(weak[1]) };

  const branchHit = BRANCH_RE.exec(opts.branch);
  if (branchHit) {
    const n = Number(branchHit[1]);
    if (opts.openIssues?.some((i) => i.number === n)) {
      return { kind: "weak", issue: n };
    }
  }

  if (opts.prLinkedIssues?.length) {
    return { kind: "pr", issue: opts.prLinkedIssues[0] as number };
  }

  const suggestion = suggestLink(
    opts.message,
    opts.branch,
    opts.openIssues ?? [],
  );
  if (suggestion !== null) return { kind: "suggest", issue: suggestion };
  return { kind: "unlinked" };
}
