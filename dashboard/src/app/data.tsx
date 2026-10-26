/**
 * The ledger's data source.
 *
 * Every /app screen used to import `seed.ts` at module level, which meant the
 * operator view could never show real data. Now one provider asks `/api/ops`
 * once and the screens read from it — the same swap the product screens made
 * when they moved onto the real backend.
 *
 * Weights are the only thing progress counts, so the helpers here are the only
 * place a size becomes a number.
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "../api/index.js";
import type { OpsPayload, OpsRepo, OpsTask, OpsWeight } from "../api/types.js";

export type Weight = "S" | "M" | "L";

/** The contract's numbers, named the way the interface says them. */
export const WEIGHT_POINTS: Record<Weight, OpsWeight> = { S: 1, M: 3, L: 5 };

/** A stored weight as the letter the ledger prints. Unestimated is a dash. */
export function weightLabel(weight: OpsWeight | null): string {
  if (weight === 1) return "S";
  if (weight === 3) return "M";
  if (weight === 5) return "L";
  return "—";
}

/** Unestimated tasks still count as one point, the way the track draws them. */
export function pointsOf(weight: OpsWeight | null): number {
  return weight ?? 1;
}

export type LedgerTask = {
  n: number;
  title: string;
  /** "S" | "M" | "L", or an em dash when the task is unestimated. */
  weight: string;
  /** The number progress counts: 1/3/5, and 1 for unestimated. */
  points: number;
  state: "closed" | "open";
  closedAt: string | null;
  reopenedAt: string | null;
  pr: number | null;
  raw: OpsTask;
};

/**
 * The track's order: closed tasks in closing order, then open ones. A task
 * that was reopened is open again, which is what the ledger must say.
 */
export function tasksToLedger(tasks: OpsTask[]): LedgerTask[] {
  return tasks
    .slice()
    .sort((a, b) => {
      if (a.state !== b.state) return a.state === "closed" ? -1 : 1;
      return a.state === "closed"
        ? (a.closedAt ?? "").localeCompare(b.closedAt ?? "")
        : a.number - b.number;
    })
    .map((t) => ({
      n: t.number,
      title: t.title,
      weight: weightLabel(t.weight),
      points: pointsOf(t.weight),
      state: t.reopenedAt ? "open" : t.state,
      closedAt: t.reopenedAt ? null : t.closedAt,
      reopenedAt: t.reopenedAt,
      pr: t.pr,
      raw: t,
    }));
}

export function repoOf(repos: OpsRepo[], id: string | undefined): OpsRepo | null {
  return repos.find((r) => r.id === id) ?? null;
}

type OpsState = {
  data: OpsPayload | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
};

const OpsContext = createContext<OpsState | null>(null);

export function OpsProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<OpsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api
      .ops()
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "The API is not answering.");
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const value = useMemo<OpsState>(
    () => ({
      data,
      error,
      loading: data === null && error === null,
      reload: () => setAttempt((n) => n + 1),
    }),
    [data, error],
  );

  return <OpsContext.Provider value={value}>{children}</OpsContext.Provider>;
}

export function useOps(): OpsState {
  const value = useContext(OpsContext);
  if (!value) throw new Error("useOps must be used inside <OpsProvider>");
  return value;
}
