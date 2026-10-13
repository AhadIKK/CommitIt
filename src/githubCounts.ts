import { appKeys, getInstallationToken } from "./githubAuth.js";

// githubCounts.ts — live GitHub numbers so dashboard totals match github.com.
// Our commit rows span every pushed branch plus force-push orphans, while
// GitHub's repo header counts the default branch only. This module reads
// GitHub's own number (Link-header page count, no full fetch) with a short
// in-memory cache. Any failure degrades to null — callers fall back to DB
// counts, never throw.

export const COUNT_TTL_MS = 90_000;

/** Pure: total pages from a GitHub `Link` header (`rel="last"`). Null when absent/invalid. */
export function parseLastPage(linkHeader: string | null): number | null {
  if (!linkHeader) return null;
  const m = linkHeader.match(/[?&]page=(\d+)[^>]*>;\s*rel="last"/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

type CacheEntry = { at: number; count: number | null; branch: string | null };
const cache = new Map<string, CacheEntry>();

export function clearCountCache(): void {
  cache.clear();
}

export type CountDeps = {
  installationId?: bigint | null;
  defaultBranch?: string | null;
  nowMs?: number;
  fetchFn?: typeof fetch;
};

/** Default-branch commit count straight from GitHub. Null count on any failure. */
export async function getMainBranchCommitCount(
  fullName: string,
  deps: CountDeps = {},
): Promise<{ count: number | null; defaultBranch: string | null }> {
  const now = deps.nowMs ?? Date.now();
  const hit = cache.get(fullName);
  if (hit && now - hit.at < COUNT_TTL_MS) {
    return { count: hit.count, defaultBranch: hit.branch };
  }
  const result = await fetchCount(fullName, deps);
  cache.set(fullName, { at: now, count: result.count, branch: result.defaultBranch });
  return result;
}

async function fetchCount(
  fullName: string,
  deps: CountDeps,
): Promise<{ count: number | null; defaultBranch: string | null }> {
  const doFetch = deps.fetchFn ?? fetch;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  try {
    if (deps.installationId != null) {
      const token = await getInstallationToken(deps.installationId, appKeys(), {
        fetchFn: doFetch,
      });
      headers.Authorization = `Bearer ${token}`;
    }
  } catch {
    // fall through unauthenticated (works for public repos, tighter limits)
  }
  let branch = deps.defaultBranch?.trim() || "";
  try {
    if (!branch) {
      const r = await doFetch(`https://api.github.com/repos/${fullName}`, { headers });
      if (!r.ok) return { count: null, defaultBranch: null };
      const body = (await r.json()) as { default_branch?: unknown };
      branch = typeof body.default_branch === "string" ? body.default_branch : "";
      if (!branch) return { count: null, defaultBranch: null };
    }
    const c = await doFetch(
      `https://api.github.com/repos/${fullName}/commits?sha=${encodeURIComponent(branch)}&per_page=1`,
      { headers },
    );
    if (!c.ok) return { count: null, defaultBranch: branch };
    const link = c.headers.get("link");
    if (!link) {
      // Single page: 0 or 1 commits — read the body directly.
      const body = (await c.json()) as unknown;
      return { count: Array.isArray(body) ? body.length : null, defaultBranch: branch };
    }
    return { count: parseLastPage(link), defaultBranch: branch };
  } catch {
    return { count: null, defaultBranch: branch || null };
  }
}
