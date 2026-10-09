import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  clearTokenCache,
  getInstallationToken,
  installationApiFetch,
  normalizePrivateKey,
} from "../src/githubAuth.js";

const { privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const KEYS = { appId: "42", privateKeyPem: privateKey };

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  return async (url: string | URL | Request, init?: RequestInit) => {
    const target = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    return handler(target, init);
  };
}

function tokenResponse(token: string, expiresAt: string) {
  return new Response(JSON.stringify({ token, expires_at: expiresAt }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("normalizePrivateKey", () => {
  it("accepts base64 form", () => {
    const b64 = Buffer.from(privateKey).toString("base64");
    expect(normalizePrivateKey("", b64)).toBe(
      privateKey.endsWith("\n") ? privateKey : `${privateKey}\n`,
    );
  });

  it("accepts raw PEM with escaped and real newlines", () => {
    const escaped = privateKey.replace(/\n/g, "\\n");
    expect(normalizePrivateKey(escaped, "").replace(/\n$/, "")).toBe(
      privateKey.replace(/\n$/, ""),
    );
    expect(normalizePrivateKey(privateKey, "")).toContain("-----BEGIN");
  });

  it("rejects missing and non-PEM input", () => {
    expect(normalizePrivateKey("", "")).toBe("");
    expect(normalizePrivateKey("not-a-key", "")).toBe("");
    expect(normalizePrivateKey("", Buffer.from("not-a-key").toString("base64"))).toBe("");
  });
});

describe("getInstallationToken", () => {
  it("mints and caches until near expiry (mocked clock + HTTP)", async () => {
    clearTokenCache();
    let calls = 0;
    const fetchFn = stubFetch(() => {
      calls += 1;
      return tokenResponse(`tok-${calls}`, new Date(1_700_000_000_000 + 3600_000).toISOString());
    });
    const nowMs = 1_700_000_000_000;
    const first = await getInstallationToken(7, KEYS, { nowMs, fetchFn: fetchFn as never });
    const second = await getInstallationToken(7, KEYS, { nowMs, fetchFn: fetchFn as never });
    expect(first).toBe("tok-1");
    expect(second).toBe("tok-1");
    expect(calls).toBe(1);
  });

  it("re-mints inside the 5-minute skew window", async () => {
    clearTokenCache();
    let calls = 0;
    const fetchFn = stubFetch(() => {
      calls += 1;
      return tokenResponse(`tok-${calls}`, new Date(1_700_000_000_000 + 3600_000).toISOString());
    });
    const minted = await getInstallationToken(9, KEYS, {
      nowMs: 1_700_000_000_000,
      fetchFn: fetchFn as never,
    });
    expect(minted).toBe("tok-1");
    // 1h token, now 56 min later -> 4 min left < 5 min skew -> re-mint.
    const refreshed = await getInstallationToken(9, KEYS, {
      nowMs: 1_700_000_000_000 + 56 * 60_000,
      fetchFn: fetchFn as never,
    });
    expect(refreshed).toBe("tok-2");
    expect(calls).toBe(2);
  });

  it("surfaces mint failures without caching", async () => {
    clearTokenCache();
    let calls = 0;
    const failing = stubFetch(() => {
      calls += 1;
      return new Response("denied", { status: 401 });
    });
    await expect(
      getInstallationToken(11, KEYS, { nowMs: 1_700_000_000_000, fetchFn: failing as never }),
    ).rejects.toThrow("installation_token_401");
    const ok = stubFetch(() => tokenResponse("tok-ok", new Date(1_700_000_3600_000).toISOString()));
    await expect(
      getInstallationToken(11, KEYS, { nowMs: 1_700_000_000_000, fetchFn: ok as never }),
    ).resolves.toBe("tok-ok");
    expect(calls).toBe(1);
  });
});

describe("installationApiFetch", () => {
  it("sends versioned headers with the install token", async () => {
    clearTokenCache();
    let seen: { url: string; init?: RequestInit } | null = null;
    const fetchFn = stubFetch((url, init) => {
      if (url.endsWith("/access_tokens")) {
        return tokenResponse("tok-x", new Date(Date.now() + 3600_000).toISOString());
      }
      seen = { url, init };
      return new Response("{}", { status: 200 });
    });
    const res = await installationApiFetch(13, KEYS, "/repos/o/r/issues", {}, {
      fetchFn: fetchFn as never,
    });
    expect(res.status).toBe(200);
    expect(seen?.url).toBe("https://api.github.com/repos/o/r/issues");
    const headers = new Headers(seen?.init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer tok-x");
    expect(headers.get("X-GitHub-Api-Version")).toBe("2022-11-28");
  });
});
