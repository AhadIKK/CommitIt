import crypto from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearTokenCache, getInstallationToken } from "../src/githubAuth.js";
import { jobFailureAction, PermanentJobError } from "../src/jobErrors.js";

afterEach(() => {
  clearTokenCache();
  vi.unstubAllGlobals();
});

// Minimal RSA key so buildAppJwt can sign; the signing itself is not under test.
function keys() {
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  return { appId: "42", privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }) as string };
}

describe("jobFailureAction", () => {
  it("abandons a PermanentJobError on the first failure (retry cannot help)", () => {
    expect(jobFailureAction(new PermanentJobError("gone"), 1, 20)).toBe("abandon");
  });

  it("retries an ordinary error while attempts remain", () => {
    expect(jobFailureAction(new Error("flaky"), 1, 20)).toBe("retry");
  });

  it("abandons an ordinary error once the attempt cap is reached", () => {
    expect(jobFailureAction(new Error("poison"), 20, 20)).toBe("abandon");
    expect(jobFailureAction(new Error("poison"), 21, 20)).toBe("abandon");
  });

  it("treats a permanent error as abandoned even below the cap", () => {
    expect(jobFailureAction(new PermanentJobError("gone"), 2, 20)).toBe("abandon");
  });
});

describe("getInstallationToken failure classification", () => {
  it("throws PermanentJobError when the installation is gone (404)", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 404 }));
    await expect(getInstallationToken("170363073", keys())).rejects.toBeInstanceOf(
      PermanentJobError,
    );
  });

  it("throws PermanentJobError on 410 as well", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 410 }));
    await expect(getInstallationToken("170363074", keys())).rejects.toBeInstanceOf(
      PermanentJobError,
    );
  });

  it("keeps server errors retryable (not permanent)", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 500 }));
    const err = await getInstallationToken("170363075", keys()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(PermanentJobError);
    expect((err as Error).message).toBe("installation_token_500");
  });

  it("returns the token on success", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({ token: "tok-1", expires_at: new Date(Date.now() + 3600_000).toISOString() }),
          { status: 201 },
        ),
    );
    await expect(getInstallationToken("170363076", keys())).resolves.toBe("tok-1");
  });
});
