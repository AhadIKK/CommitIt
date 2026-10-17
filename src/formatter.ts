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

/**
 * Truncate HTML without cutting a tag or entity in half. A sliced
 * `<a href="…">` or a dangling `&amp` makes Telegram reject the entire
 * message ("can't parse entities"), so we back off to the last safe
 * boundary before appending the ellipsis. Pure, tested.
 */
export function truncateHtml(s: string, max: number, ellipsis = "\n… truncated"): string {
  if (s.length <= max) return s;
  const budget = Math.max(0, max - ellipsis.length);
  let cut = s.slice(0, budget);
  // Drop an unterminated tag: `<` with no matching `>` after it.
  const lastOpen = cut.lastIndexOf("<");
  if (lastOpen > cut.lastIndexOf(">")) cut = cut.slice(0, lastOpen);
  // Drop a dangling partial entity (`&`, `&am`, …) with no closing `;`.
  const amp = cut.lastIndexOf("&");
  if (amp !== -1 && !cut.slice(amp).includes(";")) cut = cut.slice(0, amp);
  return cut + ellipsis;
}

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
    const tail = compareUrl ? ` <a href="${compareUrl}">view diff</a>` : "";
    out = truncateHtml(out, MAX_CHARS - tail.length) + tail;
  }
  return out;
}

function cap(s: string): string {
  return truncateHtml(s, MAX_CHARS);
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

// --- /recent: the chat-scoped commit list ---

export type RecentCommit = {
  repo: string;
  sha: string;
  message: string;
  author: string;
  category?: string | null;
  isMerge?: boolean;
  secretFlag?: boolean;
  issueNumber?: number | null;
  /** committedAt, falling back to the row's createdAt for legacy nulls. */
  at?: Date | null;
};

const SUBJECT_MAX = 60;

/**
 * Coarse "how long ago" for a chat list — minutes are the smallest unit, so a
 * clock-skewed future date reads "just now" rather than "in 3h". Pure, with an
 * injectable clock so tests never depend on wall time.
 */
export function timeAgo(at: Date, now: Date = new Date()): string {
  const minutes = Math.floor((now.getTime() - at.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

/** First line only, capped — a chat list must not wrap five lines per commit. */
function subject(message: string): string {
  const first = (message.split("\n")[0] ?? "").trim();
  return first.length > SUBJECT_MAX ? `${first.slice(0, SUBJECT_MAX - 1)}…` : first;
}

/**
 * The /recent body: newest first, one line per commit. The repo is named in the
 * header when the list covers one repo and prefixed per line when it covers
 * several — so a multi-repo chat never loses track of which is which.
 *
 * Flagged commits keep formatPush's behaviour: the subject is withheld rather
 * than shown beside a "possible secret" marker. The list shows the commit
 * subject (metadata we already store), never an AI summary, so nothing here
 * depends on the LLM having run.
 */
export function formatRecent(opts: {
  commits: RecentCommit[];
  more?: number;
  commitsUrl?: string;
  now?: Date;
}): string {
  const { commits, more = 0, commitsUrl, now = new Date() } = opts;
  if (commits.length === 0) return "🕒 No commits recorded yet for this chat's repos.";

  const repos = [...new Set(commits.map((c) => c.repo))];
  const multi = repos.length > 1;
  const head = multi
    ? `🕒 <b>Recent commits</b> — ${repos.length} repos`
    : `🕒 <b>Recent commits</b> — <code>${escapeHtml(repos[0] ?? "")}</code>`;

  const lines = commits.map((c) => {
    const where = multi ? `<code>${escapeHtml(c.repo)}</code> ` : "";
    const sha = `<code>${escapeHtml(c.sha.slice(0, 7))}</code>`;
    const cat = c.category ? ` <b>${escapeHtml(c.category)}</b>` : "";
    if (c.secretFlag) return `${where}${sha}${cat} 🔑 possible secret — subject withheld`;
    const merge = c.isMerge ? " (merge)" : "";
    const issue = c.issueNumber ? ` → #${c.issueNumber}` : "";
    const when = c.at ? `, ${timeAgo(c.at, now)}` : "";
    return (
      `${where}${sha}${cat} ${escapeHtml(subject(c.message))}${merge}${issue}` +
      ` — ${escapeHtml(c.author)}${when}`
    );
  });

  const tail =
    more > 0
      ? `\n${commitsUrl ? `<a href="${commitsUrl}">+${more} more</a>` : `+${more} more`}`
      : commitsUrl
        ? `\n<a href="${commitsUrl}">All commits</a>`
        : "";
  let body = `${head}\n${lines.join("\n")}`;
  if (body.length + tail.length > MAX_CHARS) body = truncateHtml(body, MAX_CHARS - tail.length);
  return body + tail;
}
