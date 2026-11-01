import { describe, expect, it } from "vitest";
import { deliver, isPermanentSendFailure, routeRecipient } from "../src/delivery.js";
import { quietEndsAt } from "../src/scheduler.js";

const awake = { digestMode: "instant", quietHoursStart: "22", quietHoursEnd: "7" };
const noon = new Date("2026-10-05T12:00:00Z");
const night = new Date("2026-10-05T23:30:00Z");

describe("routeRecipient", () => {
  it("sends instant+awake immediately", () => {
    expect(routeRecipient({ ...awake, quietHoursStart: null, quietHoursEnd: null }, false, noon)).toBe("send");
  });
  it("defers instant during quiet hours", () => {
    expect(routeRecipient(awake, false, night)).toBe("defer");
  });
  it("defers non-instant modes even when awake", () => {
    expect(
      routeRecipient({ digestMode: "daily", quietHoursStart: null, quietHoursEnd: null }, false, noon),
    ).toBe("defer");
  });
  it("priority bypasses digest mode and quiet hours", () => {
    expect(routeRecipient(awake, true, night)).toBe("send");
    expect(
      routeRecipient({ digestMode: "weekly", quietHoursStart: null, quietHoursEnd: null }, true, noon),
    ).toBe("send");
  });
});

describe("isPermanentSendFailure", () => {
  // The whole point of the distinction: a dead chat retried every minute is a
  // queue that grows quietly while every row still looks delivered, which is
  // exactly how a placeholder chat stayed subscribed for weeks.
  it("recognises failures that no retry can fix", () => {
    expect(isPermanentSendFailure("Bad Request: chat not found")).toBe(true);
    expect(isPermanentSendFailure("Forbidden: bot was blocked by the user")).toBe(true);
    expect(isPermanentSendFailure("Forbidden: user is deactivated")).toBe(true);
    expect(isPermanentSendFailure("Bad Request: PEER_ID_INVALID")).toBe(true);
    expect(isPermanentSendFailure("Bad Request: chat_id is empty")).toBe(true);
  });

  it("leaves a transient failure retryable", () => {
    expect(isPermanentSendFailure("")).toBe(false);
    expect(isPermanentSendFailure("Too Many Requests: retry after 5")).toBe(false);
    expect(isPermanentSendFailure("Internal Server Error")).toBe(false);
  });
});

describe("quietEndsAt", () => {
  it("overnight window on the evening side ends tomorrow", () => {
    const end = quietEndsAt(night, "22", "7");
    expect(end.toISOString()).toBe("2026-10-06T07:00:00.000Z");
  });
  it("overnight window on the morning side ends today", () => {
    const end = quietEndsAt(new Date("2026-10-05T06:00:00Z"), "22", "7");
    expect(end.toISOString()).toBe("2026-10-05T07:00:00.000Z");
  });
});

describe("deliver", () => {
  it("no-ops without recipients or DB and never throws", async () => {
    delete process.env.TELEGRAM_DEFAULT_CHAT_ID;
    await deliver("unknown/repo", "push", "<b>hi</b>");
  }, 30_000);
});
