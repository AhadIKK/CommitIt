// authApi.ts — GitHub account linking + App install state. Reads /api/me,
// /api/meta, /api/repo. Login itself is a redirect to /api/auth/github.
import type { InstallSyncResult } from "@src/installations.js";

export type Me = { login: string; avatarUrl: string | null; repos: string[] };
export type Meta = {
  appSlug: string | null;
  installUrl: string | null;
  authEnabled: boolean;
  appConfigured: boolean;
};
export type RepoProfile = { fullName: string; installed: boolean };

async function parse<T>(res: Response): Promise<T> {
  const body = (await res.json()) as { ok: boolean; data?: T; error?: string };
  if (!res.ok || !body.ok) throw new Error(body.error ?? `request failed: ${res.status}`);
  return body.data as T;
}

// Two components ask who you are on the same render (the GitHub section and the
// Telegram section), so the page used to pay two identical /api/me round
// trips. Only the *in-flight* promise is shared, never the result: a later call
// — after sync, login or logout — still hits the server for fresh data.
let inFlightMe: Promise<Me | null> | null = null;

/** Null when logged out (401). Never throws for logged_out. */
export function fetchMe(): Promise<Me | null> {
  inFlightMe ??= fetch("/api/me")
    .then((res) => (res.status === 401 ? null : parse<Me>(res)))
    .finally(() => {
      inFlightMe = null;
    });
  return inFlightMe;
}

/** Re-run install attribution for this account ("Sync now" repair). */
// Typed from the server's own return type: `status` drives the four-way
// message in Auth.tsx, so a hand-copied union here could silently go stale.
export function syncMyInstalls(): Promise<InstallSyncResult> {
  return fetch("/api/me?op=sync", { method: "POST" }).then((r) =>
    parse<InstallSyncResult>(r),
  );
}

export function fetchMeta(): Promise<Meta> {
  return fetch("/api/meta").then((r) => parse<Meta>(r));
}

export function fetchRepoProfile(repo: string): Promise<RepoProfile> {
  return fetch(`/api/repo?repo=${encodeURIComponent(repo)}`).then((r) =>
    parse<RepoProfile>(r),
  );
}

/** Claim a Setup-URL redirect (?installation_id=) after App install. */
export function claimInstallSetup(installationId: string): Promise<{ repos: string[] }> {
  return fetch(`/api/repo?installation_id=${encodeURIComponent(installationId)}`).then((r) =>
    parse<{ installationId: string; repos: string[] }>(r).then((d) => ({ repos: d.repos })),
  );
}

export function logout(): Promise<void> {
  return fetch("/api/auth/logout", { method: "POST" })
    .then((r) => parse<unknown>(r))
    .then(() => undefined);
}
