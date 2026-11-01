import { classify } from "./brain/classify.js";
import { addedLines, buildExcerpt, fetchCommitDiff, parseUnifiedDiff, secretPaths } from "./brain/diff.js";
import { scan } from "./brain/scan.js";
import { summarize } from "./brain/summarize.js";
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
  let installationId: bigint | null = null;
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
    installationId = repoRow.installationId;
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
  // Diffs are not in the webhook payload, so they are fetched. Bound the work:
  // a 20-commit push still has to fit inside the function cap, and past this
  // many commits the previous message-only path runs unchanged.
  const MAX_DIFF_COMMITS = 10;
  // Per-fetch there is a 4s timeout, so ten fetches could spend 40s of the
  // function's 45s budget before a single summary is written. A total budget
  // turns that cliff into a slope: whatever is not fetched in time simply
  // keeps the old message-only behaviour.
  const DIFF_BUDGET_MS = 6000;
  const diffDeadline = Date.now() + DIFF_BUDGET_MS;
  let keys: ReturnType<typeof appKeys> | null = null;
  try {
    keys = appKeys();
  } catch {
    // No App key material (local dev): stay message-only rather than fail.
  }
  for (const [index, c] of commits.slice(0, 20).entries()) {
    const category = classify(c.message);
    const isMerge = category === "merge";
    let diffFiles: ReturnType<typeof parseUnifiedDiff> = [];
    if (
      keys &&
      installationId !== null &&
      !isMerge &&
      index < MAX_DIFF_COMMITS &&
      Date.now() < diffDeadline
    ) {
      const raw = await fetchCommitDiff({ installationId, keys, repo, sha: c.id });
      diffFiles = parseUnifiedDiff(raw);
    }
    // Rule 6: scan the code before it can reach the LLM. Only additions count
    // — a removed line is the leak leaving, not arriving. Falls back to the
    // message when no diff is available (merges, fetch failures, DB-less dev).
    const scanned = diffFiles.length
      ? scan(addedLines(diffFiles))
      : scan([{ path: "<message>", content: c.message }]);
    const secretFlag = scanned.hasSecret;
    const secretFiles = new Set(secretPaths(scanned.hits));
    const diffExcerpt = buildExcerpt(diffFiles, secretFiles);
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
          file: scanned.hits[0]?.file ?? "(commit message)",
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
        diffExcerpt,
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
          // Same guard as `create`: a degraded summary is the message itself,
          // so it must never overwrite the row. But a real one may: without
          // this, a re-delivery of a commit ingested while AI was off updated
          // everything except the field that was actually missing.
          ...(degraded || !aiSummary ? {} : { aiSummary: aiSummary.slice(0, 2000) }),
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

/**
 * Pure: should this batch hand the rest to a fresh job?
 *
 * A backfill re-enqueues only when it both made progress and ran out of room.
 * Re-enqueueing without progress would spin forever on rows the provider
 * refuses to summarise (a 429, or a repo with AI disabled), and the free tier
 * has a request budget worth not burning.
 */
export function backfillContinuation(input: {
  rowCount: number;
  limit: number;
  filled: number;
  stoppedForTime: boolean;
  lastId?: string | null;
}): string | null {
  const { rowCount, limit, filled, stoppedForTime, lastId } = input;
  if (!lastId) return null;
  if (filled <= 0) return null;
  const ranOut = rowCount === limit || stoppedForTime;
  return ranOut ? lastId : null;
}

/**
 * Backfill `aiSummary` from inside the deployment.
 *
 * The key that can call the provider exists only in Vercel, and Vercel secrets
 * are not readable, so a backfill either runs here or does not run. This goes
 * through the ordinary job queue — no admin endpoint, no secret leaving the
 * environment it already lives in — and it summarises the way the live path
 * does: fetch the diff, scan what the commit *adds*, and only then summarise.
 * A row that turns out to have introduced a secret is flagged and left
 * unsummarised (rule 6), which also repairs commits ingested before diffs were
 * scanned at all.
 */
async function processSummariesBackfill(
  job: JobRow,
  payload: { since?: string; limit?: number; cursor?: string },
  opts: JobRunOptions,
): Promise<void> {
  const provider = (process.env.AI_PROVIDER ?? "echo").toLowerCase();
  if (provider === "echo" || !(process.env.AI_API_KEY ?? "").trim()) {
    // Completing rather than throwing: a missing key is configuration, not a
    // transient failure, and retrying it twenty times helps nobody.
    console.log(JSON.stringify({ msg: "summaries_skipped_no_ai", jobId: job.id, provider }));
    await completeJob(job.id);
    return;
  }

  const limit = Math.min(20, Math.max(1, Number(payload.limit ?? 5) || 5));
  const parsedSince = payload.since ? new Date(payload.since) : null;
  const since = parsedSince && !Number.isNaN(parsedSince.getTime()) ? parsedSince : null;
  const cursor = payload.cursor ?? null;

  const rows = await prisma.commit.findMany({
    where: {
      aiSummary: null,
      isMerge: false,
      secretFlag: false,
      message: { not: "" },
      repo: { aiEnabled: true },
      ...(since ? { createdAt: { gte: since } } : {}),
      ...(cursor ? { id: { gt: cursor } } : {}),
    },
    // Ids are cuids, so ascending is stable and roughly chronological; the
    // cursor is a unique key rather than a timestamp that two rows can share.
    orderBy: { id: "asc" },
    take: limit,
    select: {
      id: true,
      sha: true,
      message: true,
      repo: { select: { fullName: true, installationId: true } },
    },
  });

  let keys: ReturnType<typeof appKeys> | null = null;
  try {
    keys = appKeys();
  } catch {
    // No App key material: summarise from the message alone, as before.
  }

  let filled = 0;
  let lastId: string | null = cursor;
  let stoppedForTime = false;

  for (const row of rows) {
    if (opts.deadline && Date.now() > opts.deadline) {
      stoppedForTime = true;
      break;
    }
    lastId = row.id;

    let excerpt = "";
    const installationId = row.repo.installationId;
    if (keys && installationId !== null) {
      const raw = await fetchCommitDiff({
        installationId,
        keys,
        repo: row.repo.fullName,
        sha: row.sha,
      });
      const files = parseUnifiedDiff(raw);
      if (files.length) {
        const scanned = scan(addedLines(files));
        if (scanned.hasSecret) {
          await prisma.commit.update({ where: { id: row.id }, data: { secretFlag: true } });
          console.log(JSON.stringify({ msg: "summary_secret_found", sha: row.sha, file: scanned.hits[0]?.file }));
          continue;
        }
        excerpt = buildExcerpt(files, new Set(secretPaths(scanned.hits)));
      }
    }

    const s = await summarize({ sha: row.sha, message: row.message, diffExcerpt: excerpt, aiEnabled: true });
    if (s.degraded) continue;
    await prisma.commit.update({
      where: { id: row.id },
      data: { aiSummary: s.text.slice(0, 2000) },
    });
    filled += 1;
  }

  console.log(
    JSON.stringify({ msg: "summaries_batch", jobId: job.id, rows: rows.length, filled, stoppedForTime }),
  );

  const next = backfillContinuation({ rowCount: rows.length, limit, filled, stoppedForTime, lastId });
  if (next) {
    await enqueueJob("summaries", `${job.deliveryId}:c${next}`, { ...payload, cursor: next });
  }
  await completeJob(job.id);
}

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
    case "summaries":
      // Backfill of missing aiSummary values, run where the AI key already is.
      await processSummariesBackfill(
        job,
        job.payload as { since?: string; limit?: number; cursor?: string },
        opts,
      );
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
