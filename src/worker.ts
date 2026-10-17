import { classify } from "./brain/classify.js";
import { scan } from "./brain/scan.js";
import { summarize } from "./brain/summarize.js";
import { trim } from "./brain/trim.js";
import { backfillInstallation } from "./backfill.js";
import { prisma } from "./db.js";
import { appKeys } from "./githubAuth.js";
import { applyRepositoryChange, parseRepositoryEvent } from "./installations.js";
import { pruneMilestone, reconcileRepo } from "./reconcile.js";
import {
  formatCIFailed,
  formatCIFixed,
  formatPRMerged,
  formatPush,
  formatSecretAlert,
  formatStaleAlert,
  type FormatCommit,
} from "./formatter.js";
import { linkCommit } from "./linker.js";
import { syncRepoIssues } from "./github-sync.js";
import { claimNextJob, completeJob, failJob, JOB_MAX_ATTEMPTS, reclaimStuckJobs } from "./queue.js";
import { findStaleBranches } from "./stale.js";
import { deliver, dispatchDueNotifications } from "./delivery.js";
import type { JobRow } from "./queue.js";

// worker.ts — in-process pipeline:
// scan() → trim() → classify() → summarize() → link → store → Telegram.
// Secret scan runs on raw content before any LLM call, every commit.

type PushCommit = {
  id: string;
  message: string;
  timestamp?: string;
  author?: { username?: string; name?: string };
  added?: string[];
  modified?: string[];
};

type PushPayload = {
  repository?: { full_name?: string };
  ref?: string;
  compare?: string;
  forced?: boolean;
  commits?: PushCommit[];
};

/**
 * Pure: display login for a push commit author. Prefers the GitHub username
 * (exact login); falls back to the display name (better than "unknown" for
 * activity grouping); "unknown" only when both are absent.
 */
export function commitAuthorLogin(author?: { username?: string; name?: string }): string {
  const username = (author?.username ?? "").trim();
  if (username) return username;
  const name = (author?.name ?? "").trim();
  return name || "unknown";
}

type PullRequestPayload = {
  action?: string;
  number?: number;
  pull_request?: {
    number: number;
    title: string;
    state: string;
    merged?: boolean;
    merged_at?: string | null;
    body?: string | null;
    user?: { login?: string };
    base?: { ref?: string };
    head?: { ref?: string };
  };
  repository?: { full_name?: string };
};

type CheckRunPayload = {
  action?: string;
  check_run?: {
    id?: number;
    name: string;
    head_sha: string;
    status?: string;
    conclusion?: string | null;
    html_url?: string;
    check_suite?: { head_branch?: string };
  };
  repository?: { full_name?: string };
};

function isProtectedBranch(branch: string): boolean {
  return branch === "main" || branch === "master";
}

