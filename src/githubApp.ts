import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";

// githubApp.ts — GitHub App installs (replaces manual webhooks) + GitHub
// OAuth login (user identity). Pure builders/parsers are unit-tested; the
// fetch adapters below are thin (tokens are never stored — exchanged per
// login, minted per install).

const InstallationSchema = z.object({
  action: z.string(),
  installation: z.object({ id: z.number() }).optional(),
  sender: z.object({ login: z.string() }).optional(),
  repositories: z.array(z.object({ full_name: z.string() })).optional(),
});

export type InstallationChange =
  | { kind: "installed"; installationId: bigint; repos: string[]; senderLogin: string | null }
  | { kind: "removed"; installationId: bigint; repos: string[]; senderLogin: string | null };

/**
 * Parse `installation` / `installation_repositories` webhook bodies into a
 * repo-routing change. Returns null for anything else (caller 200-ignores).
 * senderLogin is the installer (used to attribute repos to their account).
 */
export function parseInstallationEvent(body: unknown): InstallationChange | null {
  const parsed = InstallationSchema.safeParse(body);
  if (!parsed.success) return null;
  const { action, installation, sender, repositories } = parsed.data;
  if (!installation) return null;
  const installationId = BigInt(installation.id);
  const senderLogin = sender?.login ?? null;
  const repos = (repositories ?? []).map((r) => r.full_name).filter(Boolean);
  if (action === "created") return { kind: "installed", installationId, repos, senderLogin };
  if (action === "deleted") return { kind: "removed", installationId, repos, senderLogin };
  if (action === "added") return { kind: "installed", installationId, repos, senderLogin };
  if (action === "removed") return { kind: "removed", installationId, repos, senderLogin };
  return null; // suspend/unsuspend/etc: nothing to route
}

export function buildAuthorizeUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const q = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    scope: "read:user user:email",
    state: opts.state,
  });
  return `https://github.com/login/oauth/authorize?${q.toString()}`;
}

/** Public callback URL. APP_URL wins; else forwarded host (Vercel); else local. */
export function callbackUrl(headers: Record<string, string | string[] | undefined>): string {
  const configured = (process.env.APP_URL ?? "").trim().replace(/\/$/, "");
  if (configured) return `${configured}/api/auth/callback`;
  const forwarded = headers["x-forwarded-host"];
  const host = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
  if (host) {
    const proto =
      (Array.isArray(headers["x-forwarded-proto"])
        ? headers["x-forwarded-proto"][0]
        : headers["x-forwarded-proto"]) ?? "https";
    return `${proto}://${host}/api/auth/callback`;
  }
  const port = process.env.PORT ?? 3000;
  return `http://localhost:${port}/api/auth/callback`;
}

export function isSecureCallback(url: string): boolean {
  return url.startsWith("https://");
}

const TokenResponse = z.object({ access_token: z.string().min(1) });
const ViewerResponse = z.object({
  id: z.number(),
  login: z.string().min(1),
  avatar_url: z.string().optional(),
});

export type GitHubViewer = { id: number; login: string; avatarUrl?: string };

/** Exchange an OAuth code for a user token. Token is returned, never stored. */
export async function exchangeCode(code: string): Promise<string> {
  const clientId = process.env.GITHUB_CLIENT_ID ?? "";
  const clientSecret = process.env.GITHUB_CLIENT_SECRET ?? "";
  if (!clientId || !clientSecret) throw new Error("oauth_not_configured");
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
  });
  if (!res.ok) throw new Error(`oauth_exchange_${res.status}`);
  const parsed = TokenResponse.safeParse(await res.json());
  if (!parsed.success) throw new Error("oauth_exchange_invalid");
  return parsed.data.access_token;
}

/** Fetch the authenticated user's login/avatar with a user token. */
export async function fetchViewer(token: string): Promise<GitHubViewer> {
  const res = await fetch("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) throw new Error(`oauth_viewer_${res.status}`);
  const parsed = ViewerResponse.safeParse(await res.json());
  if (!parsed.success) throw new Error("oauth_viewer_invalid");
  return {
    id: parsed.data.id,
    login: parsed.data.login,
    avatarUrl: parsed.data.avatar_url,
  };
}

/** RS256 JWT for the GitHub App (10-min max lifetime). Pure given inputs. */
export function buildAppJwt(opts: {
  appId: string;
  privateKeyPem: string;
  nowSec?: number;
}): string {
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ iss: opts.appId, iat: now - 60, exp: now + 9 * 60 }),
  ).toString("base64url");
  const signingInput = `${header}.${payload}`;
  const signature = crypto
    .sign("RSA-SHA256", Buffer.from(signingInput), opts.privateKeyPem)
    .toString("base64url");
  return `${signingInput}.${signature}`;
}

