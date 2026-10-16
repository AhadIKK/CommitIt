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

const PullResponse = z.array(
  z.object({
    number: z.number(),
    title: z.string(),
    state: z.string(),
    merged_at: z.string().nullable(),
    user: z.object({ login: z.string() }).nullish(),
    base: z.object({ ref: z.string() }).nullish(),
    head: z.object({ ref: z.string() }).nullish(),
  }),
);

/**
 * Backfill merged PRs. The `pull_request` webhook only records PRs from
 * install onward, so history otherwise reads 0 forever. Closed-but-unmerged
 * PRs are skipped (activity = merges). Bodies are NOT fetched — linkedIssueIds
 * stays [] here; the live PR webhook fills links going forward.
 */
export async function backfillRepoPRs(
  fullName: string,
  token: string,
  deps: BackfillDeps = {},
): Promise<{ prs: number; merged: number } | null> {
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
  let merged = 0;
  for (let page = 1; page <= maxPages; page++) {
    const res = await authedGet(
      `https://api.github.com/repos/${fullName}/pulls?state=closed&sort=updated&direction=desc&per_page=${perPage}&page=${page}`,
      token,
      {},
      fetchFn,
    );
    const waitMs = rateLimitWaitMs(res);
    if (waitMs !== null) throw new RateLimitedError(waitMs);
    if (!res.ok) return null;
    const parsed = PullResponse.safeParse(await res.json());
    if (!parsed.success) return null;
    if (parsed.data.length === 0) break;
    for (const p of parsed.data) {
      if (!p.merged_at) continue;
      try {
        let authorId: string | undefined;
        if (p.user?.login) {
          const author = await prisma.author.upsert({
            where: { githubLogin: p.user.login },
            update: {},
            create: { githubLogin: p.user.login },
          });
          authorId = author.id;
        }
        await prisma.pullRequest.upsert({
          where: { repoId_number: { repoId: repoRow.id, number: p.number } },
          update: {
            title: p.title.slice(0, 500),
            state: "merged",
            mergedAt: new Date(p.merged_at),
            baseBranch: p.base?.ref,
            headBranch: p.head?.ref,
          },
          create: {
            repoId: repoRow.id,
            number: p.number,
            title: p.title.slice(0, 500),
            state: "merged",
            authorId,
            baseBranch: p.base?.ref,
            headBranch: p.head?.ref,
            mergedAt: new Date(p.merged_at),
            linkedIssueIds: [],
          },
        });
        merged += 1;
      } catch {
        // one bad row never blocks the page
      }
    }
    if (parsed.data.length < perPage) break;
  }
  return { prs: merged, merged };
}

const CommitShaResponse = z.object({
  sha: z.string(),
  author: z.object({ login: z.string() }).nullish(),
  commit: z.object({ author: z.object({ name: z.string() }).nullish() }).nullish(),
});

/**
 * Heal commit rows stored without an author (pre-attribution pushes).
 * Resolves up to 50 recent unattributed SHAs via the API — best-effort,
 * never throws, never blocks the backfill on rate limits.
 */
export async function repairCommitAuthors(
  fullName: string,
  token: string,
  deps: BackfillDeps = {},
): Promise<{ repaired: number }> {
  const fetchFn = deps.fetchFn ?? fetch;
  let rows: { id: string; sha: string }[];
  try {
    const repoRow = await prisma.repo.findUnique({ where: { fullName } });
    if (!repoRow) return { repaired: 0 };
    rows = await prisma.commit.findMany({
      where: { repoId: repoRow.id, authorId: null },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, sha: true },
    });
  } catch {
    return { repaired: 0 };
  }
  let repaired = 0;
  for (const row of rows) {
    try {
      const shaUrl = `https://api.github.com/repos/${fullName}/commits/${row.sha}`;
      let res = await authedGet(shaUrl, token, {}, fetchFn);
      if (!res.ok) {
        // Token lacks this repo (stale/empty grant, private-only token):
        // public repos stay readable without auth — retry bare.
        try {
          res = await fetchFn(shaUrl, {
            headers: {
              Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
            },
          });
        } catch {
          continue;
        }
      }
      if (rateLimitWaitMs(res) !== null) break; // quota first, healing later
      if (!res.ok) continue;
      const parsed = CommitShaResponse.safeParse(await res.json());
      if (!parsed.success) continue;
      const login =
        parsed.data.author?.login ?? parsed.data.commit?.author?.name ?? null;
      if (!login) continue;
      const author = await prisma.author.upsert({
        where: { githubLogin: login },
        update: {},
        create: { githubLogin: login },
      });
      await prisma.commit.update({ where: { id: row.id }, data: { authorId: author.id } });
      repaired += 1;
    } catch {
      // one bad SHA never blocks the rest
    }
  }
  return { repaired };
}
/** Backfill every repo on an installation. Returns per-repo outcomes. */
export async function backfillInstallation(
  installationId: bigint | number | string,
  keys: KeyMaterial,
  deps: BackfillDeps = {},
): Promise<{ repos: number; issues: number; milestones: number; prs: number; authorsRepaired: number }> {
  const fetchFn = deps.fetchFn ?? fetch;
  const token = await getInstallationToken(installationId, keys, { fetchFn });
  const totals = { repos: 0, issues: 0, milestones: 0, prs: 0, authorsRepaired: 0 };
  const perPage = 100;
  // API-listed repos first; then DB-known repos for this install. The API
  // list can be empty while our rows still reference the install (stale or
  // empty grant) — healing must not depend on the grant being healthy.
  const apiNames: string[] = [];
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
    for (const r of parsed.data.repositories) apiNames.push(r.full_name);
    if (parsed.data.repositories.length < perPage) break;
  }
  let dbNames: string[] = [];
  try {
    const installKey =
      typeof installationId === "string" ? BigInt(installationId) : installationId;
    const rows = await prisma.repo.findMany({
      where: { installationId: installKey },
      select: { fullName: true },
    });
    dbNames = rows.map((r) => r.fullName);
  } catch {
    dbNames = [];
  }
  const seen = new Set<string>();
  const allNames: string[] = [];
  for (const n of [...apiNames, ...dbNames]) {
    if (!seen.has(n)) {
      seen.add(n);
      allNames.push(n);
    }
  }
  for (const fullName of allNames) {
    const out = await backfillRepoIssues(fullName, token, deps);
    totals.repos += 1;
    if (out && !out.skipped) {
      totals.issues += out.issues;
      totals.milestones += out.milestones;
    }
    // PR history + author healing ride the same install sync (Sync now
    // re-runs this). PR rate-limits propagate for worker backoff like
    // issues; repair is fully best-effort and never throws.
    const prOut = await backfillRepoPRs(fullName, token, deps);
    if (prOut) totals.prs += prOut.merged;
    const fixed = await repairCommitAuthors(fullName, token, deps).catch(() => ({
      repaired: 0,
    }));
    totals.authorsRepaired += fixed.repaired;
  }
  return totals;
}
