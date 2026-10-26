import { describe, expect, it } from "vitest";
import {
  churn,
  clockTime,
  dateRange,
  initials,
  percentLabel,
  pluralize,
  relativeTime,
  shortDate,
  shortSha,
  sinceClause,
} from "./format.js";

const NOW = new Date("2026-10-17T12:00:00Z");

describe("pluralize", () => {
  it("uses the singular only for exactly one", () => {
    expect(pluralize(0, "commit")).toBe("0 commits");
    expect(pluralize(1, "commit")).toBe("1 commit");
    expect(pluralize(2, "commit")).toBe("2 commits");
  });

  it("accepts an irregular plural", () => {
    expect(pluralize(2, "branch", "branches")).toBe("2 branches");
    expect(pluralize(1, "branch", "branches")).toBe("1 branch");
  });
});

describe("relativeTime", () => {
  it("reads the way a person would say it", () => {
    expect(relativeTime("2026-10-17T11:59:40Z", NOW)).toBe("just now");
    expect(relativeTime("2026-10-17T11:56:00Z", NOW)).toBe("4 mins ago");
    expect(relativeTime("2026-10-17T09:00:00Z", NOW)).toBe("3 hours ago");
    expect(relativeTime("2026-10-15T12:00:00Z", NOW)).toBe("2 days ago");
  });

  it("never throws on a bad timestamp", () => {
    expect(relativeTime("not a date", NOW)).toBe("unknown");
  });
});

describe("clocks and dates", () => {
  it("quotes the digest window as a time", () => {
    expect(clockTime("2026-10-17T09:00:00Z")).toMatch(/^\d{1,2}:\d{2}$/);
    expect(sinceClause("2026-10-17T09:00:00Z")).toBe(`Since your last digest, ${clockTime("2026-10-17T09:00:00Z")}`);
  });

  it("writes ranges with an en dash", () => {
    expect(shortDate("2026-10-12T00:00:00Z")).toBe("12 Oct");
    expect(dateRange("2026-10-12T00:00:00Z", "2026-10-18T00:00:00Z")).toBe("12 Oct – 18 Oct");
  });
});

describe("code-ish values", () => {
  it("shortens a sha to seven characters", () => {
    expect(shortSha("a3f9c1d7e5b2aa10")).toBe("a3f9c1d");
  });

  it("keeps the sign on both churn figures", () => {
    expect(churn(128, 9)).toBe("+128 −9");
    expect(churn(0, 0)).toBe("+0 −0");
  });
});

describe("initials", () => {
  it("takes first and last name, or the first two characters", () => {
    expect(initials("Fizan Rahman")).toBe("FR");
    expect(initials("fizan")).toBe("FI");
    expect(initials("Dev Laptop")).toBe("DL");
    expect(initials("")).toBe("?");
  });
});

describe("percentLabel", () => {
  it("an empty goal is words, never 0%", () => {
    expect(percentLabel(null)).toBe("no issues yet");
    expect(percentLabel(62)).toBe("62%");
  });
});