function appPrivateKey(): string {
  const b64 = (process.env.GITHUB_APP_PRIVATE_KEY_BASE64 ?? "").trim();
  if (!b64) throw new Error("app_not_configured");
  return Buffer.from(b64, "base64").toString("utf8");
}

const AppInstallationsResponse = z.array(
  z.object({
    id: z.number(),
    account: z.object({ login: z.string() }).nullish(),
  }),
);

export type AppInstallation = { id: bigint; accountLogin: string | null };

/** List all installations of this App (authenticates as the App via JWT). */
export async function fetchAppInstallations(): Promise<AppInstallation[]> {
  const appId = (process.env.GITHUB_APP_ID ?? "").trim();
  if (!appId) throw new Error("app_not_configured");
  const jwt = buildAppJwt({ appId, privateKeyPem: appPrivateKey() });
  const res = await fetch("https://api.github.com/app/installations?per_page=100", {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      Authorization: `Bearer ${jwt}`,
    },
  });
  if (!res.ok) throw new Error(`app_installations_${res.status}`);
  const parsed = AppInstallationsResponse.safeParse(await res.json());
  if (!parsed.success) throw new Error("app_installations_invalid");
  return parsed.data.map((i) => ({ id: BigInt(i.id), accountLogin: i.account?.login ?? null }));
}

/** Pure: which installation ids belong to this GitHub login. */
export function selectUserInstallations(
  installations: AppInstallation[],
  login: string,
): bigint[] {
  const want = login.toLowerCase();
  return installations
    .filter((i) => i.accountLogin?.toLowerCase() === want)
    .map((i) => i.id);
}

type AttributionDb = Pick<PrismaClient, "repo" | "user">;

/**
 * Attribute freshly-installed repos to the installer's CommitIt account
 * (matched by installer GitHub login). Best-effort: never throws, never
 * blocks the install ack. No-op when the installer has no account yet —
 * login claims it later via claimUserRepos().
 */
export async function attributeInstallToSender(
  db: AttributionDb,
  change: { installationId: bigint; repos: string[]; senderLogin: string | null },
): Promise<void> {
  if (!change.senderLogin || change.repos.length === 0) return;
  try {
    const user = await db.user.findUnique({ where: { githubLogin: change.senderLogin } });
    if (!user) return;
    await db.repo.updateMany({
      where: { fullName: { in: change.repos } },
      data: { ownerUserId: user.id },
    });
  } catch {
    // attribution is best-effort; the install itself is already applied
  }
}

/**
 * Claim repos for a freshly logged-in account: list App installations as
 * the App, match by account login, set owner. Returns installs claimed.
 * Best-effort: returns 0 (never throws) when the App isn't configured.
 */
export async function claimUserRepos(db: AttributionDb, login: string): Promise<number> {
  let userId: string;
  try {
    const user = await db.user.findUnique({ where: { githubLogin: login } });
    if (!user) return 0;
    userId = user.id;
  } catch {
    return 0;
  }
  let installs: AppInstallation[];
  try {
    installs = await fetchAppInstallations();
  } catch {
    return 0;
  }
  const ids = selectUserInstallations(installs, login);
  if (ids.length === 0) return 0;
  try {
    await db.repo.updateMany({
      where: { installationId: { in: ids } },
      data: { ownerUserId: userId },
    });
  } catch {
    return 0;
  }
  return ids.length;
}

/** Mint a short-lived installation token for API calls as the App. */
export async function mintInstallationToken(installationId: bigint): Promise<string> {
  const appId = (process.env.GITHUB_APP_ID ?? "").trim();
  if (!appId) throw new Error("app_not_configured");
  const jwt = buildAppJwt({ appId, privateKeyPem: appPrivateKey() });
  const res = await fetch(
    `https://api.github.com/app/installations/${installationId.toString()}/access_tokens`,
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
  const parsed = TokenResponse.safeParse(await res.json());
  if (!parsed.success) throw new Error("installation_token_invalid");
  return parsed.data.access_token;
}
