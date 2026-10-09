import { describe, expect, it } from "vitest";
import {
  SESSION_TTL_SEC,
  genState,
  parseCookies,
  signSession,
  verifySession,
} from "../src/session.js";

const SECRET = "test-session-secret";

describe("session cookies", () => {
  it("round-trips a signed session", () => {
    const token = signSession({ login: "octocat", avatarUrl: "https://x/y.png" }, SECRET, 1000);
    const payload = verifySession(token, SECRET, 1000);
    expect(payload?.login).toBe("octocat");
    expect(payload?.avatarUrl).toBe("https://x/y.png");
    expect(payload?.exp).toBe(1000 + SESSION_TTL_SEC);
  });

  it("rejects tampered tokens", () => {
    const token = signSession({ login: "octocat" }, SECRET, 1000);
    const tampered = token.slice(0, -2) + (token.endsWith("AA") ? "BB" : "AA");
    expect(verifySession(tampered, SECRET, 1000)).toBeNull();
  });

  it("rejects expired sessions and wrong secrets", () => {
    const token = signSession({ login: "octocat" }, SECRET, 1000);
    expect(verifySession(token, SECRET, 1000 + SESSION_TTL_SEC)).toBeNull();
    expect(verifySession(token, "other-secret", 1000)).toBeNull();
    expect(verifySession(undefined, SECRET, 1000)).toBeNull();
    expect(verifySession("garbage", SECRET, 1000)).toBeNull();
  });

  it("generates unique 32-hex states", () => {
    const a = genState();
    const b = genState();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(b).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });

  it("parses cookie headers", () => {
    expect(parseCookies("a=1; b=hello%20world; a=ignored")).toEqual({
      a: "1",
      b: "hello world",
    });
    expect(parseCookies(undefined)).toEqual({});
  });
});
