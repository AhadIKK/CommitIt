/**
 * Scenario switch. The state matrix in docs/design-plan.md §6.2 has to be
 * reachable on purpose, so every state can be reviewed and smoke-tested rather
 * than waiting for it to happen: append ?state=… to any URL.
 *
 * normal | slow | empty | error | partial | stale | offline | burst
 */
export type Scenario = "normal" | "slow" | "empty" | "error" | "partial" | "stale" | "offline" | "burst";

const ALL: Scenario[] = ["normal", "slow", "empty", "error", "partial", "stale", "offline", "burst"];

export function currentScenario(search?: string): Scenario {
  const q = search ?? (typeof window === "undefined" ? "" : window.location.search);
  const raw = new URLSearchParams(q).get("state");
  return (ALL as string[]).includes(raw ?? "") ? (raw as Scenario) : "normal";
}

export function scenarioLabel(s: Scenario): string | null {
  switch (s) {
    case "slow":
      return "Slow network: skeletons are showing.";
    case "empty":
      return "Empty state: a fresh account with nothing in it yet.";
    case "error":
      return "Error state: the API is refusing every request.";
    case "partial":
      return "Partial state: goals loaded, activity did not.";
    case "stale":
      return "Stale state: the last successful load was 12 minutes ago.";
    case "offline":
      return "Offline state: the live connection is down.";
    case "burst":
      return "100-commit burst: the busiest repo we have.";
    default:
      return null;
  }
}

export const SCENARIOS = ALL;
