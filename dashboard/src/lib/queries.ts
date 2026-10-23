/**
 * Server state. Screens never call the API directly: they ask for a query, so
 * loading / error / stale are the same shape everywhere.
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { api, type Repo, type RepoId } from "../api/index.js";
import type {
  Alert,
  DigestMode,
  DigestSettings,
  GoalDetail,
  Me,
  Milestone,
  PersonSummary,
  RepoSettings,
  TodaySnapshot,
} from "../api/types.js";

export const DEFAULT_REPO = "syncurateam/syncura";

export const qk = {
  me: ["me"] as const,
  repos: ["repos"] as const,
  today: (repoId: RepoId) => ["today", repoId] as const,
  goals: (repoId: RepoId) => ["goals", repoId] as const,
  goal: (repoId: RepoId, goalId: string) => ["goal", repoId, goalId] as const,
  people: (repoId: RepoId) => ["people", repoId] as const,
  alerts: (repoId: RepoId) => ["alerts", repoId] as const,
  digests: (repoId: RepoId, mode: DigestMode) => ["digests", repoId, mode] as const,
  settings: (repoId: RepoId) => ["settings", repoId] as const,
};

const OPTIONS = { staleTime: 30_000, retry: 1 } as const;

/**
 * The chosen repo lives in the URL as owner/name, so every screen is a link
 * somebody can send. Internally the API is addressed by repo id.
 */
export function useRepoRef(): {
  ref: string;
  repoId: RepoId;
  setRef: (next: string) => void;
} {
  const [params, setParams] = useSearchParams();
  const ref = params.get("repo")?.trim() || DEFAULT_REPO;
  const repos = useRepos();
  const match = repos.data?.find((r) => r.fullName === ref);
  const setRef = useCallback(
    (next: string) => {
      const p = new URLSearchParams(params);
      p.set("repo", next);
      setParams(p, { replace: true });
    },
    [params, setParams],
  );
  return { ref, repoId: match?.id ?? ref, setRef };
}

export function useRepos(): UseQueryResult<Repo[]> {
  return useQuery({ queryKey: qk.repos, queryFn: () => api.repos(), ...OPTIONS });
}

export function useMe(): UseQueryResult<Me> {
  return useQuery({ queryKey: qk.me, queryFn: () => api.me(), ...OPTIONS });
}

export function useToday(repoId: RepoId): UseQueryResult<TodaySnapshot> {
  return useQuery({ queryKey: qk.today(repoId), queryFn: () => api.today(repoId), ...OPTIONS });
}

export function useGoals(repoId: RepoId): UseQueryResult<Milestone[]> {
  return useQuery({ queryKey: qk.goals(repoId), queryFn: () => api.goals(repoId), ...OPTIONS });
}

export function useGoal(repoId: RepoId, goalId: string): UseQueryResult<GoalDetail> {
  return useQuery({
    queryKey: qk.goal(repoId, goalId),
    queryFn: () => api.goal(repoId, goalId),
    enabled: Boolean(goalId),
    ...OPTIONS,
  });
}

export function usePeople(repoId: RepoId): UseQueryResult<PersonSummary[]> {
  return useQuery({ queryKey: qk.people(repoId), queryFn: () => api.people(repoId), ...OPTIONS });
}

export function useAlerts(repoId: RepoId): UseQueryResult<Alert[]> {
  return useQuery({ queryKey: qk.alerts(repoId), queryFn: () => api.alerts(repoId), ...OPTIONS });
}

export function useDigests(repoId: RepoId, mode: DigestMode): UseQueryResult<DigestSettings> {
  return useQuery({
    queryKey: qk.digests(repoId, mode),
    queryFn: () => api.digests(repoId, mode),
    ...OPTIONS,
  });
}

export function useSettings(repoId: RepoId): UseQueryResult<RepoSettings> {
  return useQuery({ queryKey: qk.settings(repoId), queryFn: () => api.settings(repoId), ...OPTIONS });
}

/** Every screen's data, in the shape the state matrix needs. */
export type ScreenState<T> = {
  data: T | undefined;
  status: "loading" | "ready" | "empty" | "error" | "partial";
  error: string | null;
  retry: () => void;
  refetching: boolean;
};

export function screenState<T>(
  query: UseQueryResult<T>,
  isEmpty: (data: T) => boolean,
  isPartial?: (data: T) => boolean,
): ScreenState<T> {
  const { data, isPending, isError, error, refetch, isFetching } = query;
  if (isError) {
    return {
      data,
      status: data ? "partial" : "error",
      error: error instanceof Error ? error.message : "Something went wrong.",
      retry: () => void refetch(),
      refetching: isFetching,
    };
  }
  if (isPending && data === undefined) {
    return { data: undefined, status: "loading", error: null, retry: () => void refetch(), refetching: false };
  }
  if (data !== undefined && isPartial?.(data)) {
    return { data, status: "partial", error: null, retry: () => void refetch(), refetching: isFetching };
  }
  if (data !== undefined && isEmpty(data)) {
    return { data, status: "empty", error: null, retry: () => void refetch(), refetching: isFetching };
  }
  return { data, status: "ready", error: null, retry: () => void refetch(), refetching: isFetching };
}
