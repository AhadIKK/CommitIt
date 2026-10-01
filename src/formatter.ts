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
  directToMain?: boolean;
  progressLine?: string;
}): string {
  const { repo, branch, commits, compareUrl, forced, directToMain, progressLine } = opts;
  const lines: string[] = [];
  lines.push(`📊 <b>${escapeHtml(repo)}</b> — ${escapeHtml(branch)}`);
  if (progressLine) lines.push(escapeHtml(progressLine));
  if (forced) lines.push(`⚠ force-push detected — excluded from activity`);
  if (directToMain) lines.push(`⚠ direct push to ${escapeHtml(branch)} — review risk`);

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

function cap(s: string): string {
  return s.length > MAX_CHARS ? s.slice(0, MAX_CHARS - 20) + "\n… truncated" : s;
}

// Instant: PR merged (squash-merge included — the PR event is truth).
export function formatPRMerged(opts: {
  repo: string;
  prNumber: number;
  title: string;
  author: string;
  prUrl?: string;
}): string {
  const head = `🟢 <b>${escapeHtml(opts.repo)}</b> merged PR #${opts.prNumber} — "${escapeHtml(opts.title)}"`;
  const by = `By: ${escapeHtml(opts.author)}`;
  const link = opts.prUrl ? `\n<a href="${opts.prUrl}">View PR</a>` : "";
  return cap(`${head}\n${by}${link}`);
}

// Instant: CI failed (high priority). Matches theme.md template.
export function formatCIFailed(opts: {
  repo: string;
  branch: string;
  build: string;
  commitMsg?: string;
  author?: string;
  runUrl?: string;
}): string {
  const head = `🔴 CI failed on ${escapeHtml(opts.branch)} — build #${escapeHtml(opts.build)}`;
  const by =
    opts.author || opts.commitMsg
      ? `\nBy: ${escapeHtml(opts.author ?? "unknown")} · "${escapeHtml(opts.commitMsg ?? "")}"`
      : "";
  const link = opts.runUrl ? `\n<a href="${opts.runUrl}">View run</a>` : "";
  return cap(`${head}${by}${link}`);
}

// Instant: CI back to green after a failure.
export function formatCIFixed(opts: {
  repo: string;
  branch: string;
  build: string;
  runUrl?: string;
}): string {
  const head = `🟢 CI fixed on ${escapeHtml(opts.branch)} — build #${escapeHtml(opts.build)}`;
  const link = opts.runUrl ? `\n<a href="${opts.runUrl}">View run</a>` : "";
  return cap(`${head}${link}`);
}

// First-class secret alert: file path only, never the value.
export function formatSecretAlert(opts: {
  repo: string;
  branch: string;
  sha: string;
  file: string;
  author?: string;
}): string {
  return cap(
    `🔑 Possible secret in <b>${escapeHtml(opts.repo)}</b> — <code>${escapeHtml(opts.sha.slice(0, 7))}</code>\n` +
      `File: <code>${escapeHtml(opts.file)}</code> (value withheld)` +
      (opts.author ? `\nBy: ${escapeHtml(opts.author)}` : ""),
  );
}

// Stale-branch/inactivity digest lines.
export function formatStaleAlert(opts: {
  repo: string;
  branches: { name: string; days: number }[];
}): string {
  const lines = opts.branches.map(
    (b) => `⚠ Stale: ${escapeHtml(b.name)}, no activity ${b.days}d`,
  );
  return cap(`<b>${escapeHtml(opts.repo)}</b> — inactive branches\n${lines.join("\n")}`);
}
