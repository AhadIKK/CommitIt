import { z } from "zod";
import { prisma } from "./db.js";
import { appKeys, dropCachedToken } from "./githubAuth.js";
import {
  attributeInstallToSender,
  buildAppJwt,
  fetchAppInstallations,
  matchUserInstallations,
  type AppInstallation,
  type InstallationChange,
} from "./githubApp.js";

// installations.ts — install-lifecycle writes (Phase B). All best-effort at
// the route layer: lifecycle handlers 503 only when the store is down, and
// access loss flips repos.installActive so delivery stops immediately.
// Pure mapping lives in githubApp.parseInstallationEvent (unit-tested);
// this file owns the Prisma writes.

type InstalledChange = Extract<InstallationChange, { kind: "installed" }>;

/** Record an install: Installation row, repo rows (active), owner + member. */
export async function recordInstall(change: InstalledChange): Promise<void> {
  await prisma.installation.upsert({
    where: { id: change.installationId },
    update: {
      accountLogin: change.accountLogin,
      accountType: change.accountType,
      suspendedAt: null,
    },
    create: {
      id: change.installationId,
      accountLogin: change.accountLogin,
      accountType: change.accountType,
    },
  });
  const now = new Date();
  for (const fullName of change.repos) {
    await prisma.repo.upsert({
      where: { fullName },
      update: {
        installationId: change.installationId,
        installedAt: now,
        installActive: true,
      },
      create: {
        fullName,
        installationId: change.installationId,
        installedAt: now,
        installActive: true,
      },
    });
  }
  const userId = await attributeInstallToSender(prisma, {
    installationId: change.installationId,
    repos: change.repos,
    senderLogin: change.senderLogin,
  });
  if (userId) {
    await prisma.userInstallation.upsert({
      where: { userId_installationId: { userId, installationId: change.installationId } },
      update: {},
      create: { userId, installationId: change.installationId },
    });
  }
}

type RemovedChange = Extract<InstallationChange, { kind: "removed" }>;

/**
 * Remove repos from an install. Empty repo list = whole installation deleted:
 * clear every repo on it and drop the Installation row (join rows cascade).
 * Otherwise clear just the listed repos (delete keeps the install alive).
 */
export async function removeInstallRepos(change: RemovedChange): Promise<void> {
  dropCachedToken(change.installationId); // access lost: cached token dies now
  if (change.repos.length > 0) {
    await prisma.repo.updateMany({
      where: { fullName: { in: change.repos }, installationId: change.installationId },
      data: { installationId: null, installActive: false },
    });
    return;
  }
  await prisma.repo.updateMany({
    where: { installationId: change.installationId },
    data: { installationId: null, installActive: false },
  });
  await prisma.installation.deleteMany({ where: { id: change.installationId } });
  await cancelQueuedBackfills(change.installationId);
}

/**
 * Terminal-cancel queued backfills for an installation that no longer exists.
 * A job queued before the install was removed would otherwise outlive it and
 * only surface later as a token 404 for an installation that is gone.
 * Queued rows only: a `processing` row is in flight and is handled by the
 * worker's permanent-error path rather than yanked out from under it.
 * Best-effort like the rest of the lifecycle writes — the worker self-heals.
 */
export async function cancelQueuedBackfills(
  installationId: bigint | number | string,
): Promise<number> {
  const id = installationId.toString();
  try {
    const res = await prisma.job.updateMany({
      where: {
        type: "backfill",
        status: "queued",
        OR: [
          { deliveryId: { startsWith: `setup-${id}-` } },
          { deliveryId: { startsWith: `sync-${id}-` } },
        ],
      },
      data: { status: "failed", nextRetryAt: null },
    });
    return res.count;
  } catch {
    return 0;
  }
}

/**
 * Queue an installation backfill, but only for an installation we still know
 * about. Guards the race where the install disappears between the caller
 * deciding to sync and the job landing in the queue: work for an unknown
 * installation can only ever end in a token 404.
 */
export async function enqueueBackfill(
  installationId: bigint,
  deliveryId: string,
): Promise<boolean> {
  try {
    const known = await prisma.installation.findUnique({
      where: { id: installationId },
      select: { id: true },
    });
    if (!known) return false;
    const { enqueueJob } = await import("./queue.js");
    await enqueueJob("backfill", deliveryId, { installationId: installationId.toString() });
    return true;
  } catch {
    return false; // backfill is best-effort; the install itself is recorded
  }
}

