// authApi.ts — GitHub account linking + App install state. Reads /api/me,
// /api/meta, /api/repo. Login itself is a redirect to /api/auth/github.
export type Me = { login: string; avatarUrl: string | null };
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

/** Null when logged out (401). Never throws for logged_out. */
export async function fetchMe(): Promise<Me | null> {
  const res = await fetch("/api/me");
  if (res.status === 401) return null;
  return parse<Me>(res);
}

export function fetchMeta(): Promise<Meta> {
  return fetch("/api/meta").then((r) => parse<Meta>(r));
}

export function fetchRepoProfile(repo: string): Promise<RepoProfile> {
  return fetch(`/api/repo?repo=${encodeURIComponent(repo)}`).then((r) =>
    parse<RepoProfile>(r),
  );
}

export function logout(): Promise<void> {
  return fetch("/api/auth/logout", { method: "POST" })
    .then((r) => parse<unknown>(r))
    .then(() => undefined);
}
