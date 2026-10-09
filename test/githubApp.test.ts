import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildAppJwt,
  buildAuthorizeUrl,
  callbackUrl,
  parseInstallationEvent,
} from "../src/githubApp.js";
import installationFixture from "./fixtures/installation.json";

describe("buildAuthorizeUrl", () => {
  it("points at github.com with client, redirect, state", () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: "abc",
        redirectUri: "https://app.example/api/auth/callback",
        state: "s3cr3t",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("abc");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.example/api/auth/callback");
    expect(url.searchParams.get("state")).toBe("s3cr3t");
  });
});

describe("callbackUrl", () => {
  it("prefers APP_URL, then forwarded host, then localhost", () => {
    const savedAppUrl = process.env.APP_URL;
    const savedPort = process.env.PORT;
    try {
      process.env.APP_URL = "https://commitit-web.vercel.app/";
      expect(callbackUrl({})).toBe("https://commitit-web.vercel.app/api/auth/callback");
      delete process.env.APP_URL;
      expect(callbackUrl({ "x-forwarded-host": "x.vercel.app" })).toBe(
        "https://x.vercel.app/api/auth/callback",
      );
      process.env.PORT = "4000";
      expect(callbackUrl({})).toBe("http://localhost:4000/api/auth/callback");
    } finally {
      if (savedAppUrl !== undefined) process.env.APP_URL = savedAppUrl;
      else delete process.env.APP_URL;
      if (savedPort !== undefined) process.env.PORT = savedPort;
      else delete process.env.PORT;
    }
  });
});

describe("parseInstallationEvent", () => {
  it("parses install-created from the fixture", () => {
    expect(parseInstallationEvent(installationFixture)).toEqual({
      kind: "installed",
      installationId: 12345678n,
      repos: ["AhadIKK/CommitIt"],
    });
  });

  it("parses removal and ignores the rest", () => {
    expect(
      parseInstallationEvent({ action: "deleted", installation: { id: 9 }, repositories: [] }),
    ).toEqual({ kind: "removed", installationId: 9n, repos: [] });
    expect(parseInstallationEvent({ action: "suspend", installation: { id: 9 } })).toBeNull();
    expect(parseInstallationEvent({ action: "opened" })).toBeNull();
    expect(parseInstallationEvent(null)).toBeNull();
  });
});

describe("buildAppJwt", () => {
  it("signs RS256 verifiable with the public key", () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const now = 1_700_000_000;
    const jwt = buildAppJwt({ appId: "42", privateKeyPem: privateKey, nowSec: now });
    const [header, payload, sig] = jwt.split(".");
    expect(
      crypto.verify(
        "RSA-SHA256",
        Buffer.from(`${header}.${payload}`),
        publicKey,
        Buffer.from(sig as string, "base64url"),
      ),
    ).toBe(true);
    const claims = JSON.parse(Buffer.from(payload as string, "base64url").toString());
    expect(claims.iss).toBe("42");
    expect(claims.exp - claims.iat).toBe(10 * 60);
  });
});
