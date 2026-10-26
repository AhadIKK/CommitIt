/**
 * Mock adapter. Returns the fixtures behind the same interface the real service
 * will implement, so switching over is a one-line change (`client.ts`).
 *
 * It also honours ?state=… (lib/scenario.ts) so every state in the design plan's
 * matrix can be reviewed on purpose.
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
  OpsPayload,
  PersonSummary,
  Repo,
  RepoId,
  RepoSettings,
  TelegramLink,
  TestDigestResult,
  TodaySnapshot,
} from "./types.js";
import * as fx from "./fixtures.js";
import { mockOps } from "./mockOps.js";
import { currentScenario } from "../lib/scenario.js";

const latencyFor = () => {
  switch (currentScenario()) {
    case "slow":
      return 1400;
    default:
      return 180;
  }
};

function delay<T>(value: T, ms = latencyFor()): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function refuse(): never {
  throw new Error("Request failed. The API is not answering.");
}

function guard<T>(value: T, ms?: number): Promise<T> {
  if (currentScenario() === "error") return delay(ms ?? latencyFor()).then(refuse);
  return delay(value, ms);
}

const emptyToday = (repo: Repo): TodaySnapshot => ({
  repo,
  focus: null,
  focusIssues: [],
  goals: [],
  digestWindowStart: new Date().toISOString(),
  groups: [],
  unlinked: [],
  alerts: [],
  openPoints: 0,
});

export function createMockApi(): CommitItApi {
  const listeners = new Set<(e: ActivityEvent) => void>();
  const statusListeners = new Set<(s: LiveStatus) => void>();
  let timer: ReturnType<typeof setInterval> | null = null;

  const emit = (event: ActivityEvent) => {
    for (const fn of listeners) fn(event);
  };
  const setStatus = (s: LiveStatus) => {
    for (const fn of statusListeners) fn(s);
  };

  const startLive = (repoId: RepoId) => {
    const scenario = currentScenario();
    if (timer) clearInterval(timer);
    if (scenario === "offline") {
      setStatus("offline");
      return;
    }
    if (scenario === "stale") setStatus("stale");
    else setStatus("live");
    let n = 0;
    timer = setInterval(() => {
      n += 1;
      emit({
        type: n % 4 === 0 ? "alert" : "commit",
        at: new Date().toISOString(),
        repoId,
        summary:
          n % 4 === 0
            ? "A build failed on main"
            : `${n % 3 === 0 ? "2" : "1"} new commit${n % 3 === 0 ? "s" : ""} from fizan`,
      });
    }, 14_000);
  };

  const digest = (repoId: RepoId, mode?: DigestMode): DigestSettings => {
    const base = fx.digestFixture(repoId, mode);
    if (currentScenario() === "slow" || currentScenario() === "stale") return base;
    return base;
  };

  return {
    async me(): Promise<Me> {
      if (currentScenario() === "empty") {
        return delay({ signedIn: true, login: "ahad", name: "Ahad I K", repos: fx.repos, telegramLinked: false });
      }
      return guard(fx.me);
    },

    async repos(): Promise<Repo[]> {
      return guard(fx.repos);
    },

    async today(repoId: RepoId): Promise<TodaySnapshot> {
      const repo = fx.repoById(repoId);
      const scenario = currentScenario();
      if (scenario === "empty") return guard(emptyToday(repo));
      if (scenario === "partial") {
        const base = fx.todayFixture(repoId);
        return guard({ ...base, groups: [], unlinked: [], alerts: [] });
      }
      if (scenario === "burst") return guard(fx.todayFixture("r_capstone"));
      if (scenario === "stale") {
        const base = fx.todayFixture(repoId);
        const stale = new Date(Date.now() - 12 * 60_000).toISOString();
        return guard({ ...base, digestWindowStart: stale });
      }
      return guard(fx.todayFixture(repoId));
    },

    async goals(repoId: RepoId): Promise<Milestone[]> {
      if (currentScenario() === "empty") return guard([]);
      return guard(fx.milestones[repoId] ?? []);
    },

    async goal(repoId: RepoId, goalId: string): Promise<GoalDetail> {
      return guard(fx.goalFixture(repoId, goalId));
    },

    async people(repoId: RepoId): Promise<PersonSummary[]> {
      if (currentScenario() === "empty") return guard([]);
      if (currentScenario() === "burst") return guard(fx.peopleFixture("r_capstone"));
      return guard(fx.peopleFixture(repoId));
    },

    async alerts(repoId: RepoId): Promise<Alert[]> {
      if (currentScenario() === "empty") return guard([]);
      if (currentScenario() === "partial") return guard([]);
      return guard(fx.alerts[repoId] ?? []);
    },

    async ops(): Promise<OpsPayload> {
      if (currentScenario() === "empty") {
        return guard({ ...mockOps(), repos: [], tasks: [], digests: [], alerts: [], chats: [], findings: [], deliveries: [], jobs: [] });
      }
      if (currentScenario() === "error") return refuse();
      return guard(mockOps());
    },

    async linkCommit(repoId: RepoId, sha: string, issueNumber: number) {
      void repoId;
      return guard({ ok: true as const, sha, issueNumber }, 240);
    },

    async digests(repoId: RepoId, mode?: DigestMode): Promise<DigestSettings> {
      const base =
        currentScenario() === "burst" ? fx.digestFixture("r_capstone", mode) : digest(repoId, mode);
      if (currentScenario() === "empty") {
        return guard({ ...base, subscription: null, preview: "", charCount: 0 });
      }
      return guard(base);
    },

    async saveDigest(repoId: RepoId, patch: DigestPatch): Promise<DigestSettings> {
      const next = digest(repoId, patch.mode);
      if (!next.subscription) return guard(next, 260);
      const merged: DigestSettings = {
        ...next,
        subscription: {
          ...next.subscription,
          ...patch,
          quietHours: { ...next.subscription.quietHours, ...(patch.quietHours ?? {}) },
          filters: { ...next.subscription.filters, ...(patch.filters ?? {}) },
        },
      };
      return guard(merged, 260);
    },

    async sendTestDigest(repoId: RepoId): Promise<TestDigestResult> {
      const sub = fx.subscriptions[repoId];
      if (currentScenario() === "offline") {
        await delay(null, 400);
        return { chatTitle: sub?.chatTitle ?? "your chat", deliveredAt: new Date().toISOString(), ok: false };
      }
      return guard(
        { chatTitle: sub?.chatTitle ?? "your chat", deliveredAt: new Date().toISOString(), ok: true },
        500,
      );
    },

    async settings(repoId: RepoId): Promise<RepoSettings> {
      return guard(fx.settingsFixture(repoId));
    },

    async setAiEnabled(repoId: RepoId, enabled: boolean): Promise<RepoSettings> {
      const base = fx.settingsFixture(repoId);
      return guard({ ...base, aiEnabled: enabled, repo: { ...base.repo, aiEnabled: enabled } }, 220);
    },

    async disconnect(): Promise<void> {
      return guard(undefined, 260) as Promise<void>;
    },

    async startGitHub(): Promise<{ url: string }> {
      return guard({ url: "https://github.com/apps/commitit/installations/new" });
    },

    async chooseRepo(fullName: string): Promise<Me> {
      const repo = fx.repoByFullName(fullName);
      return guard({ ...fx.me, repos: fx.repos.map((r) => (r.id === repo.id ? r : r)) });
    },

    async startTelegramLink(_repoRef?: string): Promise<TelegramLink> {
      const code = "SYN-4821";
      return guard({ code, deepLink: `https://t.me/commitit_bot?start=${code}`, pollToken: code }, 420);
    },

    async pollTelegramLink(pollToken: string): Promise<{ linked: boolean; chatTitle?: string }> {
      // the real endpoint is a poll; the mock links on the second ask
      await delay(null, 600);
      linkedAttempts += 1;
      if (linkedAttempts < 2) return { linked: false };
      linkedAttempts = 0;
      return { linked: true, chatTitle: fx.subscriptions.r_syncura.chatTitle };
    },

    async saveOnboardingMode(mode: DigestMode, _repoRef?: string) {
      return guard({ saved: true as const, mode }, 200);
    },

    subscribe(repoId, onEvent, onStatus) {
      listeners.add(onEvent);
      if (onStatus) statusListeners.add(onStatus);
      startLive(repoId);
      return () => {
        listeners.delete(onEvent);
        if (onStatus) statusListeners.delete(onStatus);
        if (listeners.size === 0 && timer) {
          clearInterval(timer);
          timer = null;
        }
      };
    },
  };
}

let linkedAttempts = 0;
