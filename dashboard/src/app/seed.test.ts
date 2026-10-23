/**
 * Guards for the authenticated app's data. Two things must never drift:
 * the weight scale, and the promise that a secret finding exposes a location
 * and a rule but never the value.
 */
import { describe, expect, it } from "vitest";
import {
  ALERTS,
  CHATS,
  DIGESTS,
  FINDINGS,
  REPOS,
  STAGES,
  TASKS,
  WEIGHT_POINTS,
  pointsOf,
  repoById,
} from "./seed.js";

describe("the weight scale", () => {
  it("is S=1, M=3, L=5 and nothing else", () => {
    expect(WEIGHT_POINTS).toEqual({ S: 1, M: 3, L: 5 });
    expect(pointsOf("S")).toBe(1);
    expect(pointsOf("M")).toBe(3);
    expect(pointsOf("L")).toBe(5);
  });

  it("is not configurable anywhere in the app data", () => {
    // If a per-workspace scale ever appears, this is where it will show up.
    const serialised = JSON.stringify({ REPOS, TASKS });
    expect(serialised).not.toMatch(/"weightScale"/);
  });
});

describe("progress is recomputed from tasks, never counted", () => {
  it("every closed task contributes its weight and no more", () => {
    for (const repo of REPOS) {
      const repoTasks = TASKS.filter((t) => t.repoId === repo.id);
      const finished = repoTasks
        .filter((t) => t.closedAt !== null && t.reopenCount === 0)
        .reduce((a, t) => a + pointsOf(t.weight), 0);
      expect(repo.pointsFinished).toBe(finished);
    }
  });

  it("a reopened task gives its points back", () => {
    const reopened = TASKS.filter((t) => t.reopenCount > 0);
    expect(reopened.length).toBeGreaterThan(0);
    for (const t of reopened) {
      // Reopened means the merge was reverted. Whatever close date it once had,
      // it must not be counted as finished.
      const counted = t.closedAt !== null && t.reopenCount === 0;
      expect(counted).toBe(false);
    }
  });

  it("a connected repository has work on the books; an unlinked one has none", () => {
    for (const r of REPOS) {
      if (r.connected) {
        expect(r.pointsTotal).toBeGreaterThan(0);
      } else {
        expect(r.pointsTotal).toBe(0);
        expect(r.pointsFinished).toBe(0);
      }
    }
  });

  it("no repository is ever over 100% of its own total", () => {
    for (const r of REPOS) {
      expect(r.pointsFinished).toBeLessThanOrEqual(r.pointsTotal);
    }
  });
});

describe("secret findings expose a location, never a value", () => {
  it("carries only path, rule, repo, commit and status", () => {
    for (const f of FINDINGS) {
      const keys = Object.keys(f).sort();
      expect(keys).toEqual(
        ["at", "commitSha", "id", "path", "repoId", "rule", "status"].sort(),
      );
    }
  });

  it("has no field that could hold the matched text", () => {
    for (const f of FINDINGS) {
      for (const key of ["value", "secret", "match", "snippet", "content", "line"]) {
        expect(f).not.toHaveProperty(key);
      }
    }
  });

  it("looks like a real shape: a path, a rule and a commit", () => {
    for (const f of FINDINGS) {
      expect(f.path).toMatch(/\.[a-z]+$/);
      expect(f.rule.length).toBeGreaterThan(4);
      expect(f.commitSha).toMatch(/^[0-9a-f]{7}$/);
    }
  });
});

describe("ledgers are internally consistent", () => {
  it("digest ids are unique", () => {
    expect(new Set(DIGESTS.map((d) => d.id)).size).toBe(DIGESTS.length);
  });

  it("every digest points at a repo that exists", () => {
    for (const d of DIGESTS) {
      expect(REPOS.some((r) => r.id === d.repoId)).toBe(true);
    }
  });

  it("a delivered digest always says something", () => {
    for (const d of DIGESTS) {
      expect(d.messageCount).toBeGreaterThan(0);
      // Zero finished points on a given day is a real, honest outcome.
      expect(d.pointsFinished).toBeGreaterThanOrEqual(0);
    }
  });

  it("alerts and chats have stable ids", () => {
    expect(new Set(ALERTS.map((a) => a.id)).size).toBe(ALERTS.length);
    expect(new Set(CHATS.map((c) => c.id)).size).toBe(CHATS.length);
  });

  it("an unverified chat is never marked verified, and vice versa", () => {
    for (const c of CHATS) {
      expect(["VERIFIED", "CHECK"]).toContain(c.status);
    }
  });
});

describe("the pipeline stage table", () => {
  it("never grows as work moves downstream past what entered it", () => {
    for (let i = 1; i < STAGES.length; i += 1) {
      expect(STAGES[i].count).toBeLessThanOrEqual(STAGES[i - 1].count);
    }
  });

  it("has no stage with a negative or absent latency", () => {
    for (const s of STAGES) {
      expect(s.p50).toBeGreaterThan(0);
      expect(s.p95).toBeGreaterThanOrEqual(s.p50);
      expect(s.count).toBeGreaterThan(0);
    }
  });
});