async function processPush(job: JobRow, payload: PushPayload): Promise<void> {
  const repo = payload.repository?.full_name ?? "unknown";
  const branch = (payload.ref ?? "").replace("refs/heads/", "") || "main";
  const commits = payload.commits ?? [];

  const formatted: FormatCommit[] = [];
  let directToMain = false;
  for (const c of commits.slice(0, 20)) {
    const files = [...(c.added ?? []), ...(c.modified ?? [])].map((p) => ({
      path: p,
      content: "",
    }));
    // NOTE: webhook payloads carry messages, not diffs. Scan runs on the
    // message here; full diff content is scanned in Phase 6 when fetched.
    const scanned = scan([{ path: "<message>", content: c.message }]);
    const secretFlag = scanned.hasSecret;
    void files;
    void trim;
    const category = classify(c.message);
    const isMerge = category === "merge";
    const link = linkCommit({ message: c.message, branch });
    void link;
    const author = c.author?.username ?? c.author?.name ?? "unknown";
    // Author attribution (mirrors api/webhook storePushCommits): every push
    // commit gets an Author row. Missing this once rendered the whole
    // dashboard as "unknown" — the worker path is the live one.
    const login = commitAuthorLogin(c.author);
    let authorId: string | undefined;
    try {
      const authorRow = await prisma.author.upsert({
        where: { githubLogin: login },
        update: {},
        create: {
          githubLogin: login,
          displayName: c.author?.username && author !== login ? author : undefined,
        },
      });
      authorId = authorRow.id;
    } catch {
      // attribution best-effort; the commit itself still records below
    }
    if (!isMerge && isProtectedBranch(branch)) directToMain = true;
    if (secretFlag) {
      // First-class secret notification: path only, never the value.
      // Priority: bypasses digest batching, goes to every subscriber now.
      await deliver(
        repo,
        "secret",
        formatSecretAlert({
          repo,
          branch,
          sha: c.id,
          file: "<message>",
          author,
        }),
        { priority: true },
      );
    }
    let aiSummary: string | undefined;
    let degraded = false;
    if (!isMerge && !secretFlag) {
      const s = await summarize({
        sha: c.id,
        message: c.message,
        diffExcerpt: "",
        aiEnabled: true,
      });
      aiSummary = s.text;
      degraded = s.degraded;
    }
    formatted.push({
      sha: c.id,
      message: c.message,
      author,
      category,
      aiSummary,
      degraded,
      isMerge,
      secretFlag,
    });
    try {
      const repoRow = await prisma.repo.upsert({
        where: { fullName: repo },
        update: {},
        create: { fullName: repo },
      });
      let committedAt: Date | null = null;
      if (c.timestamp) {
        const parsed = new Date(c.timestamp);
        if (!Number.isNaN(parsed.getTime())) committedAt = parsed;
      }
      await prisma.commit.upsert({
        where: { repoId_sha: { repoId: repoRow.id, sha: c.id } },
        update: {
          message: c.message.slice(0, 2000),
          category,
          secretFlag,
          isMerge,
          isForcePushContext: payload.forced ?? false,
          branch,
          ...(committedAt ? { committedAt } : {}),
          ...(authorId ? { authorId } : {}),
        },
        create: {
          repoId: repoRow.id,
          sha: c.id,
          message: c.message.slice(0, 2000),
          category,
          secretFlag,
          isMerge,
          isForcePushContext: payload.forced ?? false,
          aiSummary: aiSummary?.slice(0, 2000),
          branch,
          committedAt,
          ...(authorId ? { authorId } : {}),
        },
      });
    } catch {
      // dev without DB reachability: metadata only in memory, keep going
    }
  }

  if (formatted.length > 0) {
    const html = formatPush({
      repo,
      branch,
      commits: formatted,
      compareUrl: payload.compare,
      forced: payload.forced,
      directToMain,
    });
    // Forced / direct-to-main digests are priority: risk alerts go now.
    await deliver(repo, "push", html, { priority: payload.forced === true || directToMain });
  }
  // Refresh issues/milestones from the source of truth (best-effort).
  await syncRepoIssues(repo);
  await completeJob(job.id);
}

const CLOSES_RE = /clos(?:e|es|ed|ing)\s+#(\d+)/gi;

async function processPullRequest(job: JobRow, payload: PullRequestPayload): Promise<void> {
  const repo = payload.repository?.full_name ?? "unknown";
  const pr = payload.pull_request;
  if (!pr) {
    await completeJob(job.id);
    return;
  }
  const merged = pr.state === "closed" && pr.merged === true;
  const linked: number[] = [];
  for (const m of (pr.body ?? "").matchAll(CLOSES_RE)) {
    linked.push(Number(m[1]));
  }
  try {
    const repoRow = await prisma.repo.upsert({
      where: { fullName: repo },
      update: {},
      create: { fullName: repo },
    });
    let authorId: string | undefined;
    if (pr.user?.login) {
      const author = await prisma.author.upsert({
        where: { githubLogin: pr.user.login },
        update: {},
        create: { githubLogin: pr.user.login },
      });
      authorId = author.id;
    }
    await prisma.pullRequest.upsert({
      where: { repoId_number: { repoId: repoRow.id, number: pr.number } },
      update: {
        title: pr.title.slice(0, 500),
        state: merged ? "merged" : pr.state,
        mergedAt: pr.merged_at ? new Date(pr.merged_at) : undefined,
        baseBranch: pr.base?.ref,
        headBranch: pr.head?.ref,
        linkedIssueIds: linked,
      },
      create: {
        repoId: repoRow.id,
        number: pr.number,
        title: pr.title.slice(0, 500),
        state: merged ? "merged" : pr.state,
        authorId,
        baseBranch: pr.base?.ref,
        headBranch: pr.head?.ref,
        mergedAt: pr.merged_at ? new Date(pr.merged_at) : undefined,
        linkedIssueIds: linked,
      },
    });
  } catch {
    // dev without DB: keep going, still notify
  }
  // Squash-merge included: the PR merged event is the truth.
  if (merged) {
    await deliver(
      repo,
      "pr",
      formatPRMerged({
        repo,
        prNumber: pr.number,
        title: pr.title,
        author: pr.user?.login ?? "unknown",
      }),
    );
  }
  // PR open/close/merge changes issue states — resync (best-effort).
  await syncRepoIssues(repo);
  await completeJob(job.id);
}

