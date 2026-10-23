/**
 * Live activity. Server-sent events where the backend supports them, polling as
 * the fallback, and an honest status when neither is working: the UI shows its
 * last load rather than pretending to be current.
 *
 * One subscription per repository is shared by every component that asks for it,
 * so the shell and the screen do not each open their own stream. The last
 * component to unmount closes it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ActivityEvent, type LiveStatus, type RepoId } from "../api/index.js";

export type LiveState = {
  status: LiveStatus;
  lastUpdated: Date;
  /** The most recent event's summary, shown once in the status region. */
  newActivity: string | null;
  /** Bumped whenever an event arrives, so screens can refetch on it. */
  tick: number;
  /** Manual refresh: "Check now". */
  refresh: () => void;
};

type Shared = {
  status: LiveStatus;
  lastUpdated: Date;
  newActivity: string | null;
  tick: number;
  /** Re-render callbacks. */
  subs: Set<() => void>;
  /** Per-caller event handlers. */
  handlers: Set<(event: ActivityEvent) => void>;
  stop: () => void;
};

const registry = new Map<RepoId, Shared>();

function acquire(repoId: RepoId): Shared {
  const existing = registry.get(repoId);
  if (existing) return existing;

  const shared: Shared = {
    status: "live",
    lastUpdated: new Date(),
    newActivity: null,
    tick: 0,
    subs: new Set(),
    handlers: new Set(),
    stop: () => {},
  };
  const notify = () => {
    for (const fn of shared.subs) fn();
  };

  shared.stop = api.subscribe(
    repoId,
    (event) => {
      shared.lastUpdated = new Date();
      shared.newActivity = event.summary;
      shared.tick += 1;
      for (const fn of shared.handlers) fn(event);
      notify();
    },
    (next) => {
      shared.status = next;
      notify();
    },
  );

  registry.set(repoId, shared);
  return shared;
}

export function useLive(repoId: RepoId, onEvent?: (event: ActivityEvent) => void): LiveState {
  const [, force] = useState(0);
  const sharedRef = useRef<Shared | null>(null);
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    const shared = acquire(repoId);
    sharedRef.current = shared;
    const render = () => force((n) => n + 1);
    const forward = (event: ActivityEvent) => handler.current?.(event);
    shared.subs.add(render);
    shared.handlers.add(forward);
    force((n) => n + 1);

    return () => {
      shared.subs.delete(render);
      shared.handlers.delete(forward);
      if (shared.subs.size === 0) {
        shared.stop();
        registry.delete(repoId);
      }
      sharedRef.current = null;
    };
  }, [repoId]);

  const refresh = useCallback(() => {
    const shared = sharedRef.current;
    if (!shared) return;
    shared.lastUpdated = new Date();
    shared.newActivity = null;
    shared.tick += 1;
    for (const fn of shared.subs) fn();
  }, []);

  const shared = sharedRef.current;
  return {
    status: shared?.status ?? "live",
    lastUpdated: shared?.lastUpdated ?? new Date(),
    newActivity: shared?.newActivity ?? null,
    tick: shared?.tick ?? 0,
    refresh,
  };
}
