import { escapeHtml } from "./telegram.js";

// formatter.ts — Telegram HTML, 3800-char cap, ~15-commit cap,
// "+N more + compare link" footer. Push >10 commits always collapsed.
// Merges link via PR (no AI summary); forced push → risk alert line.

export type FormatCommit = {
  sha: string;
  message: string;
  author: string;
  category: string;
  aiSummary?: string;
  degraded?: boolean;
  isMerge?: boolean;
  prNumber?: number;
  secretFlag?: boolean;
};

const MAX_CHARS = 3800;
const MAX_COMMITS = 15;
const COLLAPSE_AT = 10;

export function formatPush(opts: {
  repo: string;
  branch: string;
  commits: FormatCommit[];
  compareUrl?: string;
  forced?: boolean;
  progressLine?: string;
}): string {
  const { repo, branch, commits, compareUrl, forced, progressLine } = opts;
  const lines: string[] = [];
  lines.push(`📊 <b>${escapeHtml(repo)}</b> — ${escapeHtml(branch)}`);
  if (progressLine) lines.push(escapeHtml(progressLine));
  if (forced) lines.push(`⚠ force-push detected — excluded from activity`);

  const collapsed = commits.length > COLLAPSE_AT;
  const shown = commits.slice(0, MAX_COMMITS);
  const byAuthor = new Map<string, FormatCommit[]>();
  for (const c of shown) {
    const list = byAuthor.get(c.author) ?? [];
    list.push(c);
    byAuthor.set(c.author, list);
  }
  for (const [author, list] of byAuthor) {
    const cats = list.map((c) => `<code>${escapeHtml(c.category)}</code>`).join(", ");
    lines.push(`• <b>${escapeHtml(author)}</b> — ${list.length} commits: ${cats}`);
    if (!collapsed) {
      for (const c of list) {
        const short = escapeHtml(c.sha.slice(0, 7));
        const msg = escapeHtml(c.message.split("\n")[0]?.slice(0, 80) ?? "");
        if (c.secretFlag) {
          lines.push(`  🔑 <code>${short}</code> possible secret — file withheld`);
        } else if (c.isMerge && c.prNumber) {
          lines.push(`  <code>${short}</code> merge (PR #${c.prNumber})`);
        } else if (c.aiSummary && !c.degraded) {
          lines.push(`  <code>${short}</code> ${escapeHtml(c.aiSummary)}`);
        } else {
          lines.push(`  <code>${short}</code> ${msg}`);
        }
      }
    }
  }
  const remaining = commits.length - shown.length;
  if (remaining > 0 || compareUrl) {
    const more = remaining > 0 ? `+${remaining} more` : "view diff";
    lines.push(
      compareUrl
        ? `<a href="${compareUrl}">${more}</a>`
        : escapeHtml(more),
    );
  }

  let out = lines.join("\n");
  if (out.length > MAX_CHARS) {
    out = out.slice(0, MAX_CHARS - 20) + "\n… truncated";
    if (compareUrl) out += ` <a href="${compareUrl}">view diff</a>`;
  }
  return out;
}
