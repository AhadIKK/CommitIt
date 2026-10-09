import { prisma } from "./db.js";
import { fetchIssues, type SyncIssue } from "./github-sync.js";

// reconcile.ts — Phase E periodic/live-progress reconciliation.
// Webhook events (issues closed/reopened, milestone opened/closed/deleted)
// already recompute from the API via syncRepoIssues; reconcileRepo() goes
// further and diffs DB vs API, fixing drift (missed deliveries, direct DB
// edits, deleted milestones). Progress invariant holds throughout: only
// issues/milestones move the number, never commits.

export type DbIssueView = {
  id: string;
  number: number;
  title: string;
  state: string;
  sizeWeight: number;
  milestoneId: string | null;
  milestoneGithubId: number | null;
};

export type ReconcileDiff = {
  /** Existing rows whose API truth differs (id + patch). */
  toUpdate: { id: string; patch: { title: string; state: string; sizeWeight: number; milestoneId: string | null } }[];
  /** API issues absent from the DB. */
  toInsert: SyncIssue[];
  /** DB milestones missing from a COMPLETE API listing (prune candidates). */
  orphanMilestoneIds: string[];
  /** DB issues whose milestone vanished (unassign, don't delete). */
  unassignIssueIds: string[];
};

/** Pure diff: DB rows vs API truth. Pruning only when `complete` (no page cap hit). */
export function diffIssues(
  dbIssues: DbIssueView[],
  apiIssues: SyncIssue[],
  dbMilestones: Map<number, string>,
  apiMilestoneIds: Set<number>,
  complete: boolean,
): ReconcileDiff {
  const diff: ReconcileDiff = { toUpdate: [], toInsert: [], orphanMilestoneIds: [], unassignIssueIds: [] };
  const byNumber = new Map(dbIssues.map((i) => [i.number, i]));
  const milestoneIdFor = (n: number | undefined): string | null =>
    n === undefined ? null : (dbMilestones.get(n) ?? null);

  for (const api of apiIssues) {
    const db = byNumber.get(api.number);
    const milestoneId = milestoneIdFor(api.milestoneNumber);
    if (!db) {
      diff.toInsert.push(api);
      continue;
    }
    const patch = {
      title: api.title,
      state: api.state,
      sizeWeight: api.sizeWeight,
      milestoneId,
    };
    if (
      db.title !== patch.title ||
      (db.state === "closed" ? "closed" : "open") !== patch.state ||
      db.sizeWeight !== patch.sizeWeight ||
      db.milestoneId !== patch.milestoneId
    ) {
      diff.toUpdate.push({ id: db.id, patch });
    }
    if (api.milestoneNumber !== undefined && !dbMilestones.has(api.milestoneNumber)) {
      // Milestone row missing locally (sync gap): insert carries the number;
      // storeSyncedIssues path resolves it — here we unassign to stay truthful.
      diff.toUpdate.push({ id: db.id, patch: { ...patch, milestoneId: null } });
    }
  }

  if (complete) {
    const seenMilestoneRows = new Set<string>();
    for (const db of dbIssues) {
      if (db.milestoneGithubId == null) continue;
      if (!apiMilestoneIds.has(db.milestoneGithubId)) {
        diff.unassignIssueIds.push(db.id);
        if (db.milestoneId && !seenMilestoneRows.has(db.milestoneId)) {
          seenMilestoneRows.add(db.milestoneId);
          diff.orphanMilestoneIds.push(db.milestoneId);
        }
      }
    }
  }
  return diff;
}

export type ReconcileSummary = {
  updated: number;
  inserted: number;
  unassigned: number;
  prunedMilestones: number;
};

/**
 * Reconcile one repo: fetch API truth, diff, apply. Returns counts, or null
 * when the repo is unknown / API unreachable / DB down (job still completes).
 */
