// api.ts — read-only BFF client. GET only, never mutates.
import type {
  ActivitySnapshot,
  DigestEntry,
  IssueRow,
  RepoProgress,
} from "@src/dashboard.js";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (res.status === 401) throw new Error("auth_required");
  if (res.status === 403) throw new Error("forbidden");
  if (!res.ok) throw new Error(`request failed: ${res.status}`);
  const body = (await res.json()) as { ok: boolean; data: T; error?: string };
  if (!body.ok) throw new Error(body.error ?? "request not ok");
  return body.data;
}

export function fetchProgress(repo: string): Promise<RepoProgress> {
  return get<RepoProgress>(`/api/progress?repo=${encodeURIComponent(repo)}`);
}

export function fetchActivity(repo: string, days = 7): Promise<ActivitySnapshot> {
  return get<ActivitySnapshot>(
    `/api/activity?repo=${encodeURIComponent(repo)}&days=${days}`,
  );
}

export function fetchIssues(repo: string): Promise<IssueRow[]> {
  return get<IssueRow[]>(`/api/issues?repo=${encodeURIComponent(repo)}`);
}

export function fetchDigests(repo: string): Promise<DigestEntry[]> {
  return get<DigestEntry[]>(`/api/digests?repo=${encodeURIComponent(repo)}`);
}
