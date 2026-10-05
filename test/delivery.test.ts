import { describe, expect, it } from "vitest";
import { deliver, routeRecipient } from "../src/delivery.js";
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