export async function reconcileRepo(fullName: string): Promise<ReconcileSummary | null> {
  let fetched: Awaited<ReturnType<typeof fetchIssues>>;
  try {
    fetched = await fetchIssues(fullName);
  } catch {
    return null;
  }
  try {
    const repoRow = await prisma.repo.findUnique({ where: { fullName } });
    if (!repoRow) return null;
    const [dbIssues, dbMilestones] = await Promise.all([
      prisma.issue.findMany({
        where: { repoId: repoRow.id },
        include: { milestone: { select: { id: true, githubId: true } } },
      }),
      prisma.milestone.findMany({ where: { repoId: repoRow.id } }),
    ]);
    const milestoneByGithub = new Map<number, string>();
    for (const m of dbMilestones) {
      if (m.githubId != null) milestoneByGithub.set(m.githubId, m.id);
    }
    // Milestones first: ensure every API milestone has a row (mirrors sync).
    for (const m of fetched.milestones) {
      if (!milestoneByGithub.has(m.number)) {
        const row = await prisma.milestone.upsert({
          where: { repoId_githubId: { repoId: repoRow.id, githubId: m.number } },
          update: { title: m.title },
          create: { repoId: repoRow.id, githubId: m.number, title: m.title },
        });
        milestoneByGithub.set(m.number, row.id);
      }
    }
    const view: DbIssueView[] = dbIssues.map((i) => ({
      id: i.id,
      number: i.number,
      title: i.title,
      state: i.state,
      sizeWeight: i.sizeWeight,
      milestoneId: i.milestoneId,
      milestoneGithubId: i.milestone?.githubId ?? null,
    }));
    const diff = diffIssues(
      view,
      fetched.issues,
      milestoneByGithub,
      new Set(fetched.milestones.map((m) => m.number)),
      !fetched.truncated,
    );
    for (const u of diff.toUpdate) {
      await prisma.issue.update({ where: { id: u.id }, data: u.patch });
    }
    for (const ins of diff.toInsert) {
      await prisma.issue.upsert({
        where: { repoId_number: { repoId: repoRow.id, number: ins.number } },
        update: {
          title: ins.title,
          state: ins.state,
          sizeWeight: ins.sizeWeight,
          milestoneId:
            ins.milestoneNumber !== undefined
              ? (milestoneByGithub.get(ins.milestoneNumber) ?? null)
              : null,
        },
        create: {
          repoId: repoRow.id,
          number: ins.number,
          title: ins.title,
          state: ins.state,
          sizeWeight: ins.sizeWeight,
          milestoneId:
            ins.milestoneNumber !== undefined
              ? (milestoneByGithub.get(ins.milestoneNumber) ?? null)
              : null,
        },
      });
    }
    if (diff.unassignIssueIds.length > 0) {
      await prisma.issue.updateMany({
        where: { id: { in: diff.unassignIssueIds } },
        data: { milestoneId: null },
      });
    }
    if (diff.orphanMilestoneIds.length > 0) {
      await prisma.milestone.deleteMany({ where: { id: { in: diff.orphanMilestoneIds } } });
    }
    await prisma.repo.update({ where: { id: repoRow.id }, data: { lastSyncAt: new Date() } });
    return {
      updated: diff.toUpdate.length,
      inserted: diff.toInsert.length,
      unassigned: diff.unassignIssueIds.length,
      prunedMilestones: diff.orphanMilestoneIds.length,
    };
  } catch {
    return null;
  }
}

/**
 * Prune one deleted milestone: unassign its issues, drop the row.
 * Targeted (exact github number) — safe without pagination guards.
 */
export async function pruneMilestone(fullName: string, githubNumber: number): Promise<boolean> {
  try {
    const repoRow = await prisma.repo.findUnique({ where: { fullName } });
    if (!repoRow) return false;
    const milestone = await prisma.milestone.findUnique({
      where: { repoId_githubId: { repoId: repoRow.id, githubId: githubNumber } },
    });
    if (!milestone) return true; // already gone
    await prisma.issue.updateMany({
      where: { milestoneId: milestone.id },
      data: { milestoneId: null },
    });
    await prisma.milestone.delete({ where: { id: milestone.id } });
    return true;
  } catch {
    return false;
  }
}
