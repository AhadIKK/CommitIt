/**
 * Formatting helpers. Pure, testable, and the only place pluralisation or
 * number shapes are decided — so the numbers read the same on every screen.
 */

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function countLabel(n: number, one: string, many?: string): string {
  return pluralize(n, one, many);
}

/** "just now", "4 min ago", "3 hours ago", "2 days ago" */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "unknown";
  const secs = Math.round((now.getTime() - then.getTime()) / 1000);
  if (secs < 45) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${pluralize(mins, "min")} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${pluralize(hours, "hour")} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${pluralize(days, "day")} ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${pluralize(months, "month")} ago`;
  return `${pluralize(Math.round(months / 12), "year")} ago`;
}

/** "9:00" — the digest window is quoted this way everywhere. */
export function clockTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "12 Oct" */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** "12 Oct – 18 Oct" */
export function dateRange(startIso: string, endIso: string): string {
  return `${shortDate(startIso)} – ${shortDate(endIso)}`;
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

/** "+12 −3" — the two figures never appear without their sign. */
export function churn(additions: number, deletions: number): string {
  return `+${additions} −${deletions}`;
}

export function percentLabel(pct: number | null): string {
  return pct === null ? "no issues yet" : `${pct}%`;
}

/** "Fizan Rahman" → "FR"; "fizan" → "FI" */
export function initials(name: string): string {
  const parts = name
    .replace(/[^\p{L}\p{N} _.-]/gu, "")
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** The one clause that says what a digest window covers. */
export function sinceClause(iso: string): string {
  return `Since your last digest, ${clockTime(iso)}`;
}

export function dueClause(days: number | null): string | null {
  if (days === null) return null;
  if (days === 0) return "due today";
  if (days > 0) return `due in ${pluralize(days, "day")}`;
  return `${pluralize(Math.abs(days), "day")} overdue`;
}
