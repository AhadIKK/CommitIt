/**
 * The product contract: the exact payload shapes the signed-in dashboard reads.
 *
 * This file is the single source of truth. `dashboard/src/api/types.ts`
 * re-exports it, so the client and the server cannot drift apart — a field that
 * is not declared here does not exist on either side.
 *
 * Nothing here is derived on the client: `weightedClosed` / `weightedTotal`
 * arrive from the API and the client never recomputes progress from commits.
 */

export type RepoId = string;
export type AuthorId = string;
export type MilestoneId = string;

export type WebhookHealth = {
  /** Last delivery GitHub actually made. */
  lastDeliveryAt: string | null;
  lastDeliveryStatus: "ok" | "failed" | null;
  /** What we expect the repo's webhook URL to be. */
  expectedUrl: string;
  ok: boolean;
};

export type Repo = {
  id: RepoId;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  aiEnabled: boolean;
  webhook: WebhookHealth;
  /** Set when the repo cannot be read at all (App uninstalled, access removed). */
  unreadable?: boolean;
};

export type Author = {
  id: AuthorId;
  /** GitHub username when we have it, otherwise the commit display name. */
  login: string;
  /** Display name from the commit, if it differs. */
  name?: string;
};

export type CommitCategory =
  | "feat"
  | "fix"
  | "docs"
  | "refactor"
  | "test"
  | "chore"
  | "other";

export type Commit = {
  sha: string;
  /** First line of the message. "fix", "update" and "final final" are normal. */
  message: string;
  /** The full body, when it is longer than the subject. */
  body?: string;
  category: CommitCategory;
  /** Only present when the repo has AI summaries on and one was produced. */
  aiSummary?: string | null;
  branch: string;
  additions: number;
  deletions: number;
  committedAt: string;
  /** Strong link (`closes #N`) or inherited from a merged PR. */
  issueNumber?: number | null;
  /** Heuristic suggestion. Never auto-assigned. */
  suggestedIssueNumber?: number | null;
  authorId: AuthorId;
  isMerge: boolean;
  secretFlag: boolean;
};

export type IssueState = "open" | "closed";

export type Issue = {
  number: number;
  title: string;
  /** null = unestimated; the UI shows a dashed node and counts it as 1 point. */
  sizeWeight: 1 | 3 | 5 | null;
  state: IssueState;
  milestoneId: MilestoneId | null;
  assigneeId?: AuthorId | null;
  /** Set for closed tasks, used to order the track by closing sequence. */
  closedAt?: string | null;
  /**
   * Set when a task was closed and then reopened. The track draws it as open
   * again, which moves the filled line back — the honest behaviour.
   */
  reopenedAt?: string | null;
};

export type Milestone = {
  id: MilestoneId;
  title: string;
  dueDate: string | null;
  state: "open" | "closed";
  /** Sum of size weights of closed issues. From the API. */
  weightedClosed: number;
  /** Sum of size weights of all issues. From the API. */
  weightedTotal: number;
  issueCount: number;
  closedCount: number;
};

export type PullRequest = {
  number: number;
  title: string;
  state: "open" | "closed" | "merged";
  mergedAt: string | null;
  authorId: AuthorId;
  issueNumber?: number | null;
};

export type DigestMode = "instant" | "hourly" | "daily" | "weekly";

export type QuietHours = {
  enabled: boolean;
  /** "22:00" */
  from: string;
  /** "07:00" */
  to: string;
};

export type DigestFilters = {
  branches: string[];
  authors: AuthorId[] | "all";
  events: Array<"commits" | "pull_requests" | "issues">;
};

/** Scoped to one chat × repo pair, never to the person (AGENTS.md rule 10). */
export type Subscription = {
  chatId: string;
  chatTitle: string;
  repoId: RepoId;
  mode: DigestMode;
  quietHours: QuietHours;
  filters: DigestFilters;
  muted: boolean;
};

export type AlertKind =
  | "secret"
  | "build_failed"
  | "force_push"
  | "direct_push"
  | "stale_branch"
  | "inactivity";

export type Alert = {
  id: string;
  kind: AlertKind;
  severity: "danger" | "warn";
  title: string;
  detail: string;
  /** The fix, in the interface's voice. */
  advice?: string;
  commitSha?: string;
  /** File path ONLY. A secret value must never reach the client. */
  file?: string;
  branch?: string;
  at: string;
  href?: string;
};

export type AuthorGroup = {
  author: Author;
  commits: Commit[];
  /** Closed-task points attributed to this author in the window. */
  tasksClosed: number;
};

export type GoalDetail = {
  milestone: Milestone;
  /** Already ordered by closing sequence: what the track draws. */
  issues: Issue[];
  authors: Author[];
  commits: Commit[];
  unlinked: Array<{ commit: Commit; suggestion: Issue | null }>;
};

export type PersonSummary = {
  author: Author;
  commits: Commit[];
  /** Tasks this person closed in the week. Progress, not activity. */
  closedTasks: Issue[];
  weightedPointsClosed: number;
  mergedPRs: number;
  /** "This week" boundaries the numbers are for. */
  windowStart: string;
  windowEnd: string;
};