async function processCheckRun(job: JobRow, payload: CheckRunPayload): Promise<void> {
  const repo = payload.repository?.full_name ?? "unknown";
  const run = payload.check_run;
  if (!run || payload.action !== "completed") {
    await completeJob(job.id);
    return;
  }
  const branch = run.check_suite?.head_branch ?? "unknown";
  const conclusion = run.conclusion ?? "unknown";
  const status = conclusion === "success" ? "success" : conclusion === "failure" ? "failure" : "pending";
  try {
    const repoRow = await prisma.repo.upsert({
      where: { fullName: repo },
      update: {},
      create: { fullName: repo },
    });
    await prisma.build.create({
      data: {
        repoId: repoRow.id,
        commitSha: run.head_sha,
        branch,
        status,
        buildNumber: String(run.id ?? run.name),
        runUrl: run.html_url,
      },
    });
  } catch {
    // dev without DB: keep going, still notify on failure
  }
  if (conclusion === "failure") {
    await deliver(
      repo,
      "ci",
      formatCIFailed({
        repo,
        branch,
        build: String(run.id ?? run.name),
        runUrl: run.html_url,
      }),
      { priority: true },
    );
  } else if (conclusion === "success") {
    // "Fixed" only if a prior failure exists for this commit; without DB
    // there is no history to confirm, so stay silent.
    try {
      const repoRow = await prisma.repo.findUnique({ where: { fullName: repo } });
      const priorFailure = repoRow
        ? await prisma.build.findFirst({
            where: { repoId: repoRow.id, commitSha: run.head_sha, status: "failure" },
          })
        : null;
      if (priorFailure) {
        await deliver(
          repo,
          "ci",
          formatCIFixed({
            repo,
            branch,
            build: String(run.id ?? run.name),
            runUrl: run.html_url,
          }),
        );
      }
    } catch {
      // no history available — no fixed alert
    }
  }
  await completeJob(job.id);
}

async function processStaleCheck(
  job: JobRow,
  payload: { repo?: string; thresholdDays?: number },
): Promise<void> {
  const repo = payload.repo ?? "";
  const threshold = payload.thresholdDays ?? 6;
  if (!repo) {
    await completeJob(job.id);
    return;
  }
  try {
    const repoRow = await prisma.repo.findUnique({ where: { fullName: repo } });
    if (!repoRow) {
      await completeJob(job.id);
      return;
    }
    const commits = await prisma.commit.findMany({
      where: { repoId: repoRow.id, branch: { not: null } },
      select: { branch: true, committedAt: true, createdAt: true },
    });
    const latest = new Map<string, Date>();
    for (const c of commits) {
      if (!c.branch) continue;
      const at = c.committedAt ?? c.createdAt;
      const prev = latest.get(c.branch);
      if (!prev || at > prev) latest.set(c.branch, at);
    }
    const stale = findStaleBranches(
      [...latest].map(([name, lastActivityAt]) => ({ name, lastActivityAt })),
      new Date(),
      threshold,
    );
    if (stale.length > 0) {
      await deliver(repo, "stale", formatStaleAlert({ repo, branches: stale }));
    }
  } catch {
    // dev without DB: nothing to check
  }
  await completeJob(job.id);
}

