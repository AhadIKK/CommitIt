import { describe, expect, it } from "vitest";
import type { Issue } from "../api/types.js";
import {
  dueState,
  progressPercent,
  progressSentence,
  SIZE_WEIGHTS,
  sizeLabel,
  trackFillPercent,
  trackNodes,
  weightName,
  weightOf,
} from "./weight.js";

function issue(partial: Partial<Issue> & { number: number }): Issue {
  return {
    title: `Task ${partial.number}`,
    sizeWeight: 1,
    state: "open",
    milestoneId: "m_auth",
    ...partial,
  };
}

describe("weights", () => {
  it("S, M and L are 1, 3 and 5", () => {
    expect(SIZE_WEIGHTS).toEqual({ S: 1, M: 3, L: 5 });
    expect(sizeLabel(1)).toBe("S");
    expect(sizeLabel(3)).toBe("M");
    expect(sizeLabel(5)).toBe("L");
  });

  it("an unestimated task counts as 1 point and is named as such", () => {
    expect(weightOf({ sizeWeight: null })).toBe(1);
    expect(sizeLabel(null)).toBeNull();
    expect(weightName(null)).toBe("unestimated");
  });
});

describe("progressPercent", () => {
  it("never divides by zero: an empty goal has no percentage", () => {
    expect(progressPercent(0, 0)).toBeNull();
    expect(progressPercent(3, 0)).toBeNull();
    expect(progressPercent(0, -1)).toBeNull();
  });

  it("rounds and clamps", () => {
    expect(progressPercent(8, 13)).toBe(62);
    expect(progressPercent(13, 13)).toBe(100);
    expect(progressPercent(1, 3)).toBe(33);
  });
});

describe("progressSentence", () => {
  const now = new Date("2026-10-17T09:00:00Z");

  it("reads as one sentence with the points and the due clause", () => {
    const sentence = progressSentence(
      {
        title: "Auth",
        weightedClosed: 8,
        weightedTotal: 13,
        dueDate: new Date(now.getTime() + 6 * 86_400_000).toISOString(),
      },
      now,
    );
    expect(sentence).toBe("Auth is 62% done: 8 of 13 points, due in 6 days.");
  });

  it("an empty goal says no issues yet, never 0%", () => {
    const sentence = progressSentence(
      { title: "Profile", weightedClosed: 0, weightedTotal: 0, dueDate: null },
      now,
    );
    expect(sentence).toBe("Profile has no issues yet.");
    expect(sentence).not.toContain("0%");
  });

  it("a goal with no due date simply omits the date clause", () => {
    const sentence = progressSentence(
      { title: "Profile", weightedClosed: 1, weightedTotal: 2, dueDate: null },
      now,
    );
    expect(sentence).toBe("Profile is 50% done: 1 of 2 points.");
  });

  it("counts an overdue goal honestly", () => {
    expect(dueState(new Date(now.getTime() - 3 * 86_400_000).toISOString(), now)?.phrase).toBe(
      "3 days overdue",
    );
    expect(dueState(null, now)).toBeNull();
  });
});

describe("the Goal Track's node model", () => {
  it("sizes a node by its weight and names it for a screen reader", () => {
    const nodes = trackNodes([
      issue({ number: 11, title: "Login route", sizeWeight: 3, state: "closed", closedAt: "2026-10-10T00:00:00Z" }),
      issue({ number: 16, title: "Health route", sizeWeight: null }),
    ]);
    const [first, second] = nodes;
    expect(first.weight).toBe(3);
    expect(first.sizeLabel).toBe("M");
    expect(first.estimated).toBe(true);
    expect(first.accessibleName).toBe("Task 11, login route, size M, closed");

    expect(second.weight).toBe(1);
    expect(second.estimated).toBe(false);
    expect(second.accessibleName).toBe("Task 16, health route, size unknown, counts as 1 point, open");
  });

  it("orders by closing sequence, so open work sits at the end", () => {
    const nodes = trackNodes([
      issue({ number: 17, state: "open" }),
      issue({ number: 13, state: "closed", closedAt: "2026-10-14T00:00:00Z" }),
      issue({ number: 12, state: "closed", closedAt: "2026-10-11T00:00:00Z" }),
    ]);
    expect(nodes.map((n) => n.issue.number)).toEqual([12, 13, 17]);
  });

  it("names a reopened task as reopened, not only in the inspector line", () => {
    const nodes = trackNodes([
      issue({
        number: 23,
        title: "Reconnect logic",
        sizeWeight: 3,
        state: "open",
        closedAt: null,
        reopenedAt: "2026-10-13T00:00:00Z",
      }),
    ]);
    expect(nodes[0].accessibleName).toBe("Task 23, reconnect logic, size M, reopened, open again");
  });

  it("a reopened task is open again, and the filled line moves back", () => {    const before = trackNodes([
      issue({ number: 1, state: "closed", closedAt: "2026-10-01T00:00:00Z" }),
      issue({ number: 2, state: "closed", closedAt: "2026-10-02T00:00:00Z" }),
      issue({ number: 3, state: "closed", closedAt: "2026-10-03T00:00:00Z" }),
    ]);
    const after = trackNodes([
      issue({ number: 1, state: "closed", closedAt: "2026-10-01T00:00:00Z" }),
      issue({ number: 2, state: "closed", closedAt: "2026-10-02T00:00:00Z" }),
      // reopened: it draws as open and sorts back to the open end
      issue({ number: 3, state: "open", closedAt: null, reopenedAt: "2026-10-15T00:00:00Z" }),
    ]);
    expect(trackFillPercent(before)).toBe(100);
    expect(trackFillPercent(after)).toBe(50);
  });

  it("an empty goal has no fill and no division by zero", () => {
    expect(trackFillPercent([])).toBe(0);
    expect(trackFillPercent(trackNodes([issue({ number: 1 })]))).toBe(0);
    expect(trackFillPercent(trackNodes([issue({ number: 1, state: "closed", closedAt: "2026-10-01T00:00:00Z" })]))).toBe(
      100,
    );
  });
});
