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
import { syncRepoIssues, stampIssueTimestamps } from "./github-sync.js";
import { claimNextJob, completeJob, enqueueJob, failJob, JOB_MAX_ATTEMPTS, reclaimStuckJobs, abandonJob } from "./queue.js";
import { jobFailureAction, PermanentJobError } from "./jobErrors.js";
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
    html_url?: string;
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

  // One repo row up front: it carries ai_enabled (rule 7) and seeds the
  // open-issue set used for real linking (rule 11). Null when the DB is
  // unreachable — formatting + notification still run below.
  let repoId: string | null = null;
  let aiEnabled = true;
  const issueByNumber = new Map<number, string>();
  const openIssues: { number: number; title: string }[] = [];
  try {
    const repoRow = await prisma.repo.upsert({
      where: { fullName: repo },
      update: {},
      create: { fullName: repo },
    });
    repoId = repoRow.id;
    aiEnabled = repoRow.aiEnabled;
    const rows = await prisma.issue.findMany({
      where: { repoId: repoRow.id },
      select: { id: true, number: true, title: true, state: true },
    });
    for (const i of rows) {
      issueByNumber.set(i.number, i.id);
      if (i.state !== "closed") openIssues.push({ number: i.number, title: i.title });
    }
  } catch {
    // DB unreachable: no attribution/link/AI-flag persistence this pass
  }

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
    // Real links only: strong (closes #N) or weak (#N / branch). A heuristic
    // suggestion is deliberately NOT persisted — it stays "Unlinked work"
    // (rule 11: never auto-assign a suggestion).
    const link = linkCommit({ message: c.message, branch, openIssues });
    const linkedIssueId =
      link.kind === "strong" || link.kind === "weak" || link.kind === "pr"
        ? issueByNumber.get(link.issue)
        : undefined;
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
          file: "(commit message)",
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
        aiEnabled,
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
    if (!repoId) continue;
    try {
      let committedAt: Date | null = null;
      if (c.timestamp) {
        const parsed = new Date(c.timestamp);
        if (!Number.isNaN(parsed.getTime())) committedAt = parsed;
      }
      await prisma.commit.upsert({
        where: { repoId_sha: { repoId, sha: c.id } },
        update: {
          message: c.message.slice(0, 2000),
          category,
          secretFlag,
          isMerge,
          isForcePushContext: payload.forced ?? false,
          branch,
          ...(committedAt ? { committedAt } : {}),
          ...(authorId ? { authorId } : {}),
          ...(linkedIssueId ? { issueId: linkedIssueId } : {}),
        },
        create: {
          repoId,
          sha: c.id,
          message: c.message.slice(0, 2000),
          category,
          secretFlag,
          isMerge,
          isForcePushContext: payload.forced ?? false,
          // A degraded summary is the message itself: storing it would make
          // every row carry a duplicate of its subject (rule 7).
          ...(degraded || !aiSummary ? {} : { aiSummary: aiSummary.slice(0, 2000) }),
          branch,
          committedAt,
          issueId: linkedIssueId ?? null,
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
        prUrl: pr.html_url,
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

export type JobRunOptions = {
  /**
   * Epoch ms after which a job must stop starting new work. Request-driven
   * hosts kill the function at a hard cap; a job that stops between units can
   * save a cursor and continue in a fresh call, while one that is killed
   * mid-flight loses the work it had not written yet.
   */
  deadline?: number;
};

export async function processJob(job: JobRow, opts: JobRunOptions = {}): Promise<void> {
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
      const p = job.payload as {
        action?: string;
        repository?: { full_name?: string };
        issue?: {
          number?: number;
          state?: string;
          closed_at?: string | null;
          updated_at?: string;
        };
      };
      const repo = p.repository?.full_name ?? "unknown";
      // closed/reopened edited directly on GitHub — recompute from the API,
      // then stamp the moment: the sync knows the state, only the event knows
      // when a reopen happened.
      if (repo !== "unknown") {
        await syncRepoIssues(repo);
        await stampIssueTimestamps(repo, p);
      }
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
      const payload = job.payload as {
        installationId?: string | number;
        resumeAt?: number | string;
      };
      const installationId = payload.installationId;
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
      const resumeAt = Number(payload.resumeAt ?? 0) || 0;
      try {
        const totals = await backfillInstallation(installationId, keys, {
          startAt: resumeAt,
          deadline: opts.deadline,
        });
        console.log(
          JSON.stringify({
            msg: "backfill_done",
            jobId: job.id,
            installationId: String(installationId),
            totals,
          }),
        );
        if (totals.resumeAt !== null) {
          // A big install cannot be covered inside one function call, so the
          // rest continues as its own job: the cursor travels in the payload
          // and the delivery id keeps the `sync-<id>-` prefix that
          // cancelQueuedBackfills() matches on uninstall.
          await enqueueJob("backfill", `${job.deliveryId}:r${totals.resumeAt}`, {
            installationId,
            resumeAt: totals.resumeAt,
          });
        }
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

export type WorkerLog = {
  info: (o: object, m: string) => void;
  error: (o: object, m: string) => void;
};

/**
 * Run one claimed job under the queue's failure policy. Never throws.
 *
 * Per-job catch: a throwing job must go back to the queue with backoff
 * (failJob), not be left in `processing`. Without this the outer catch only
 * logged, so every failure became an orphan — including the 429s that are
 * explicitly not to be dropped.
 */
export async function runClaimedJob(
  job: JobRow,
  log: WorkerLog,
  opts: JobRunOptions = {},
): Promise<void> {
  try {
    await processJob(job, opts);
  } catch (err) {
    // PermanentJobError (e.g. a deleted installation) can never succeed:
    // abandon on the first failure. Everything else retries with backoff, up
    // to JOB_MAX_ATTEMPTS, so a poison payload still stops eventually.
    const action = jobFailureAction(err, job.attempts, JOB_MAX_ATTEMPTS);
    const permanent = err instanceof PermanentJobError;
    log.error(
      {
        err,
        jobId: job.id,
        type: job.type,
        attempts: job.attempts,
        action,
        permanent,
      },
      permanent ? "job_abandoned_permanent" : action === "abandon" ? "job_abandoned" : "job_failed",
    );
    if (action === "abandon") await abandonJob(job.id);
    else await failJob(job.id, job.attempts);
  }
}

/**
 * The long-lived poller, for a host that keeps a process alive (local dev,
 * `npm start`). The deployed worker is request-driven instead — see
 * src/workerTick.ts — so this is not required for production.
 */
export function startWorker(log: WorkerLog, intervalMs = 5000): NodeJS.Timeout {
  // Self-heal on boot: this process is fresh, so anything still `processing`
  // was orphaned by the previous instance dying.
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
      if (job) await runClaimedJob(job, log);
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
