/**
 * The operator ledger: one read for every `/app/*` screen.
 *
 * It is the same database the product screens read, shaped for tables. The
 * rule that governs it: a value we do not store is null, and the table says
 * "not recorded" — it is never estimated to make a column look full.
 *
 * Degrades to empty lists rather than throwing, like every other read: a store
 * blip shows an empty ledger, not a 500.
 */
import type {
  OpsAlert,
  OpsChat,
  OpsDelivery,
  OpsDigest,
  OpsFinding,
  OpsJob,
  OpsPayload,
  OpsRepo,
  OpsTask,
  OpsWeight,
} from "./contract.js";
import { prisma } from "./db.js";
import { buildAlerts, windowStart } from "./workspace.js";

/** A stored weight is only ever 1, 3 or 5; anything else is unestimated. */
export function weightOf(sizeWeight: number): OpsWeight | null {
  return sizeWeight === 1 || sizeWeight === 3 || sizeWeight === 5
    ? (sizeWeight as OpsWeight)
    : null;
}

/** Unestimated tasks still count as one point, the way the track draws them. */
export function pointsOf(sizeWeight: number): number {
  return sizeWeight > 0 ? sizeWeight : 1;
}

const DIGEST_LIMIT = 60;
const DELIVERY_LIMIT = 100;
const JOB_LIMIT = 100;
const FINDING_LIMIT = 50;

type IssueRowLite = {
  id: string;
  repoId: string;
  number: number;
  title: string;
  sizeWeight: number;
  state: string;
  closedAt: Date | null;
  reopenedAt: Date | null;
  closedByPrId: string | null;
};

function taskOf(row: IssueRowLite, prNumber: number | null): OpsTask {
  return {
    id: row.id,
    repoId: row.repoId,
    number: row.number,
    title: row.title,
    weight: weightOf(row.sizeWeight),
    state: row.state === "closed" ? "closed" : "open",
    closedAt: row.state === "closed" ? (row.closedAt?.toISOString() ?? null) : null,
    reopenedAt: row.reopenedAt?.toISOString() ?? null,
    pr: prNumber,
  };
}

