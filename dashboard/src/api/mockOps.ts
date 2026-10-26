/**
 * The ledger fixture. The /app screens read `ops()` from the adapter, so the
 * design review (VITE_API_MODE=mock) still needs a full payload — this maps the
 * seed rows into the same shape the real `/api/ops` returns.
 *
 * It lives beside the adapter rather than in the screens: a screen that imports
 * seed data cannot be pointed at the backend, and that is exactly the bug this
 * file removes.
 */
import type { OpsPayload } from "./types.js";
import {
  ALERTS,
  CHATS,
  DELIVERIES,
  DIGESTS,
  FINDINGS,
  JOBS,
  REPOS,
  TASKS,
  WEIGHT_POINTS,
} from "../app/seed.js";

export function mockOps(): OpsPayload {
  return {
    repos: REPOS.map((r) => ({
      id: r.id,
      fullName: r.fullName,
      defaultBranch: r.defaultBranch,
      connected: r.connected,
      pointsFinished: r.pointsFinished,
      pointsTotal: r.pointsTotal,
      commitCount: r.commitCount,
      needsDecision: r.needsDecision,
      lastDigestAt: r.lastDigest,
      health: r.health,
      finishedWeights: r.weights,
      openWeights: r.open,
    })),
    tasks: TASKS.map((t) => ({
      id: t.id,
      repoId: t.repoId,
      number: t.number,
      title: t.title,
      weight: WEIGHT_POINTS[t.weight] as 1 | 3 | 5,
      state: t.state,
      closedAt: t.closedAt,
      reopenedAt: t.reopenCount > 0 ? "2026-10-15T08:30:00Z" : null,
      pr: t.pr ?? null,
    })),
    digests: DIGESTS.map((d) => ({
      id: d.id,
      repoId: d.repoId,
      chatTitle: d.chatTitle,
      sentAt: d.sentAt,
      body: `Finished: Rate limit the webhook (+1), Requeue orphaned jobs (+3). Moved: ${d.messageCount} messages. Activity, not progress.`,
      cadence: d.cadence,
      pointsFinished: d.pointsFinished,
      status: d.status === "FAILED" ? "FAILED" : d.status === "DELIVERED" ? "DELIVERED" : "QUEUED",
      messageCount: d.messageCount,
    })),
    alerts: ALERTS.map((a) => ({
      id: a.id,
      kind: a.kind,
      repoId: a.repoId,
      actor: a.actor,
      at: a.at,
      detail: a.detail,
      delivered: a.delivered,
    })),
    chats: CHATS.map((c) => ({
      id: c.id,
      title: c.title,
      kind: c.kind,
      members: c.members,
      linkedRepoIds: REPOS.filter((r) => r.connected).slice(0, c.linkedRepos).map((r) => r.id),
      lastMessageAt: c.lastMessage,
      status: c.status,
    })),
    findings: FINDINGS.map((f) => ({
      id: f.id,
      path: f.path,
      rule: f.rule,
      repoId: f.repoId,
      commitSha: f.commitSha,
      at: f.at,
      status: "SKIPPED" as const,
    })),
    deliveries: DELIVERIES.map((d) => ({
      id: d.id,
      at: d.at,
      event: d.event,
      signature: "VERIFIED" as const,
      rateLimited: d.rateLimited,
      key: d.key,
      outcome: d.outcome,
    })),
    jobs: JOBS.map((j) => ({
      id: j.id,
      kind: j.kind,
      status: j.status,
      attempts: j.attempts,
    })),
  };
}
