import { z } from "zod";
import { prisma } from "./db.js";
import { getInstallationToken, type KeyMaterial } from "./githubAuth.js";
import { storeSyncedIssues, type SyncIssue } from "./github-sync.js";

// backfill.ts — one-shot per-installation sync (Phase B). Lists the install's
// repos, then pages issues with ETag (304 = skip, updates lastSyncAt).
// Rate limits (429 / 403 with exhausted quota) throw RateLimitedError so the
// worker's failJob() backoff retries; everything else degrades to null.

export class RateLimitedError extends Error {
  retryAfterMs: number;
  constructor(retryAfterMs: number) {
    super("github_rate_limited");
    this.retryAfterMs = retryAfterMs;
  }
}

export type BackfillDeps = {
  fetchFn?: typeof fetch;
  perPage?: number;
  maxPages?: number;
};

const ReposResponse = z.object({
  repositories: z.array(z.object({ full_name: z.string() })),
});

const IssueResponse = z.array(
  z.object({
    number: z.number(),
    title: z.string(),
    state: z.string(),
    pull_request: z.unknown().optional(),
    labels: z.array(z.object({ name: z.string() })).default([]),
    milestone: z.object({ number: z.number(), title: z.string() }).nullable().optional(),
  }),
);

function weightFromLabels(labels: { name: string }[]): number {
  for (const l of labels) {
    const n = l.name.toLowerCase();
    if (n === "s" || n.includes("small") || n.includes("1")) return 1;
    if (n === "m" || n.includes("medium") || n.includes("3")) return 3;
    if (n === "l" || n.includes("large") || n.includes("5")) return 5;
  }
  return 1;
}

function rateLimitWaitMs(res: Response): number | null {
  if (res.status === 429) {
    const after = Number(res.headers.get("retry-after"));
    return Number.isFinite(after) && after > 0 ? after * 1000 : 60_000;
  }
  if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") {
    const resetSec = Number(res.headers.get("x-ratelimit-reset"));
    if (Number.isFinite(resetSec) && resetSec > 0) {
      return Math.max(0, resetSec * 1000 - Date.now()) + 1000;
    }
    return 60_000;
  }
  return null;
}

async function authedGet(
  url: string,
  token: string,
  extra: Record<string, string>,
  fetchFn: typeof fetch,
): Promise<Response> {
  return fetchFn(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      Authorization: `Bearer ${token}`,
      ...extra,
    },
  });
}

/** Backfill one repo's issues with ETag. 304 = metadata touch only. */
export async function backfillRepoIssues(
  fullName: string,
  token: string,
  deps: BackfillDeps = {},
): Promise<{ issues: number; milestones: number; skipped: boolean } | null> {
  const fetchFn = deps.fetchFn ?? fetch;
  const perPage = Math.min(Math.max(deps.perPage ?? 100, 1), 100);
  const maxPages = Math.min(Math.max(deps.maxPages ?? 10, 1), 10);
  let repoRow;
  try {
    repoRow = await prisma.repo.upsert({
      where: { fullName },
      update: {},
      create: { fullName },
    });
  } catch {
    return null;
  }

  const issues: SyncIssue[] = [];
  const milestones = new Map<number, string>();
  for (let page = 1; page <= maxPages; page++) {
    const headers: Record<string, string> = {};
    if (page === 1 && repoRow.syncEtag) headers["If-None-Match"] = repoRow.syncEtag;
    const res = await authedGet(
      `https://api.github.com/repos/${fullName}/issues?state=all&per_page=${perPage}&page=${page}`,
      token,
      headers,
      fetchFn,
    );
    if (page === 1 && res.status === 304) {
      try {
        await prisma.repo.update({
          where: { id: repoRow.id },
          data: { lastSyncAt: new Date() },
        });
      } catch {
        // metadata touch is best-effort
      }
      return { issues: 0, milestones: 0, skipped: true };
    }
    const waitMs = rateLimitWaitMs(res);
    if (waitMs !== null) throw new RateLimitedError(waitMs);
    if (!res.ok) return null;
    if (page === 1) {
      const etag = res.headers.get("etag");
      try {
        await prisma.repo.update({
          where: { id: repoRow.id },
          data: { syncEtag: etag, lastSyncAt: new Date() },
        });
      } catch {
        return null;
      }
    }
    const parsed = IssueResponse.safeParse(await res.json());
    if (!parsed.success) return null;
    if (parsed.data.length === 0) break;
    for (const it of parsed.data) {
      if (it.pull_request !== undefined) continue; // PRs are not progress
      issues.push({
        number: it.number,
        title: it.title,
        state: it.state === "closed" ? "closed" : "open",
        sizeWeight: weightFromLabels(it.labels ?? []),
        milestoneNumber: it.milestone?.number,
      });
      if (it.milestone) milestones.set(it.milestone.number, it.milestone.title);
    }
    if (parsed.data.length < perPage) break;
  }
  const stored = await storeSyncedIssues(fullName, {
    issues,
    milestones: [...milestones].map(([number, title]) => ({ number, title })),
  });
  if (!stored) return null;
  return { ...stored, skipped: false };
}

/** Backfill every repo on an installation. Returns per-repo outcomes. */
export async function backfillInstallation(
  installationId: bigint | number | string,
  keys: KeyMaterial,
  deps: BackfillDeps = {},
): Promise<{ repos: number; issues: number; milestones: number }> {
  const fetchFn = deps.fetchFn ?? fetch;
  const token = await getInstallationToken(installationId, keys, { fetchFn });
  const totals = { repos: 0, issues: 0, milestones: 0 };
  const perPage = 100;
  for (let page = 1; ; page++) {
    const res = await authedGet(
      `https://api.github.com/app/installations/${installationId.toString()}/repositories?per_page=${perPage}&page=${page}`,
      token,
      {},
      fetchFn,
    );
    const waitMs = rateLimitWaitMs(res);
    if (waitMs !== null) throw new RateLimitedError(waitMs);
    if (!res.ok) break;
    const parsed = ReposResponse.safeParse(await res.json());
    if (!parsed.success || parsed.data.repositories.length === 0) break;
    for (const r of parsed.data.repositories) {
      const out = await backfillRepoIssues(r.full_name, token, deps);
      totals.repos += 1;
      if (out && !out.skipped) {
        totals.issues += out.issues;
        totals.milestones += out.milestones;
      }
    }
    if (parsed.data.repositories.length < perPage) break;
  }
  return totals;
}