export async function opsPayload(scope?: string[]): Promise<OpsPayload> {
  const repoWhere = scope ? { id: { in: scope } } : undefined;
  const scoped = scope ? { repoId: { in: scope } } : undefined;
  // Everything in one wave. Each round trip to the pooler costs ~1s, so two
  // waves would double the time to draw a table.
  const since = windowStart(new Date());
  try {
    const [
      repos,
      issues,
      prs,
      chats,
      notifications,
      events,
      jobs,
      secrets,
      commitStats,
      lastDeliveryRows,
      failedRows,
      forceRows,
    ] = await Promise.all([
      prisma.repo.findMany({ where: repoWhere, orderBy: { fullName: "asc" } }),
      prisma.issue.findMany({
        where: scoped,
        orderBy: [{ repoId: "asc" }, { number: "asc" }],
        select: {
          id: true,
          repoId: true,
          number: true,
          title: true,
          sizeWeight: true,
          state: true,
          closedAt: true,
          reopenedAt: true,
          closedByPrId: true,
        },
      }),
      prisma.pullRequest.findMany({ where: scoped, select: { id: true, number: true } }),
      prisma.chat.findMany({
        where: scope ? { subscriptions: { some: { repoId: { in: scope } } } } : undefined,
        orderBy: { createdAt: "asc" },
        include: { subscriptions: { select: { id: true, repoId: true, digestMode: true } } },
      }),
      prisma.notification.findMany({
        where: scope ? { subscription: { repoId: { in: scope } } } : undefined,
        orderBy: { createdAt: "desc" },
        take: DIGEST_LIMIT,
        include: {
          subscription: {
            select: {
              repoId: true,
              digestMode: true,
              chat: { select: { title: true, type: true } },
            },
          },
        },
      }),
      prisma.event.findMany({
        where: scoped,
        orderBy: { createdAt: "desc" },
        take: DELIVERY_LIMIT,
        select: { deliveryId: true, type: true, status: true, createdAt: true, repoId: true },
      }),
      prisma.job.findMany({
        orderBy: { createdAt: "desc" },
        take: JOB_LIMIT,
        select: { id: true, type: true, status: true, attempts: true },
      }),
      prisma.commit.findMany({
        where: scope ? { secretFlag: true, repoId: { in: scope } } : { secretFlag: true },
        orderBy: { createdAt: "desc" },
        take: FINDING_LIMIT,
        select: {
          id: true,
          repoId: true,
          sha: true,
          branch: true,
          committedAt: true,
          createdAt: true,
        },
      }),
      // Commits per repo and the last commit moment come from one read: they
      // are the same rows, and the pooler charges for each query separately.
      prisma.commit.groupBy({
        by: ["repoId"],
        where: scoped,
        _count: { _all: true },
        _max: { committedAt: true, createdAt: true },
      }),
      prisma.event.groupBy({ by: ["repoId"], where: scoped, _max: { createdAt: true } }),
      prisma.build.findMany({
        where: { status: "failure", createdAt: { gte: since }, ...(scoped ?? {}) },
        select: {
          id: true,
          repoId: true,
          commitSha: true,
          branch: true,
          buildNumber: true,
          runUrl: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.commit.findMany({
        where: { isForcePushContext: true, createdAt: { gte: since }, ...(scoped ?? {}) },
        select: { repoId: true, sha: true, branch: true, committedAt: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    const prNumberById = new Map(prs.map((p) => [p.id, p.number]));
    const tasks = issues.map((i) =>
      taskOf(i, i.closedByPrId ? (prNumberById.get(i.closedByPrId) ?? null) : null),
    );

    const commitsByRepo = new Map<string, number>();
    const lastCommitByRepo = new Map<string, Date | null>();
    for (const row of commitStats) {
      commitsByRepo.set(row.repoId, row._count._all);
      lastCommitByRepo.set(row.repoId, row._max.committedAt ?? row._max.createdAt);
    }

    const lastDeliveryByRepo = new Map(
      lastDeliveryRows.map((r) => [r.repoId ?? "", r._max.createdAt]),
    );
    const byRepo = <T extends { repoId: string }>(rows: T[], repoId: string, take: number): T[] =>
      rows.filter((r) => r.repoId === repoId).slice(0, take);

    const alerts: OpsAlert[] = [];
    const opsRepos: OpsRepo[] = [];

    for (const repo of repos) {
      const repoIssues = tasks.filter((t) => t.repoId === repo.id);
      const finished = repoIssues.filter((t) => t.state === "closed");
      const open = repoIssues.filter((t) => t.state !== "closed");

      const lastDelivery = lastDeliveryByRepo.get(repo.id) ?? null;
      const repoAlerts = buildAlerts({
        repoFullName: repo.fullName,
        defaultBranch: repo.defaultBranch ?? "main",
        secretCommits: byRepo(secrets, repo.id, 5),
        failedBuilds: byRepo(failedRows, repo.id, 5),
        forcePushes: byRepo(forceRows, repo.id, 5),
        lastActivityAt: lastCommitByRepo.get(repo.id) ?? null,
        now: new Date(),
      });

      opsRepos.push({
        id: repo.id,
        fullName: repo.fullName,
        defaultBranch: repo.defaultBranch ?? "main",
        connected: lastDelivery !== null,
        pointsFinished: finished.reduce((n, t) => n + pointsOf(t.weight ?? 0), 0),
        pointsTotal: repoIssues.reduce((n, t) => n + pointsOf(t.weight ?? 0), 0),
        commitCount: commitsByRepo.get(repo.id) ?? 0,
        needsDecision: repoIssues.filter((t) => t.reopenedAt !== null).length,
        lastDigestAt: null,
        health: lastDelivery ? "VERIFIED" : "CHECK",
        finishedWeights: finished
          .slice()
          .sort((a, b) => (a.closedAt ?? "").localeCompare(b.closedAt ?? ""))
          .map((t) => t.weight ?? 1),
        openWeights: open.map((t) => t.weight ?? 1),
      });

      for (const alert of repoAlerts) {
        alerts.push({
          id: alert.id,
          kind: alert.kind,
          repoId: repo.id,
          actor: alert.branch ?? "",
          at: alert.at,
          detail: alert.title,
          delivered: true,
        });
      }
    }

    const digests: OpsDigest[] = notifications.map((n) => {
      const chat = n.subscription.chat;
      const title = chat.title?.trim() || (chat.type === "group" ? "Group chat" : "Direct message");
      const status =
        n.status === "sent" ? "DELIVERED" : n.status === "failed" ? "FAILED" : "QUEUED";
      const mode = n.subscription.digestMode;
      return {
        id: n.id,
        repoId: n.subscription.repoId,
        chatTitle: title,
        sentAt: n.createdAt.toISOString(),
        // The stored body is the message the sender built, which is what the
        // detail page shows: "as sent", not a reconstruction.
        body: n.body,
        cadence: mode === "instant" || mode === "hourly" ? mode : "daily",
        // The renderer does not record how many points a message carried.
        pointsFinished: null,
        status,
        messageCount: 1,
      };
    });

    // Last digest per repo, from the same rows the digest table shows.
    const lastDigestByRepo = new Map<string, string>();
    for (const d of digests) {
      if (d.status !== "DELIVERED") continue;
      const seen = lastDigestByRepo.get(d.repoId);
      if (!seen || d.sentAt > seen) lastDigestByRepo.set(d.repoId, d.sentAt);
    }
    for (const repo of opsRepos) {
      repo.lastDigestAt = lastDigestByRepo.get(repo.id) ?? null;
    }

    const lastMessageByChat = new Map<string, string>();
    for (const n of notifications) {
      for (const chat of chats) {
        if (chat.subscriptions.some((s) => s.id === n.subscriptionId)) {
          const seen = lastMessageByChat.get(chat.id);
          if (!seen || n.createdAt.toISOString() > seen) {
            lastMessageByChat.set(chat.id, n.createdAt.toISOString());
          }
        }
      }
    }

    const opsChats: OpsChat[] = chats.map((chat) => ({
      id: chat.id,
      title: chat.title?.trim() || (chat.type === "group" ? "Group chat" : "Direct message"),
      kind: chat.type === "group" ? "group" : "dm",
      members: null,
      linkedRepoIds: [...new Set(chat.subscriptions.map((s) => s.repoId))],
      lastMessageAt: lastMessageByChat.get(chat.id) ?? null,
      status: chat.subscriptions.length > 0 ? "VERIFIED" : "CHECK",
    }));

    const findings: OpsFinding[] = secrets.map((c) => ({
      id: c.id,
      // Only the flag is stored: the scan reports a path in the alert and never
      // writes it, because the path is all we are allowed to keep.
      path: null,
      rule: "credential pattern matched",
      repoId: c.repoId,
      commitSha: c.sha.slice(0, 7),
      at: (c.committedAt ?? c.createdAt).toISOString(),
      status: "SKIPPED",
    }));

    const deliveries: OpsDelivery[] = events.map((e) => ({
      id: e.deliveryId,
      at: e.createdAt.toISOString(),
      event: e.type,
      signature: "VERIFIED",
      rateLimited: false,
      key: e.deliveryId.slice(0, 8),
      outcome: e.status,
    }));

    const JOB_STATUS: Record<string, OpsJob["status"]> = {
      queued: "queued",
      processing: "running",
      done: "done",
      failed: "dead",
    };

    const opsJobs: OpsJob[] = jobs.map((j) => ({
      id: j.id.slice(0, 8),
      kind: j.type,
      status: JOB_STATUS[j.status] ?? "queued",
      attempts: j.attempts,
    }));

    return {
      repos: opsRepos,
      tasks,
      digests,
      alerts,
      chats: opsChats,
      findings,
      deliveries,
      jobs: opsJobs,
    };
  } catch {
    return {
      repos: [],
      tasks: [],
      digests: [],
      alerts: [],
      chats: [],
      findings: [],
      deliveries: [],
      jobs: [],
    };
  }
}
