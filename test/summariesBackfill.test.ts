import { describe, expect, it } from "vitest";
import { backfillContinuation } from "../src/worker.js";

// The summaries backfill re-enqueues itself, which means a wrong decision here
// does not fail loudly — it either loops on rows the provider refuses, burning
// a free-tier budget, or silently stops halfway through a real backlog.

describe("backfillContinuation", () => {
  it("continues when the batch was full and rows were actually written", () => {
    expect(
      backfillContinuation({ rowCount: 5, limit: 5, filled: 5, stoppedForTime: false, lastId: "c1" }),
    ).toBe("c1");
  });

  it("stops when the batch was short — there is nothing left", () => {
    expect(
      backfillContinuation({ rowCount: 3, limit: 5, filled: 3, stoppedForTime: false, lastId: "c3" }),
    ).toBeNull();
  });

  it("stops when nothing was written, even with a full batch", () => {
    // Every row degraded (a 429, or a repo with AI off). Re-enqueueing would
    // re-select the same rows and spin forever.
    expect(
      backfillContinuation({ rowCount: 5, limit: 5, filled: 0, stoppedForTime: false, lastId: "c5" }),
    ).toBeNull();
  });

  it("hands over the cursor when it ran out of time mid-batch", () => {
    expect(
      backfillContinuation({ rowCount: 5, limit: 5, filled: 2, stoppedForTime: true, lastId: "c2" }),
    ).toBe("c2");
  });

  it("stops without a cursor, since a continuation could not resume", () => {
    expect(
      backfillContinuation({ rowCount: 5, limit: 5, filled: 5, stoppedForTime: false, lastId: null }),
    ).toBeNull();
  });
});
