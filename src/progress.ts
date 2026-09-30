// progress.ts — Progress ≠ activity. Reads issues/milestones only,
// recomputes from source of truth (handles reopened). Empty milestone
// returns "no issues yet", never divides by zero.

export type IssueState = { state: "open" | "closed"; sizeWeight: number };

export type ProgressResult =
  | { empty: true; label: string }
  | {
      empty: false;
      percent: number;
      closed: number;
      total: number;
      closedPoints: number;
      totalPoints: number;
      unestimated: number;
      label: string;
    };

export function milestoneProgress(issues: IssueState[]): ProgressResult {
  if (issues.length === 0) return { empty: true, label: "no issues yet" };
  let closedPoints = 0;
  let totalPoints = 0;
  let closed = 0;
  let unestimated = 0;
  for (const i of issues) {
    const w = i.sizeWeight > 0 ? i.sizeWeight : 1;
    if (!(i.sizeWeight > 0)) unestimated += 1;
    totalPoints += w;
    if (i.state === "closed") {
      closed += 1;
      closedPoints += w;
    }
  }
  if (totalPoints === 0) return { empty: true, label: "no issues yet" };
  const percent = Math.round((closedPoints / totalPoints) * 100);
  let label = `${percent}% (${closedPoints}/${totalPoints} pts)`;
  if (unestimated > 0) label += ` * includes ${unestimated} unestimated`;
  return {
    empty: false,
    percent,
    closed,
    total: issues.length,
    closedPoints,
    totalPoints,
    unestimated,
    label,
  };
}
