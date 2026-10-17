// api.ts — read-only BFF client. GET only, never mutates.
import type {
  ActivitySnapshot,
  DigestEntry,
  IssueRow,
  RepoProgress,
} from "@src/dashboard.js";
import type { Me } from "./authApi.js";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (res.status === 401) throw new Error("auth_required");
  if (res.status === 403) throw new Error("forbidden");
  if (!res.ok) throw new Error(`request failed: ${res.status}`);
  const body = (await res.json()) as { ok: boolean; data: T; error?: string };
  if (!body.ok) throw new Error(body.error ?? "request not ok");
  return body.data;
}

/** Everything the dashboard renders, from one request. */
export type DashboardData = {
  /** The repo actually served — the account's first repo when `preferMine` asked. */
  repo: string;
  me: Me | null;
  /** Set instead of data when this account may not read `repo`. */
  denied?: { status: 401 | 403; error: string };
  progress?: RepoProgress;
  activity?: ActivitySnapshot;
  issues?: IssueRow[];
  digests?: DigestEntry[];
};

/**
 * The whole dashboard in one call: /api/data/all returns the account together
 * with milestones, activity, issues and digests, so the page renders after a
 * single round trip instead of one call for the account and then four more for
 * the data.
 *
 * `preferMine` is for the first load, when the URL names no repo: the server
 * then serves the account's first repo instead of the placeholder — the pick
 * the client used to make only after /api/me answered, i.e. a second wave.
 *
 * A denied repo comes back as `denied` rather than a 401/403 status: the same
 * response still says who is asking, which is what picks the right onboarding
 * step. The caller turns `denied` into the error it always threw.
 */
export async function fetchDashboard(repo: string, preferMine = false): Promise<DashboardData> {
  const query = new URLSearchParams({ repo });
  if (preferMine) query.set("prefer", "1");
  return get<DashboardData>(`/api/data/all?${query.toString()}`);
}
