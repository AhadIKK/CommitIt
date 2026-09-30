import { describe, expect, it } from "vitest";
import { signPayload, verifySignature } from "../src/verify.js";

describe("verifySignature", () => {
  const secret = "test-secret";
  const body = JSON.stringify({ hello: "world" });

  it("accepts a valid signature", () => {
    expect(verifySignature(body, signPayload(body, secret), secret)).toBe(true);
  });

  it("rejects on mismatch", () => {
    expect(verifySignature(body, signPayload("other", secret), secret)).toBe(
      false,
    );
  });

  it("rejects missing/malformed signature", () => {
    expect(verifySignature(body, undefined, secret)).toBe(false);
    expect(verifySignature(body, "sha1=abc", secret)).toBe(false);
  });

  it("rejects empty secret", () => {
    expect(verifySignature(body, signPayload(body, secret), "")).toBe(false);
  });
});
