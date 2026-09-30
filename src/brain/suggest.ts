// suggestLink(): heuristic keyword/title match for Unlinked work.
// Never auto-applied — caller surfaces as "suggested #N", user confirms
// via /link. Pure function.

export type IssueRef = { number: number; title: string };

export function suggestLink(
  message: string,
  branch: string,
  issues: IssueRef[],
): number | null {
  const hay = `${message}\n${branch}`.toLowerCase();
  let best: number | null = null;
  let bestScore = 0;
  for (const issue of issues) {
    const words = issue.title.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    let score = 0;
    for (const w of words) {
      if (w.length > 3 && hay.includes(w)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = issue.number;
    }
  }
  return bestScore >= 2 ? best : null;
}