/** Suspend (or unsuspend) an install: flip repos.installActive, keep rows. */
export async function setInstallSuspended(
  installationId: bigint,
  suspended: boolean,
): Promise<void> {
  if (suspended) dropCachedToken(installationId); // access lost: cached token dies now
  await prisma.installation.upsert({
    where: { id: installationId },
    update: { suspendedAt: suspended ? new Date() : null },
    create: { id: installationId, suspendedAt: suspended ? new Date() : null },
  });
  await prisma.repo.updateMany({
    where: { installationId },
    data: { installActive: !suspended },
  });
}

const AuthorizationSchema = z.object({
  action: z.string(),
  sender: z.object({ login: z.string() }).optional(),
});

/**
 * Handle github_app_authorization.revoked: revoke every live session of the
 * GitHub user so a deauthorized account goes dark immediately. Returns the
 * number of sessions revoked (0 when unknown action/user).
 */

/**
 * Register an install from the Setup-URL redirect (fallback when the
 * installation/installation_repositories webhook events are unavailable).
 * GitHub lands here with ?installation_id=&setup_action= after every install.
 * Authenticates as the App (JWT), reads the installation + its repos,
 * records everything, attributes the owner, and queues a backfill.
 * Never throws: returns ok:false with a code the route maps to status.
 */
export async function registerInstallFromSetup(
  installationId: bigint,
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: true; repos: string[] } | { ok: false; error: string }> {
  let keys;
  try {
    keys = appKeys();
  } catch {
    return { ok: false, error: "app_not_configured" };
  }
  let jwt: string;
  try {
    jwt = buildAppJwt({ appId: keys.appId, privateKeyPem: keys.privateKeyPem });
  } catch {
    return { ok: false, error: "app_not_configured" };
  }
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    Authorization: `Bearer ${jwt}`,
  };
  let installation: { accountLogin: string | null; accountType: string | null };
  try {
    const res = await fetchFn(`https://api.github.com/app/installations/${installationId}`, {
      headers,
    });
    if (!res.ok) return { ok: false, error: "install_fetch_failed" };
    const body = (await res.json()) as {
      account?: { login?: string; type?: string } | null;
    };
    installation = {
      accountLogin: body.account?.login ?? null,
      accountType: body.account?.type ?? null,
    };
  } catch {
    return { ok: false, error: "install_fetch_failed" };
  }
  let repos: string[] = [];
  try {
    for (let page = 1; ; page++) {
      const res = await fetchFn(
        `https://api.github.com/app/installations/${installationId}/repositories?per_page=100&page=${page}`,
        { headers },
      );
      if (!res.ok) break;
      const body = (await res.json()) as { repositories?: { full_name?: string }[] };
      const names = (body.repositories ?? [])
        .map((r) => r.full_name)
        .filter((n): n is string => Boolean(n));
      repos = repos.concat(names);
      if (names.length < 100) break;
      if (page >= 10) break;
    }
  } catch {
    return { ok: false, error: "install_fetch_failed" };
  }
  try {
    await recordInstall({
      kind: "installed",
      installationId,
      repos,
      senderLogin: installation.accountLogin,
      accountLogin: installation.accountLogin,
      accountType: installation.accountType,
    });
  } catch {
    return { ok: false, error: "unavailable" };
  }
  const queued = await enqueueBackfill(
    installationId,
    `setup-${installationId.toString()}-${Date.now()}`,
  );
  // The free Render worker sleeps and its in-process poller only runs while
  // awake, so a queued backfill would otherwise sit until unrelated traffic
  // wakes it. Best-effort wake on install, mirroring syncUserInstalls — this
  // is what makes a new tester's history start backfilling by itself.
  if (queued) {
    const { pingWorker } = await import("./workerWake.js");
    const woke = await pingWorker();
    console.warn(JSON.stringify({ msg: "install_backfill_wake", woke }));
  }
  return { ok: true, repos };
}
export async function revokeGithubAuthorization(body: unknown): Promise<number> {
  const parsed = AuthorizationSchema.safeParse(body);
  if (!parsed.success) return 0;
  if (parsed.data.action !== "revoked") return 0;
  const login = parsed.data.sender?.login;
  if (!login) return 0;
  try {
    const user = await prisma.user.findUnique({ where: { githubLogin: login } });
    if (!user) return 0;
    const res = await prisma.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return res.count;
  } catch {
    return 0;
  }
}