export async function processJob(job: JobRow): Promise<void> {
  switch (job.type) {
    case "push":
      await processPush(job, job.payload as PushPayload);
      return;
    case "pull_request":
      await processPullRequest(job, job.payload as PullRequestPayload);
      return;
    case "check_run":
      await processCheckRun(job, job.payload as CheckRunPayload);
      return;
    case "issues": {
      const repo =
        (job.payload as { repository?: { full_name?: string } }).repository?.full_name ??
        "unknown";
      // closed/reopened edited directly on GitHub — recompute from the API.
      if (repo !== "unknown") await syncRepoIssues(repo);
      await completeJob(job.id);
      return;
    }
    case "milestone": {
      const p = job.payload as {
        action?: string;
        repository?: { full_name?: string };
        milestone?: { number?: number };
      };
      const repo = p.repository?.full_name ?? "unknown";
      // Milestone opened/closed/edited/deleted — recompute from the API.
      // Deleted prunes the exact milestone row first (targeted, no page guard needed).
      if (repo !== "unknown") {
        if (p.action === "deleted" && p.milestone?.number !== undefined) {
          await pruneMilestone(repo, p.milestone.number);
        }
        await syncRepoIssues(repo);
      }
      await completeJob(job.id);
      return;
    }
    case "progress_sync": {
      // Periodic reconcile (operator-enqueued, like stale_check): diff DB vs
      // API and fix drift. Best-effort — null still completes the job.
      const repo = (job.payload as { repo?: string }).repo ?? "unknown";
      if (repo !== "unknown") await reconcileRepo(repo);
      await completeJob(job.id);
      return;
    }
    case "repository": {
      // Repo deleted/renamed on GitHub — deactivate or move the row so
      // delivery stops and future events route correctly.
      const change = parseRepositoryEvent(job.payload);
      if (change) await applyRepositoryChange(change);
      await completeJob(job.id);
      return;
    }
    case "stale_check":
      await processStaleCheck(job, job.payload as { repo?: string; thresholdDays?: number });
      return;
    case "backfill": {
      // One-shot per-install sync. RateLimitedError propagates to failJob()
      // backoff; missing App config completes (retry would never help).
      const installationId = (job.payload as { installationId?: string | number })
        .installationId;
      if (installationId === undefined) {
        await completeJob(job.id);
        return;
      }
      let keys;
      try {
        keys = appKeys();
      } catch {
        await completeJob(job.id);
        return;
      }
      try {
        const totals = await backfillInstallation(installationId, keys);
        console.log(
          JSON.stringify({
            msg: "backfill_done",
            jobId: job.id,
            installationId: String(installationId),
            totals,
          }),
        );
      } catch (err) {
        console.warn(
          JSON.stringify({
            msg: "backfill_failed",
            jobId: job.id,
            installationId: String(installationId),
            err: String(err),
          }),
        );
        throw err;
      }
      await completeJob(job.id);
      return;
    }
    default:
      await completeJob(job.id);
  }
}

export function startWorker(
  log: { info: (o: object, m: string) => void; error: (o: object, m: string) => void },
  intervalMs = 5000,
): NodeJS.Timeout {
  // Self-heal on boot: this process is fresh, so anything still `processing`
  // was orphaned by the previous instance dying (Render free sleep/deploy).
  void reclaimStuckJobs()
    .then((n) => {
      if (n > 0) log.info({ count: n }, "jobs_reclaimed_stale");
    })
    .catch(() => {
      // reclaim is best-effort; the queue still makes progress without it
    });
  let ticks = 0;
  const reclaimEveryTicks = Math.max(1, Math.round(120_000 / intervalMs));
  const timer = setInterval(async () => {
    try {
      const job = await claimNextJob();
      if (job) {
        // Per-job catch: a throwing job must go back to the queue with
        // backoff (failJob), not be left in `processing`. Without this the
        // outer catch only logged, so every failure became an orphan —
        // including the 429s that are explicitly not to be dropped.
        try {
          await processJob(job);
        } catch (err) {
          const abandoned = job.attempts >= JOB_MAX_ATTEMPTS;
          log.error(
            { err, jobId: job.id, type: job.type, attempts: job.attempts, abandoned },
            abandoned ? "job_abandoned" : "job_failed",
          );
          await failJob(job.id, job.attempts);
        }
      }
      await dispatchDueNotifications();
      if (++ticks % reclaimEveryTicks === 0) {
        const n = await reclaimStuckJobs();
        if (n > 0) log.info({ count: n }, "jobs_reclaimed_stale");
      }
    } catch (err) {
      log.error({ err }, "worker poll failed");
    }
  }, intervalMs);
  timer.unref?.();
  return timer;
}

export async function drainOnce(): Promise<boolean> {
  const job = await claimNextJob();
  if (!job) return false;
  try {
    await processJob(job);
  } catch {
    await failJob(job.id, job.attempts);
  }
  return true;
}
