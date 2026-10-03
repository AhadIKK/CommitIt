// report.ts — weekly 3P digest (internal-comms) + Word export (docx skill,
// browser-scoped: Word-readable HTML .doc blob, no new deps) + print view.
// Pure builders are unit-tested. User content is HTML-escaped everywhere.
import type {
  ActivitySnapshot,
  DigestEntry,
  IssueRow,
  RepoProgress,
} from "@src/dashboard.js";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type WeeklySummary = {
  progress: string;
  plans: string;
  problems: string;
};

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

// 3P in 1-3 sentences per section, data-driven, matter-of-fact.
export function buildWeeklySummary(
  activity: ActivitySnapshot | null,
  progress: RepoProgress | null,
  issues: IssueRow[],
  digests: DigestEntry[],
): WeeklySummary {
  const authors = activity?.authors ?? [];
  const commits = activity?.totalCommits ?? 0;
  const merged = activity?.totalMergedPRs ?? 0;

  let progressLine = "No commits or merges recorded in the last 7 days.";
  if (commits > 0 || merged > 0) {
    progressLine =
      commits +
      " commit" +
      plural(commits, "", "s") +
      " and " +
      merged +
      " merged PR" +
      plural(merged, "", "s") +
      " across " +
      authors.length +
      " author" +
      plural(authors.length, "", "s") +
      " in the last 7 days.";
    const overall = progress?.overall;
    if (overall) {
      progressLine +=
        " Overall progress is " +
        overall.percent +
        "% (" +
        overall.closedPoints +
        "/" +
        overall.totalPoints +
        " pts).";
    }
  }

  const openTop = issues
    .filter((i) => i.state === "open")
    .sort((a, b) => b.weight - a.weight || a.number - b.number)
    .slice(0, 3);
  const plans =
    openTop.length === 0
      ? "No open issues on the board; next focus to be confirmed."
      : "Top focus: " +
        openTop.map((i) => "#" + i.number + " " + i.title).join("; ") +
        ".";

  const failed = digests.filter((d) => d.status === "failed");
  const problems =
    failed.length === 0
      ? "No failures recorded."
      : failed.length +
        " failed run" +
        plural(failed.length, "", "s") +
        " recorded: " +
        failed
          .slice(0, 2)
          .map((d) => d.body.slice(0, 80))
          .join(" | ") +
        ".";

  return { progress: progressLine, plans, problems };
}

// Minimal Word-readable HTML document. Word opens plain-HTML .doc files;
// keep to headings, paragraphs, and simple tables (no scripts, no CSS vars).
export function digestToDoc(opts: {
  repo: string;
  weekLabel: string;
  summary: WeeklySummary;
  issues: IssueRow[];
  digests: DigestEntry[];
}): string {
  const issueRows = opts.issues
    .map(
      (i) =>
        "<tr><td>#" +
        i.number +
        "</td><td>" +
        escapeHtml(i.title) +
        "</td><td>" +
        i.state +
        "</td><td>" +
        i.weight +
        "</td><td>" +
        escapeHtml(i.milestone ?? "") +
        "</td></tr>",
    )
    .join("");
  const digestRows = opts.digests
    .slice(0, 20)
    .map(
      (d) =>
        "<tr><td>" +
        escapeHtml(d.createdAt.slice(0, 10)) +
        "</td><td>" +
        escapeHtml(d.type) +
        "</td><td>" +
        escapeHtml(d.status) +
        "</td><td>" +
        escapeHtml(d.body.slice(0, 280)) +
        "</td></tr>",
    )
    .join("");
  return (
    '<html xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta charset="utf-8">' +
    "<title>" +
    escapeHtml(opts.repo) +
    " weekly digest</title></head><body>" +
    "<h1>" +
    escapeHtml(opts.repo) +
    " (" +
    escapeHtml(opts.weekLabel) +
    ")</h1>" +
    "<h2>Progress</h2><p>" +
    escapeHtml(opts.summary.progress) +
    "</p>" +
    "<h2>Plans</h2><p>" +
    escapeHtml(opts.summary.plans) +
    "</p>" +
    "<h2>Problems</h2><p>" +
    escapeHtml(opts.summary.problems) +
    "</p>" +
    "<h2>Issues</h2>" +
    '<table border="1" cellpadding="4" cellspacing="0">' +
    "<tr><th>#</th><th>Title</th><th>State</th><th>Weight</th><th>Milestone</th></tr>" +
    issueRows +
    "</table>" +
    "<h2>Digests</h2>" +
    '<table border="1" cellpadding="4" cellspacing="0">' +
    "<tr><th>Date</th><th>Type</th><th>Status</th><th>Body</th></tr>" +
    digestRows +
    "</table>" +
    "</body></html>"
  );
}

export function weekLabel(now: Date = new Date()): string {
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return fmt(new Date(now.getTime() - 6 * 86_400_000)) + " to " + fmt(now);
}
