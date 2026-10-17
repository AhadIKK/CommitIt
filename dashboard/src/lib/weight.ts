/**
 * Weighting and the progress sentence.
 *
 * The single rule this module exists to protect: progress is finished tasks,
 * weighted. Nothing here can see a commit, so nothing here can accidentally
 * count one. `weightedClosed` / `weightedTotal` arrive from the API.
 */
import type { Issue, Milestone } from "../api/types.js";

/** S = 1, M = 3, L = 5. Unestimated counts as 1 and is flagged in the UI. */
export const SIZE_WEIGHTS = { S: 1, M: 3, L: 5 } as const;
export const UNESTIMATED_WEIGHT = 1;

export type SizeLabel = "S" | "M" | "L";

export function weightOf(issue: Pick<Issue, "sizeWeight">): number {
  return issue.sizeWeight ?? UNESTIMATED_WEIGHT;
}

export function isEstimated(issue: Pick<Issue, "sizeWeight">): boolean {
  return issue.sizeWeight === 1 || issue.sizeWeight === 3 || issue.sizeWeight === 5;
}

export function sizeLabel(weight: 1 | 3 | 5 | null): SizeLabel | null {
  if (weight === 1) return "S";
  if (weight === 3) return "M";
  if (weight === 5) return "L";
  return null;
}

export function weightName(weight: 1 | 3 | 5 | null): string {
  const label = sizeLabel(weight);
  return label ?? "unestimated";
}

/**
 * Percentage of weighted points that are done.
 * Returns null when there is nothing to divide by — an empty goal says
 * "no issues yet", it never shows 0% or divides by zero (AGENTS.md rule 5).
 */
export function progressPercent(weightedClosed: number, weightedTotal: number): number | null {
  if (!Number.isFinite(weightedTotal) || weightedTotal <= 0) return null;
  const pct = (weightedClosed / weightedTotal) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

export type DueState = {
  days: number;
  phrase: string | null;
};

/** Whole days from `now` to `dueDate`, and the clause the sentence uses. */
export function dueState(dueDate: string | null, now: Date): DueState | null {
  if (!dueDate) return null;
  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) return null;
  const ms = due.getTime() - now.getTime();
  const days = Math.round(ms / 86_400_000);
  if (days === 0) return { days, phrase: "due today" };
  if (days === 1) return { days, phrase: "due tomorrow" };
  if (days > 1) return { days, phrase: `due in ${days} days` };
  if (days === -1) return { days, phrase: "1 day overdue" };
  return { days, phrase: `${Math.abs(days)} days overdue` };
}

export type ProgressSentenceInput = Pick<
  Milestone,
  "title" | "weightedClosed" | "weightedTotal" | "dueDate"
>;

/**
 * "Auth is 62% done: 8 of 13 points, due in 6 days."
 * An empty goal never becomes 0%: it becomes "no issues yet".
 */
export function progressSentence(input: ProgressSentenceInput, now: Date): string {
  const pct = progressPercent(input.weightedClosed, input.weightedTotal);
  if (pct === null) return `${input.title} has no issues yet.`;

  const points = `${input.weightedClosed} of ${input.weightedTotal}`;
  const due = dueState(input.dueDate, now);
  const tail = due?.phrase ? `, ${due.phrase}` : "";
  return `${input.title} is ${pct}% done: ${points} points${tail}.`;
}

/** Just the numeric clause, for dense rows where the title is already shown. */
export function progressClause(input: ProgressSentenceInput): string {
  const pct = progressPercent(input.weightedClosed, input.weightedTotal);
  if (pct === null) return "no issues yet";
  return `${pct}% done: ${input.weightedClosed} of ${input.weightedTotal} points`;
}

export type TrackNodeModel = {
  issue: Issue;
  /** 1 | 3 | 5 — drives the node's size on the track. */
  weight: number;
  sizeLabel: SizeLabel | null;
  state: "open" | "closed";
  estimated: boolean;
  /** "Task 14, login route, size M, closed" */
  accessibleName: string;
};

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/**
 * One node per task, ordered by closing sequence — reopened issues sort back to
 * the open end, which is exactly how the filled line moves backwards.
 */
export function orderForTrack(issues: Issue[]): Issue[] {
  return [...issues].sort((a, b) => {
    const aClosed = a.state === "closed" && a.closedAt;
    const bClosed = b.state === "closed" && b.closedAt;
    if (aClosed && bClosed) {
      const t = new Date(a.closedAt as string).getTime() - new Date(b.closedAt as string).getTime();
      if (t !== 0) return t;
    } else if (aClosed) {
      return -1;
    } else if (bClosed) {
      return 1;
    }
    return a.number - b.number;
  });
}

export function trackNodes(issues: Issue[]): TrackNodeModel[] {
  return orderForTrack(issues).map((issue) => {
    const estimated = isEstimated(issue);
    const label = sizeLabel(issue.sizeWeight);
    const reopened = Boolean(issue.reopenedAt) && issue.state === "open";
    const bits = [
      `Task ${issue.number}`,
      lowerFirst(issue.title),
      estimated ? `size ${label}` : "size unknown, counts as 1 point",
      reopened ? "reopened, open again" : issue.state,
    ];
    return {
      issue,
      weight: weightOf(issue),
      sizeLabel: label,
      state: issue.state,
      estimated,
      accessibleName: bits.join(", "),
    };
  });
}

/**
 * How far the filled line runs: up to and including the last closed task in
 * closing order. Returns a percentage of the track's length.
 */
export function trackFillPercent(nodes: Array<Pick<TrackNodeModel, "state">>): number {
  if (nodes.length === 0) return 0;
  let last = -1;
  nodes.forEach((n, i) => {
    if (n.state === "closed") last = i;
  });
  if (last < 0) return 0;
  if (nodes.length === 1) return 100;
  return (last / (nodes.length - 1)) * 100;
}
