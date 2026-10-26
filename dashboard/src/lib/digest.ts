/**
 * The digest message, rendered exactly as it would be sent.
 *
 * One renderer serves the Digests preview and the landing demonstration, so the
 * preview cannot drift from the real thing. Caps are Telegram's (AGENTS.md
 * rule 8): 3 800 characters, ~15 commits, then "+N more + compare link", and a
 * single push of more than 10 commits is always collapsed.
 */
import type { Author, Commit, DigestMode, Milestone } from "../api/types.js";
import { clockTime, shortSha } from "./format.js";
import { progressSentence } from "./weight.js";

export const DIGEST_CHAR_LIMIT = 3800;
export const DIGEST_COMMIT_CAP = 15;
export const DIGEST_PUSH_COLLAPSE_AT = 10;

export const DIGEST_MODE_LABEL: Record<DigestMode, string> = {
  instant: "instant",
  hourly: "hourly digest",
  daily: "daily digest",
  weekly: "weekly digest",
};

export type DigestInput = {
  repoFullName: string;
  mode: DigestMode;
  /** When the message goes out. */
  at: string;
  milestone: Milestone | null;
  groups: Array<{ author: Author; commits: Commit[] }>;
  /** e.g. https://github.com/owner/name/compare/abc...def */
  compareLink?: string;
  now?: Date;
};

export type DigestRender = {
  text: string;
  charCount: number;
  charLimit: number;
  truncated: boolean;
  /** Commits that became "+N more". */
  omitted: number;
  /** True when the 15-commit cap or the 10-commit push collapse changed anything. */
  collapsed: boolean;
};

function clean(message: string): string {
  return message.replace(/\s+/g, " ").trim();
}

/**
 * "feat" is padded so the subjects line up in a column, but the separator is
 * always its own space: a category that is already 5+ characters wide
 * ("chore", "other", "refactor") would otherwise run straight into the subject
 * and read as "choreupdate" in the message someone actually receives.
 */
function commitLine(commit: Commit): string {
  const tag = commit.category.padEnd(5, " ");
  return `  ${tag} ${clean(commit.message)}  ${shortSha(commit.sha)}  ${
    commit.issueNumber ? `Task ${commit.issueNumber}` : "Unlinked"
  }`;
}

function plural(n: number, one: string): string {
  return n === 1 ? `1 ${one}` : `${n} ${one}s`;
}

/**
 * Build the message, then shrink it until it fits: drop the newest kept lines
 * first (the oldest are the ones a person already saw), and hard-clip as the
 * last resort, so the result is never longer than the limit.
 */
export function renderDigest(input: DigestInput): DigestRender {
  const now = input.now ?? new Date();
  const header = `${input.repoFullName} · ${DIGEST_MODE_LABEL[input.mode]} · ${clockTime(input.at)}`;
  const sentence = input.milestone ? progressSentence(input.milestone, now) : null;
  const groups = input.groups.filter((g) => g.commits.length > 0);

  // A push bigger than 10 commits is one line, never ten.
  const collapsedGroups = groups.filter((g) => g.commits.length > DIGEST_PUSH_COLLAPSE_AT);
  const plain = groups
    .filter((g) => g.commits.length <= DIGEST_PUSH_COLLAPSE_AT)
    .flatMap((g) => g.commits.map((c) => ({ author: g.author, commit: c })));

  const collapsedTrue = collapsedGroups.length > 0 || plain.length > DIGEST_COMMIT_CAP;
  // Only commits that lose their own line are "left out": a collapsed push keeps
  // its place in the message as a single line, so it is never counted as omitted.
  let keep = Math.min(plain.length, DIGEST_COMMIT_CAP);
  let omitted = plain.length - keep;

  const build = (kept: number, leftOut: number): string => {
    const lines: string[] = [header];
    if (sentence) lines.push("", sentence);

    const keptShas = new Set(plain.slice(0, kept).map((x) => x.commit.sha));
    for (const g of groups) {
      const isCollapsed = g.commits.length > DIGEST_PUSH_COLLAPSE_AT;
      if (isCollapsed) {
        const branch = g.commits[0]?.branch ?? "main";
        lines.push(
          "",
          `${g.author.login}, ${plural(g.commits.length, "commit")}`,
          `  ${plural(g.commits.length, "commit")} pushed to ${branch}`,
        );
        continue;
      }
      const rows = g.commits.filter((c) => keptShas.has(c.sha));
      if (rows.length === 0) continue;
      lines.push("", `${g.author.login}, ${plural(rows.length, "commit")}`);
      for (const c of rows) lines.push(commitLine(c));
    }

    if (leftOut > 0) {
      const compare = input.compareLink ? ` · compare ${input.compareLink}` : "";
      lines.push("", `+${leftOut} more commits${compare}`);
    }
    return lines.join("\n");
  };

  let text = build(keep, omitted);
  while (text.length > DIGEST_CHAR_LIMIT && keep > 0) {
    keep -= 1;
    omitted += 1;
    text = build(keep, omitted);
  }
  if (text.length > DIGEST_CHAR_LIMIT) {
    text = `${text.slice(0, DIGEST_CHAR_LIMIT - 1)}…`;
  }

  return {
    text,
    charCount: text.length,
    charLimit: DIGEST_CHAR_LIMIT,
    truncated: omitted > 0 || text.endsWith("…"),
    omitted,
    collapsed: collapsedTrue,
  };
}
