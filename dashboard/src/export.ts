// export.ts — Excel-safe CSV downloads (xlsx skill, browser-scoped job).
// No workbook libs: the dashboard is dependency-frozen, so export is
// RFC-4180 CSV with a UTF-8 BOM, which Excel opens correctly.
// Pure string builders are unit-tested; only downloadCsv touches the DOM.
import type { AuthorStat, IssueRow } from "@src/dashboard.js";

const BOM = String.fromCodePoint(0xFEFF);
const CRLF = "\r\n";

function quote(value: string | number): string {
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: (string | number)[][]): string {
  const lines = [headers, ...rows].map((r) => r.map(quote).join(","));
  return BOM + lines.join(CRLF) + CRLF;
}

export function issuesToCsv(issues: IssueRow[]): string {
  return toCsv(
    ["number", "title", "state", "weight", "milestone"],
    issues.map((i) => [i.number, i.title, i.state, i.weight, i.milestone ?? ""]),
  );
}

export function activityToCsv(authors: AuthorStat[]): string {
  return toCsv(
    ["login", "commits", "merged_prs"],
    authors.map((a) => [a.login, a.commits, a.mergedPRs]),
  );
}

export function downloadFile(filename: string, content: BlobPart, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadCsv(filename: string, csv: string): void {
  downloadFile(filename, csv, "text/csv;charset=utf-8");
}

export function downloadDoc(filename: string, html: string): void {
  downloadFile(filename, html, "application/msword");
}

export function exportFilename(repo: string, kind: string): string {
  const safe = repo.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${safe}-${kind}.csv`;
}
