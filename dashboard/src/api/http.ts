/**
 * HTTP adapter. Same interface as the mock; used by flipping USE_REAL_API in
 * `api/index.ts`. No token ever touches the client: auth is a session cookie set
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
    startTelegramLink: () => json<TelegramLink>("/api/link/telegram", { method: "POST" }),
    pollTelegramLink: (pollToken: string) =>
      json<{ linked: boolean; chatTitle?: string }>(
        `/api/link/telegram/${encodeURIComponent(pollToken)}`,
      ),
    saveOnboardingMode: (mode: DigestMode) =>
      json<{ saved: true; mode: DigestMode }>("/api/onboarding/mode", {
        method: "POST",
        body: JSON.stringify({ mode }),
      }),

    subscribe(repoId, onEvent, onStatus) {
      const url = `${repoPath(repoId)}/events`;
      let source: EventSource | null = null;
      let poll: ReturnType<typeof setInterval> | null = null;

      const startPolling = () => {
        if (poll) return;
        onStatus?.("polling");
        poll = setInterval(async () => {
          try {
            const events = await json<ActivityEvent[]>(`${repoPath(repoId)}/events?since=last`);
            for (const e of events) onEvent(e);
            onStatus?.("live");
          } catch {
            onStatus?.("offline");
          }
        }, 30_000);
      };

      try {
        source = new EventSource(url);
        source.onmessage = (m) => {
          try {
            onEvent(JSON.parse(m.data) as ActivityEvent);
            onStatus?.("live");
          } catch {
            /* a malformed frame is not worth a banner */
          }
        };
        source.onerror = () => {
          onStatus?.("stale");
          source?.close();
          source = null;
          startPolling();
        };
      } catch {
        startPolling();
      }

      return () => {
        source?.close();
        if (poll) clearInterval(poll);
      };
    },
  };
}

export type { LiveStatus };