const RepositorySchema = z.object({
  action: z.string(),
  repository: z.object({ full_name: z.string() }).optional(),
  changes: z
    .object({
      repository: z.object({ name: z.object({ from: z.string() }).optional() }).optional(),
    })
    .optional(),
});

export type RepositoryChange =
  | { kind: "deleted"; fullName: string }
  | { kind: "renamed"; fullName: string; oldFullName: string };

/** Parse `repository` events (deleted/renamed). Null = ignore. */
export function parseRepositoryEvent(body: unknown): RepositoryChange | null {
  const parsed = RepositorySchema.safeParse(body);
  if (!parsed.success) return null;
  const fullName = parsed.data.repository?.full_name;
  if (!fullName) return null;
  if (parsed.data.action === "deleted") return { kind: "deleted", fullName };
  if (parsed.data.action === "renamed") {
    const from = parsed.data.changes?.repository?.name?.from;
    if (!from) return null;
    const owner = fullName.split("/")[0] ?? "";
    if (!owner) return null;
    return { kind: "renamed", fullName, oldFullName: `${owner}/${from}` };
  }
  return null; // archived/publicized/etc: nothing to do
}

/**
 * Apply a repository change. Deleted = deactivate (installActive=false,
 * installation detached, cached token dropped) — data retained for audit,
 * notifications stop via the delivery gates. Renamed = move the row.
 * Best-effort: returns false only when nothing could be applied.
 */
export async function applyRepositoryChange(change: RepositoryChange): Promise<boolean> {
  try {
    if (change.kind === "deleted") {
      const row = await prisma.repo.findUnique({
        where: { fullName: change.fullName },
        select: { id: true, installationId: true },
      });
      if (!row) return true; // already gone
      if (row.installationId != null) dropCachedToken(row.installationId);
      await prisma.repo.update({
        where: { id: row.id },
        data: { installActive: false, installationId: null },
      });
      return true;
    }
    const row = await prisma.repo.findUnique({ where: { fullName: change.oldFullName } });
    if (!row) return true; // unknown old name: nothing to move
    await prisma.repo.update({ where: { id: row.id }, data: { fullName: change.fullName } });
    return true;
  } catch {
    return false;
  }
}

/** List an installation's repo full names as the App (JWT, paginated). Throws repos_list_<status> on HTTP failure so callers log the real cause instead of a bare null. */
export async function listInstallRepos(
  installationId: bigint,
  jwt: string,
  fetchFn: typeof fetch = fetch,
): Promise<string[]> {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    Authorization: `Bearer ${jwt}`,
  };
  try {
    const repos: string[] = [];
    for (let page = 1; ; page++) {
      const res = await fetchFn(
        `https://api.github.com/app/installations/${installationId.toString()}/repositories?per_page=100&page=${page}`,
        { headers },
      );
      if (!res.ok) throw new Error(`repos_list_${res.status}`);
      const body = (await res.json()) as { repositories?: { full_name?: string }[] };
      const names = (body.repositories ?? [])
        .map((r) => r.full_name)
        .filter((n): n is string => Boolean(n));
      repos.push(...names);
      if (names.length < 100) break;
      if (page >= 10) break;
    }
    return repos;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("repos_list_")) throw err;
    throw new Error("repos_list_fetch_failed");
  }
}

