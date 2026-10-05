import { describe, expect, it } from "vitest";
import {
  LINK_TTL_MS,
  codeExpiry,
  genCode,
  genToken,
  parseCommand,
} from "../src/telegramBot.js";

describe("parseCommand", () => {
  it("parses /start with deep-link token", () => {
    expect(parseCommand("/start abc123")).toEqual({ cmd: "start", arg: "abc123" });
  });
  it("strips bot-name suffix and lowercases", () => {
    expect(parseCommand("/LINK@CommitItBot")).toEqual({ cmd: "link", arg: undefined });
  });
  it("ignores non-commands", () => {
    expect(parseCommand("hello")).toBeNull();
    expect(parseCommand("")).toBeNull();
    expect(parseCommand(undefined)).toBeNull();
    expect(parseCommand("/")).toBeNull();
  });
});

describe("genToken", () => {
  it("is 32 lowercase hex chars and unique", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const t = genToken();
      expect(t).toMatch(/^[0-9a-f]{32}$/);
      seen.add(t);
    }
    expect(seen.size).toBe(100);
  });
});

describe("genCode", () => {
  it("is 6 chars from the unambiguous alphabet", () => {
    expect(genCode(() => 0)).toBe("AAAAAA");
    expect(genCode()).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
  });
});

describe("codeExpiry", () => {
  it("expires LINK_TTL_MS after now", () => {
    expect(codeExpiry(1_000_000).getTime() - 1_000_000).toBe(LINK_TTL_MS);
  });
});
