// stale.ts — stale-branch/inactivity detection. Pure function:
// branches with no activity for >= thresholdDays. Default branches
// (main/master) are excluded — the alert targets feature branches.

export type BranchActivity = {
  name: string;
  lastActivityAt: Date | string;
};

export type StaleBranch = { name: string; days: number };

const DEFAULT_BRANCHES = new Set(["main", "master"]);

export function findStaleBranches(
  branches: BranchActivity[],
  now: Date = new Date(),
  thresholdDays = 6,
): StaleBranch[] {
  const out: StaleBranch[] = [];
  for (const b of branches) {
    if (DEFAULT_BRANCHES.has(b.name)) continue;
    const last = new Date(b.lastActivityAt).getTime();
    if (Number.isNaN(last)) continue;
    const days = Math.floor((now.getTime() - last) / 86_400_000);
    if (days >= thresholdDays) out.push({ name: b.name, days });
  }
  out.sort((a, b) => b.days - a.days);
  return out;
}