/** Read one installation as the App. Null on any failure. */
export async function fetchAppInstallation(
  installationId: bigint,
  fetchFn: typeof fetch = fetch,
): Promise<{ accountLogin: string | null; accountType: string | null } | null> {
  let keys;
  try {
    keys = appKeys();
  } catch {
    return null;
  }
  let jwt: string;
  try {
    jwt = buildAppJwt({ appId: keys.appId, privateKeyPem: keys.privateKeyPem });
  } catch {
    return null;
  }
  try {
    const res = await fetchFn(`https://api.github.com/app/installations/${installationId}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        Authorization: `Bearer ${jwt}`,
      },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { account?: { login?: string; type?: string } | null };
    return { accountLogin: body.account?.login ?? null, accountType: body.account?.type ?? null };
  } catch {
    return null;
  }
}

/**
 * Full per-user install sync (login-time): list App installations, keep the
 * ones owned by this login, and record each (rows + owner + member +
 * backfill). Best-effort: never throws.
 *
 * The status distinguishes "genuinely no installs" from server-side failure
 * so the UI never blames the user for a misconfigured server:
 * - "synced": listing succeeded (synced may still be 0 when every install
 *   failed per-install fetching — those are logged, not hidden).
 * - "no_installs": GitHub reachable, none belong to this login.
 * - "app_not_configured": GITHUB_APP_ID / private key missing or unusable.
 * - "github_error": store down, GitHub unreachable/invalid, or no user row.
 */
export type InstallSyncStatus = "synced" | "no_installs" | "app_not_configured" | "github_error";
export type InstallSyncResult = { synced: number; status: InstallSyncStatus };

function syncFail(status: InstallSyncStatus, stage: string, err: unknown): InstallSyncResult {
  console.warn(JSON.stringify({ msg: "install_sync_failed", stage, err: String(err) }));
  return { synced: 0, status };
}

export async function syncUserInstalls(login: string): Promise<InstallSyncResult> {
  let userId: string;
  try {
    const user = await prisma.user.findUnique({ where: { githubLogin: login } });
    // No account row: nothing can belong to this login. Benign (session is
    // still valid) — report no_installs, not an error. A down store throws
    // below and maps to github_error instead.
    if (!user) return { synced: 0, status: "no_installs" };
    userId = user.id;
  } catch (err) {
    return syncFail("github_error", "user_lookup", err);
  }
  let installs: AppInstallation[];
  try {
    installs = await fetchAppInstallations();
  } catch (err) {
    const code = err instanceof Error ? err.message : "unknown";
    if (code === "app_not_configured") return syncFail("app_not_configured", "app_list", err);
    return syncFail("github_error", "app_list", err);
  }
  const mine = matchUserInstallations(installs, login);
  if (mine.length === 0) return { synced: 0, status: "no_installs" };
  let keys;
  try {
    keys = appKeys();
  } catch (err) {
    return syncFail("app_not_configured", "app_keys", err);
  }
  let jwt: string;
  try {
    jwt = buildAppJwt({ appId: keys.appId, privateKeyPem: keys.privateKeyPem });
  } catch (err) {
    return syncFail("app_not_configured", "app_jwt", err);
  }
  let done = 0;
  let woken = false;
  for (const inst of mine) {
    const id = inst.id;
    try {
      let repos: string[];
      try {
        repos = await listInstallRepos(id, jwt);
      } catch (listErr) {
        // GitHub won't serve this install's repo list (404/403/rate-limit):
        // fall back to repos our webhooks already recorded for it. The
        // install row exists locally (that's how /api/repo knows), so
        // attribution + membership can still complete.
        let rows: { fullName: string }[] = [];
        try {
          rows = await prisma.repo.findMany({
            where: { installationId: id },
            select: { fullName: true },
          });
        } catch {
          rows = [];
        }
        if (rows.length === 0) throw listErr; // nothing locally either: log original
        repos = rows.map((r) => r.fullName);
        console.warn(
          JSON.stringify({
            msg: "install_sync_db_fallback",
            installationId: id.toString(),
            repoCount: repos.length,
            err: String(listErr),
          }),
        );
      }
      await recordInstall({
        kind: "installed",
        installationId: id,
        repos,
        senderLogin: login,
        // Both fields come from the installation listing already in hand, so
        // this no longer needs its own GitHub call. That call sat in the OAuth
        // callback path and cost ~250ms per install for a column nothing reads.
        accountLogin: inst.accountLogin ?? login,
        accountType: inst.accountType,
      });
      await prisma.userInstallation.upsert({
        where: { userId_installationId: { userId, installationId: id } },
        update: {},
        create: { userId, installationId: id },
      });
      woken =
        (await enqueueBackfill(id, `sync-${id.toString()}-${Date.now()}`)) || woken;
      done += 1;
    } catch (err) {
      // one bad install never blocks the rest
      console.warn(
        JSON.stringify({ msg: "install_sync_skipped", installationId: id.toString(), err: String(err) }),
      );
    }
  }
  // Wake the worker so the queued backfills actually run: the free Render
  // instance sleeps, and its poller only lives while awake. Best-effort.
  if (woken) {
    const { pingWorker } = await import("./workerWake.js");
    const woke = await pingWorker();
    console.warn(JSON.stringify({ msg: "install_sync_wake", woke }));
  }
  return { synced: done, status: "synced" };
}
