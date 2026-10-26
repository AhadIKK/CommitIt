/**
 * The API contract. Screens depend on this interface and nothing else, so
 * swapping the mock for the real service is a one-line change in `client.ts`.
 *
 * Every method is listed in docs/api-needs.md with the endpoint the backend
 * would have to expose.
 */
import type {
  Alert,
  ActivityEvent,
  DigestMode,
  DigestSettings,
  GoalDetail,
  Me,
  Milestone,
  OpsPayload,
  PersonSummary,
  Repo,
  RepoId,
  RepoSettings,
  Subscription,
  TelegramLink,
  TestDigestResult,
  TodaySnapshot,
} from "./types.js";

export type DigestPatch = Partial<
  Pick<Subscription, "mode" | "quietHours" | "filters" | "muted">
>;

export type LiveStatus = "live" | "polling" | "stale" | "offline";

export interface CommitItApi {
  /* account and repos ---------------------------------------------------- */
  me(): Promise<Me>;
  repos(): Promise<Repo[]>;

  /* repo screens ---------------------------------------------------------- */
  today(repoId: RepoId): Promise<TodaySnapshot>;
  goals(repoId: RepoId): Promise<Milestone[]>;
  goal(repoId: RepoId, goalId: string): Promise<GoalDetail>;
  people(repoId: RepoId): Promise<PersonSummary[]>;
  alerts(repoId: RepoId): Promise<Alert[]>;

  /**
   * The operator ledger behind /app: every repository, task, message and
   * delivery in one payload, because those screens are tables.
   */
  ops(): Promise<OpsPayload>;

  /* linking --------------------------------------------------------------- */
  /**
   * Accept a suggested task for a commit. The only way a commit ever becomes
   * linked: a suggestion is never applied on its own.
   */
  linkCommit(
    repoId: RepoId,
    sha: string,
    issueNumber: number,
  ): Promise<{ ok: true; sha: string; issueNumber: number }>;

  /* digests --------------------------------------------------------------- */
  digests(repoId: RepoId, mode?: DigestMode): Promise<DigestSettings>;
  saveDigest(repoId: RepoId, patch: DigestPatch): Promise<DigestSettings>;
  sendTestDigest(repoId: RepoId): Promise<TestDigestResult>;

  /* repo settings --------------------------------------------------------- */
  settings(repoId: RepoId): Promise<RepoSettings>;
  setAiEnabled(repoId: RepoId, enabled: boolean): Promise<RepoSettings>;
  disconnect(repoId: RepoId): Promise<void>;

  /* onboarding ------------------------------------------------------------ */
  startGitHub(): Promise<{ url: string }>;
  chooseRepo(fullName: string): Promise<Me>;
  /** The chat being linked is per repository, so say which one. */
  startTelegramLink(repoRef?: string): Promise<TelegramLink>;
  pollTelegramLink(pollToken: string): Promise<{ linked: boolean; chatTitle?: string }>;
  saveOnboardingMode(mode: DigestMode, repoRef?: string): Promise<{ saved: true; mode: DigestMode }>;

  /* live activity -------------------------------------------------------- */
  /**
   * Server-sent events where available, polling as the fallback. Returns an
   * unsubscribe function. The callback fires for new commits and alerts.
   */
  subscribe(
    repoId: RepoId,
    onEvent: (event: ActivityEvent) => void,
    onStatus?: (status: LiveStatus) => void,
  ): () => void;
}
