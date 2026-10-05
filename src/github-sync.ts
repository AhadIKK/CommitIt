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

function weightFromLabels(labels: { name: string }[]): number {
  for (const l of labels) {
    const n = l.name.toLowerCase();
    if (n === "s" || n.includes("small") || n.includes("1")) return 1;
    if (n === "m" || n.includes("medium") || n.includes("3")) return 3;
    if (n === "l" || n.includes("large") || n.includes("5")) return 5;
  }
  return 1;
}

export async function fetchIssues(
  fullName: string,
): Promise<{ issues: SyncIssue[]; milestones: { number: number; title: string }[] }> {
  const issues: SyncIssue[] = [];
  const milestones = new Map<number, string>();
  let page = 1;
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
      });
      if (it.milestone) milestones.set(it.milestone.number, it.milestone.title);
    }
    page += 1;
    if (page > 10) break;
  }
  return {
    issues,
    milestones: [...milestones].map(([number, title]) => ({ number, title })),
  };
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
      await prisma.issue.upsert({
        where: { repoId_number: { repoId: repoRow.id, number: i.number } },
        update: { title: i.title, state: i.state, sizeWeight: i.sizeWeight, milestoneId },
        create: {
          repoId: repoRow.id,
          number: i.number,
          title: i.title,
          state: i.state,
          sizeWeight: i.sizeWeight,
          milestoneId,
        },
      });
    }
    return { issues: data.issues.length, milestones: data.milestones.length };
  } catch {
    return null;
  }
}
