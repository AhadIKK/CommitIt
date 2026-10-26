import { prisma } from "./db.js";

// github-sync.ts — minimal GitHub REST sync (issues/milestones).
// Recompute progress from source of truth on closed/reopened/merged.
// Uses fetch (no Octokit dep in MVP). Requires GITHUB_TOKEN for private
// repos; public repos work unauthenticated within rate limits.

export type SyncIssue = {
  number: number;
  title: string;
  state: "open" | "closed";
  sizeWeight: number;
  milestoneNumber?: number;
  /** GitHub's `closed_at`; null while open. */
  closedAt?: string | null;
};

function headers(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const tok = process.env.GITHUB_TOKEN;
  if (tok) h.Authorization = `Bearer ${tok}`;
  return h;
}

/**
 * Story-point weight from labels. Anchored to whole size labels (`s`, `small`,
 * `size/s`, `1`, …) — the old `includes("1")` matched any label containing a
 * digit (e.g. `p1`, `v1.0`), mis-sizing issues. Shared by the live sync and the
 * install backfill so the two can never drift.
 */
const SIZE_WEIGHTS: { w: number; re: RegExp }[] = [
  { w: 1, re: /^(?:1|s|small|size\s*[:/]?\s*(?:1|s))$/i },
  { w: 3, re: /^(?:3|m|medium|size\s*[:/]?\s*(?:3|m))$/i },
  { w: 5, re: /^(?:5|l|large|size\s*[:/]?\s*(?:5|l))$/i },
];

export function weightFromLabels(labels: { name: string }[]): number {
  for (const l of labels) {
    const n = l.name.trim();
    for (const { w, re } of SIZE_WEIGHTS) if (re.test(n)) return w;
  }
  return 1;
}

export async function fetchIssues(
  fullName: string,
): Promise<{
  issues: SyncIssue[];
  milestones: { number: number; title: string }[];
  truncated: boolean; // true when the 10-page cap cut the listing (unsafe to prune)
}> {
  const issues: SyncIssue[] = [];
  const milestones = new Map<number, string>();
  let page = 1;
  let truncated = false;
  for (;;) {
    const res = await fetch(
      `https://api.github.com/repos/${fullName}/issues?state=all&per_page=100&page=${page}`,
      { headers: headers() },
    );
    if (!res.ok) throw new Error(`github_issues_${res.status}`);
    const data = (await res.json()) as {
      number: number;
      title: string;
      state: string;
      closed_at?: string | null;
      pull_request?: unknown;
      labels: { name: string }[];
      milestone?: { number: number; title: string } | null;
    }[];
    if (data.length === 0) break;
    for (const it of data) {
      if (it.pull_request) continue; // PRs are not progress
      issues.push({
        number: it.number,
        title: it.title,
        state: it.state === "closed" ? "closed" : "open",
        sizeWeight: weightFromLabels(it.labels ?? []),
        milestoneNumber: it.milestone?.number,
        closedAt: it.closed_at ?? null,
      });
      if (it.milestone) milestones.set(it.milestone.number, it.milestone.title);
    }
    page += 1;
    if (page > 10) {
      truncated = true;
      break;
    }
  }
  return {
    issues,
    milestones: [...milestones].map(([number, title]) => ({ number, title })),
    truncated,
  };
}

// storeSyncedIssues(): DB half of the sync (extracted for the install
// backfill, which fetches with an installation token + ETag instead of
// GITHUB_TOKEN). Progress invariant holds: issues/milestones only.
export async function storeSyncedIssues(
  fullName: string,
  data: { issues: SyncIssue[]; milestones: { number: number; title: string }[] },
): Promise<{ issues: number; milestones: number } | null> {
  try {
    const repoRow = await prisma.repo.upsert({
      where: { fullName },
      update: {},
      create: { fullName },
    });
    const milestoneIds = new Map<number, string>();
    for (const m of data.milestones) {
      const row = await prisma.milestone.upsert({
        where: { repoId_githubId: { repoId: repoRow.id, githubId: m.number } },
        update: { title: m.title },
        create: { repoId: repoRow.id, githubId: m.number, title: m.title },
      });
      milestoneIds.set(m.number, row.id);
    }
    for (const i of data.issues) {
      const milestoneId =
        i.milestoneNumber !== undefined ? (milestoneIds.get(i.milestoneNumber) ?? null) : null;
      // closedAt is the moment the task finished. Reopening clears it, so an
      // open task never claims a close date. A closed issue GitHub dates
      // unparseably still closed; "now" is the honest fallback.
      const closedAt = i.state === "closed" ? (parseWhen(i.closedAt) ?? new Date()) : null;
      await prisma.issue.upsert({
        where: { repoId_number: { repoId: repoRow.id, number: i.number } },
        update: { title: i.title, state: i.state, sizeWeight: i.sizeWeight, milestoneId, closedAt },
        create: {
          repoId: repoRow.id,
          number: i.number,
          title: i.title,
          state: i.state,
          sizeWeight: i.sizeWeight,
          milestoneId,
          closedAt,
        },
      });
    }
    return { issues: data.issues.length, milestones: data.milestones.length };
  } catch {
    return null;
  }
}

// syncRepoIssues(): pull issues/milestones from GitHub (source of truth)
// into the DB so progress/linker/dashboard read fresh data. Best-effort:
// rate limits, private repos without GITHUB_TOKEN, or no DB all degrade to
// null and the calling job still completes.
export async function syncRepoIssues(
  fullName: string,
): Promise<{ issues: number; milestones: number } | null> {
  let data: Awaited<ReturnType<typeof fetchIssues>>;
  try {
    data = await fetchIssues(fullName);
  } catch {
    return null;
  }
  return storeSyncedIssues(fullName, data);
}

/** GitHub timestamps are ISO strings; an unparsable one is unknown, not "now". */
function parseWhen(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * The `issues` webhook is the only place a reopen is observable: GitHub's issue
 * object carries no reopen timestamp, but the event's `issue.updated_at` is the
 * moment the action happened. Closing also carries `closed_at`, which the API
 * sync already stores; stamping it here keeps the two from disagreeing.
 *
 * Best-effort: the sync above is still the source of truth for state.
 */
export async function stampIssueTimestamps(
  fullName: string,
  event: {
    action?: string;
    issue?: {
      number?: number;
      state?: string;
      closed_at?: string | null;
      updated_at?: string;
    };
  },
): Promise<void> {
  const action = event.action ?? "";
  const number = event.issue?.number;
  if (number === undefined) return;
  if (action !== "closed" && action !== "reopened") return;
  try {
    const repoRow = await prisma.repo.findFirst({
      where: { fullName: { equals: fullName, mode: "insensitive" } },
      select: { id: true },
    });
    if (!repoRow) return;
    const when =
      parseWhen(event.issue?.closed_at) ?? parseWhen(event.issue?.updated_at) ?? new Date();
    if (action === "closed") {
      await prisma.issue.updateMany({
        where: { repoId: repoRow.id, number },
        data: { closedAt: when },
      });
    } else {
      await prisma.issue.updateMany({
        where: { repoId: repoRow.id, number },
        data: { closedAt: null, reopenedAt: when },
      });
    }
  } catch {
    // A missing timestamp must not fail the job.
  }
}
