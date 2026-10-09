import { buildAppJwt } from "./githubApp.js";

// githubAuth.ts — GitHub App authentication client (Phase A).
// - App JWTs via the shared RS256 builder in githubApp.ts (single impl).
// - Installation tokens minted per install, cached IN MEMORY until ~5 min
//   before expiry, never persisted (spec invariant).
// - Private key accepted as base64 (Vercel-safe) or raw PEM with \n escapes
//   (Render-safe); normalized here so callers never touch key formats.
// - No Octokit: plain fetch, per plan.md §18 / github-sync.ts convention.
// - Clock + HTTP are injectable for unit tests (mocked clock/HTTP).

export type KeyMaterial = { appId: string; privateKeyPem: string };

/** Resolve App credentials from env. Throws app_not_configured when absent. */
export function appKeys(): KeyMaterial {
  const appId = (process.env.GITHUB_APP_ID ?? "").trim();
  const privateKeyPem = normalizePrivateKey(
    (process.env.GITHUB_APP_PRIVATE_KEY ?? "").trim(),
    (process.env.GITHUB_APP_PRIVATE_KEY_BASE64 ?? "").trim(),
  );
  if (!appId || !privateKeyPem) throw new Error("app_not_configured");
  return { appId, privateKeyPem };
}

/**
 * Normalize a private key from either env form. Pure (testable):
 * - base64 form wins when raw is empty; raw wins otherwise (explicit beats).
 * - raw PEM may contain literal "\n" escapes (single-line env vars) or real
 *   newlines; both are accepted. Rejects non-PEM input.
 */
export function normalizePrivateKey(raw: string, base64: string): string {
  const candidate = raw || (base64 ? decodeBase64(base64) : "");
  if (!candidate) return "";
  const pem = candidate.includes("\\n") ? candidate.replace(/\\n/g, "\n") : candidate;
  if (!pem.includes("-----BEGIN") || !pem.includes("-----END")) return "";
  return pem.endsWith("\n") ? pem : `${pem}\n`;
}

function decodeBase64(base: string): string {
  try {
    return Buffer.from(base, "base64").toString("utf8");
  } catch {
    return "";
  }
}

type CachedToken = { token: string; validUntilMs: number };
const REFRESH_SKEW_MS = 5 * 60 * 1000; // re-mint ~5 min before expiry

// Module-memory cache only. Serverless instances each hold their own copy;
// worst case is one extra mint per cold start. Never written to disk/DB.
const tokenCache = new Map<string, CachedToken>();

export function clearTokenCache(): void {
  tokenCache.clear();
}

/** Drop one install's cached token (access lost: deleted/suspended). */
export function dropCachedToken(installationId: bigint | number | string): void {
  tokenCache.delete(installationId.toString());
}

export type TokenDeps = {
  nowMs?: number;
  fetchFn?: typeof fetch;
};

/** Mint (or reuse a fresh cached) installation token. Token never persisted. */
export async function getInstallationToken(
  installationId: bigint | number | string,
  keys: KeyMaterial,
  deps: TokenDeps = {},
): Promise<string> {
  const key = installationId.toString();
  const nowMs = deps.nowMs ?? Date.now();
  const cached = tokenCache.get(key);
  if (cached && cached.validUntilMs - REFRESH_SKEW_MS > nowMs) {
    return cached.token;
  }
  const jwt = buildAppJwt({
    appId: keys.appId,
    privateKeyPem: keys.privateKeyPem,
    nowSec: Math.floor(nowMs / 1000),
  });
  const doFetch = deps.fetchFn ?? fetch;
  const res = await doFetch(
    `https://api.github.com/app/installations/${key}/access_tokens`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        Authorization: `Bearer ${jwt}`,
      },
    },
  );
  if (!res.ok) throw new Error(`installation_token_${res.status}`);
  const body = (await res.json()) as { token?: unknown; expires_at?: unknown };
  if (typeof body.token !== "string" || body.token.length === 0) {
    throw new Error("installation_token_invalid");
  }
  const expiresMs =
    typeof body.expires_at === "string" ? Date.parse(body.expires_at) : Number.NaN;
  tokenCache.set(key, {
    token: body.token,
    validUntilMs: Number.isFinite(expiresMs) ? expiresMs : nowMs + 60 * 60 * 1000,
  });
  return body.token;
}

export type ApiDeps = { fetchFn?: typeof fetch };

/** Authenticated GitHub API fetch as the App installation. Thin wrapper. */
export async function installationApiFetch(
  installationId: bigint | number | string,
  keys: KeyMaterial,
  path: string,
  init: RequestInit = {},
  deps: ApiDeps = {},
): Promise<Response> {
  const token = await getInstallationToken(installationId, keys, deps);
  const doFetch = deps.fetchFn ?? fetch;
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/vnd.github+json");
  headers.set("X-GitHub-Api-Version", "2022-11-28");
  headers.set("Authorization", `Bearer ${token}`);
  return doFetch(`https://api.github.com${path}`, { ...init, headers });
}