export type TodaySnapshot = {
  repo: Repo;
  /** The goal the sentence is about. */
  focus: Milestone | null;
  /** The tasks of the focus goal, in closing order — what the track draws. */
  focusIssues: Issue[];
  goals: Milestone[];
  digestWindowStart: string;
  groups: AuthorGroup[];
  unlinked: Array<{ commit: Commit; suggestion: Issue | null }>;
  alerts: Alert[];
  /** Points still open across all goals of this repo, from the API. */
  openPoints: number;
};

export type Me = {
  signedIn: boolean;
  login: string | null;
  name?: string;
  /** Repos this account can see. */
  repos: Repo[];
  /** The chat linked to this account, when there is one. */
  telegramLinked: boolean;
};

export type DigestSettings = {
  repoId: RepoId;
  /** null when this repository has no chat connected yet. */
  subscription: Subscription | null;
  /** The message body the next digest would contain, exactly as sent. */
  preview: string;
  /** Length of `preview` in characters, against Telegram's 3 800. */
  charCount: number;
  charLimit: number;
};

export type TestDigestResult = {
  chatTitle: string;
  deliveredAt: string;
  ok: boolean;
};

export type RepoSettings = {
  repo: Repo;
  subscription: Subscription | null;
  aiEnabled: boolean;
  /** Set when the account has no AI provider configured at all. */
  aiAvailable: boolean;
};

export type ConnectStep = "github" | "repo" | "telegram" | "digest" | "test";

/** What the live channel pushes: new activity, never progress. */
export type ActivityEvent = {
  type: "commit" | "alert" | "digest";
  at: string;
  /** The repo the event belongs to. */
  repoId: RepoId;
  /** Short line for the status region. "2 new commits from fizan" */
  summary: string;
};

export type TelegramLink = {
  code: string;
  deepLink: string;
  pollToken: string;
};

/** Telegram's message ceiling, enforced by the sender (AGENTS.md rule 8). */
export const DIGEST_CHAR_LIMIT = 3800;

/* --- the ledger (/app) ----------------------------------------------------
 * The operator view: every repository, task, message, alert and delivery in
 * one payload. It is the same data the product screens read, shaped for a
 * table instead of a page. Where the database does not store a value the field
 * is null and the table says so; nothing here is estimated to look complete.
 */

/** Task weights, the only sizes progress is counted at. */
export type OpsWeight = 1 | 3 | 5;

export type OpsRepo = {
  id: RepoId;
  fullName: string;
  defaultBranch: string;
  /** A delivery has been recorded for this repo. */
  connected: boolean;
  pointsFinished: number;
  pointsTotal: number;
  /** Activity only. Never added into points. */
  commitCount: number;
  /** Reopened tasks: the ones that want an answer. */
  needsDecision: number;
  lastDigestAt: string | null;
  health: "VERIFIED" | "CHECK";
  /** Weights of finished tasks, in closing order. */
  finishedWeights: OpsWeight[];
  /** Weights still open. */
  openWeights: OpsWeight[];
};

export type OpsTask = {
  id: string;
  repoId: RepoId;
  number: number;
  title: string;
  /** null = unestimated; the track counts it as 1 point. */
  weight: OpsWeight | null;
  state: "open" | "closed";
  closedAt: string | null;
  reopenedAt: string | null;
  /** The PR that closed it, when one did. */
  pr: number | null;
};

export type OpsDigest = {
  id: string;
  repoId: RepoId;
  chatTitle: string;
  sentAt: string;
  cadence: "instant" | "hourly" | "daily";
  /** The message exactly as it was queued or sent. */
  body: string;
  /** Not stored per message: null, never an invented number. */
  pointsFinished: number | null;
  status: "DELIVERED" | "QUEUED" | "FAILED";
  messageCount: number;
};

export type OpsAlert = {
  id: string;
  kind: string;
  repoId: RepoId;
  actor: string;
  at: string;
  detail: string;
  delivered: boolean;
};

export type OpsChat = {
  id: string;
  title: string;
  kind: "group" | "dm";
  /** Telegram does not tell us; null, never a guess. */
  members: number | null;
  /** The repositories this chat is subscribed to. */
  linkedRepoIds: RepoId[];
  lastMessageAt: string | null;
  status: "VERIFIED" | "CHECK";
};

export type OpsFinding = {
  id: string;
  /** The file path is not stored; the value never was. */
  path: string | null;
  rule: string;
  repoId: RepoId;
  commitSha: string;
  at: string;
  status: "SKIPPED";
};

export type OpsDelivery = {
  id: string;
  at: string;
  event: string;
  /** We only record deliveries that passed verification. */
  signature: "VERIFIED";
  rateLimited: boolean;
  key: string;
  outcome: string;
};

export type OpsJob = {
  id: string;
  kind: string;
  status: "queued" | "running" | "retrying" | "dead" | "done";
  attempts: number;
};

export type OpsPayload = {
  repos: OpsRepo[];
  tasks: OpsTask[];
  digests: OpsDigest[];
  alerts: OpsAlert[];
  chats: OpsChat[];
  findings: OpsFinding[];
  deliveries: OpsDelivery[];
  jobs: OpsJob[];
};
