/**
 * HTTP adapter. Same interface as the mock; used for every build that is not a
 * design review. No token ever touches the client: auth is a session cookie set
 * by the backend, so there is nothing here to put in localStorage.
 */
import type { CommitItApi, DigestPatch, LiveStatus } from "./client.js";
import type {
  ActivityEvent,
  Alert,
  DigestMode,
  DigestSettings,
  GoalDetail,
  Me,
  Milestone,
  PersonSummary,
  Repo,
  RepoId,
  RepoSettings,
  TelegramLink,
  TestDigestResult,
  TodaySnapshot,
} from "./types.js";

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: init?.body ? { "content-type": "application/json" } : undefined,
    ...init,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(detail || `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const repoPath = (id: RepoId) => `/api/repos/${encodeURIComponent(id)}`;

/** How often the live bar asks for new activity. */
const POLL_MS = 30_000;

export function createHttpApi(): CommitItApi {
  return {
    me: () => json<Me>("/api/me"),
    repos: () => json<Repo[]>("/api/repos"),

    today: (repoId) => json<TodaySnapshot>(`${repoPath(repoId)}/today`),
    goals: (repoId) => json<Milestone[]>(`${repoPath(repoId)}/goals`),
    goal: (repoId, goalId) =>
      json<GoalDetail>(`${repoPath(repoId)}/goals/${encodeURIComponent(goalId)}`),
    people: (repoId) => json<PersonSummary[]>(`${repoPath(repoId)}/people`),
    alerts: (repoId) => json<Alert[]>(`${repoPath(repoId)}/alerts`),

    linkCommit: (repoId, sha, issueNumber) =>
      json<{ ok: true; sha: string; issueNumber: number }>(
        `${repoPath(repoId)}/commits/${encodeURIComponent(sha)}/link`,
        { method: "POST", body: JSON.stringify({ issueNumber }) },
      ),

    digests: (repoId, mode?: DigestMode) =>
      json<DigestSettings>(`${repoPath(repoId)}/digest${mode ? `?mode=${mode}` : ""}`),
    saveDigest: (repoId, patch: DigestPatch) =>
      json<DigestSettings>(`${repoPath(repoId)}/digest`, { method: "PUT", body: JSON.stringify(patch) }),
    sendTestDigest: (repoId) =>
      json<TestDigestResult>(`${repoPath(repoId)}/digest/test`, { method: "POST" }),

    settings: (repoId) => json<RepoSettings>(`${repoPath(repoId)}/settings`),
    setAiEnabled: (repoId, enabled) =>
      json<RepoSettings>(`${repoPath(repoId)}/settings/ai`, {
        method: "PUT",
        body: JSON.stringify({ enabled }),
      }),
    disconnect: (repoId) => json<void>(`${repoPath(repoId)}/connection`, { method: "DELETE" }),

    startGitHub: () => json<{ url: string }>("/api/auth/github/start"),
    chooseRepo: (fullName: string) =>
      json<Me>("/api/auth/github/repo", { method: "POST", body: JSON.stringify({ fullName }) }),
    startTelegramLink: (repoRef?: string) =>
      json<TelegramLink>("/api/link/telegram", {
        method: "POST",
        body: JSON.stringify(repoRef ? { repo: repoRef } : {}),
      }),
    pollTelegramLink: (pollToken: string) =>
      json<{ linked: boolean; chatTitle?: string }>(
        `/api/link/telegram/${encodeURIComponent(pollToken)}`,
      ),
    saveOnboardingMode: (mode: DigestMode, repoRef?: string) =>
      json<{ saved: true; mode: DigestMode }>("/api/onboarding/mode", {
        method: "POST",
        body: JSON.stringify(repoRef ? { mode, repo: repoRef } : { mode }),
      }),

    /**
     * New activity, polled. Serverless hosts cannot hold an event stream open,
     * so the honest default is a short poll: one request now, then every 30 s,
     * with the status saying exactly what is happening.
     */
    subscribe(repoId, onEvent, onStatus) {
      if (!repoId) {
        onStatus?.("offline");
        return () => {};
      }
      let since = new Date().toISOString();
      let stopped = false;

      const tick = async () => {
        try {
          const events = await json<ActivityEvent[]>(
            `${repoPath(repoId)}/events?since=${encodeURIComponent(since)}`,
          );
          if (stopped) return;
          since = new Date().toISOString();
          for (const event of events) onEvent(event);
          onStatus?.("live");
        } catch {
          if (!stopped) onStatus?.("offline");
        }
      };

      onStatus?.("polling");
      void tick();
      const timer = setInterval(() => void tick(), POLL_MS);

      return () => {
        stopped = true;
        clearInterval(timer);
      };
    },
  };
}

export type { LiveStatus };
