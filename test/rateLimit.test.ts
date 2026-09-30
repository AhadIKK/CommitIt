import { beforeEach, describe, expect, it } from "vitest";
import { clearRateLimit, isRateLimited } from "../src/rateLimit.js";

describe("isRateLimited", () => {
  beforeEach(() => clearRateLimit());

  it("allows up to max then blocks", () => {
    const key = "test-ip";
    expect(isRateLimited(key, { max: 2, windowMs: 60_000, now: 1000 })).toBe(
      false,
    );
    expect(isRateLimited(key, { max: 2, windowMs: 60_000, now: 1001 })).toBe(
      false,
    );
    expect(isRateLimited(key, { max: 2, windowMs: 60_000, now: 1002 })).toBe(
      true,
    );
  });

  it("resets after window", () => {
    const key = "test-ip-2";
    isRateLimited(key, { max: 1, windowMs: 100, now: 0 });
    expect(isRateLimited(key, { max: 1, windowMs: 100, now: 50 })).toBe(true);
    expect(isRateLimited(key, { max: 1, windowMs: 100, now: 101 })).toBe(false);
  });
});
