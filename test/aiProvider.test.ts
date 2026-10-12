import { afterEach, describe, expect, it, vi } from "vitest";
import { getProvider } from "../src/ai/providers/index.js";
import {
  monthlySpend,
  openaiCompatibleProvider,
  resetAiSpend,
} from "../src/ai/providers/openaiCompatible.js";

const savedEnv: Record<string, string | undefined> = {};
for (const k of [
  "AI_PROVIDER",
  "AI_MODEL",
  "AI_BASE_URL",
  "AI_API_KEY",
  "AI_INPUT_PRICE",
  "AI_OUTPUT_PRICE",
  "AI_MONTHLY_CAP_USD",
]) {
  savedEnv[k] = process.env[k];
}

function setEnv(vars: Record<string, string>) {
  for (const k of Object.keys(savedEnv)) delete process.env[k];
  Object.assign(process.env, vars);
}

afterEach(() => {
  for (const k of Object.keys(savedEnv)) delete process.env[k];
  Object.assign(process.env, Object.fromEntries(Object.entries(savedEnv).filter(([, v]) => v !== undefined)));
  resetAiSpend();
  vi.unstubAllGlobals();
});

function okResponse(text: string, usage = { prompt_tokens: 100, completion_tokens: 20 }) {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: text } }], usage }),
    { status: 200 },
  );
}

describe("openai-compatible provider", () => {
  it("returns the summary text and records spend", async () => {
    setEnv({ AI_API_KEY: "k" });
    const fetchMock = vi.fn(async () => okResponse("Fixed the login bug."));
    vi.stubGlobal("fetch", fetchMock);
    const out = await openaiCompatibleProvider.summarize({
      sha: "abc",
      message: "fix: login bug",
      diffExcerpt: "diff",
    });
    expect(out).toBe("Fixed the login bug.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(JSON.parse(init.body as string).model).toBe("gpt-4o-mini");
    expect(monthlySpend()).toBeGreaterThan(0);
  });

  it("honors model + base-url overrides", async () => {
    setEnv({ AI_API_KEY: "k", AI_MODEL: "other-model", AI_BASE_URL: "https://gw.example.com/v1/" });
    const fetchMock = vi.fn(async () => okResponse("hi"));
    vi.stubGlobal("fetch", fetchMock);
    await openaiCompatibleProvider.summarize({ sha: "a", message: "m", diffExcerpt: "d" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://gw.example.com/v1/chat/completions");
    expect(JSON.parse(init.body as string).model).toBe("other-model");
  });

  it("throws without an API key (caller degrades)", async () => {
    setEnv({});
    const fetchMock = vi.fn(async () => okResponse("hi"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      openaiCompatibleProvider.summarize({ sha: "a", message: "m", diffExcerpt: "d" }),
    ).rejects.toThrow("ai_no_key");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws on HTTP errors and empty choices", async () => {
    setEnv({ AI_API_KEY: "k" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 429 })));
    await expect(
      openaiCompatibleProvider.summarize({ sha: "a", message: "m", diffExcerpt: "d" }),
    ).rejects.toThrow("ai_http_429");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ choices: [] }), { status: 200 })),
    );
    await expect(
      openaiCompatibleProvider.summarize({ sha: "a", message: "m", diffExcerpt: "d" }),
    ).rejects.toThrow("ai_empty");
  });

  it("refuses to spend past the monthly cap", async () => {
    setEnv({ AI_API_KEY: "k", AI_MONTHLY_CAP_USD: "0.000001" });
    const fetchMock = vi.fn(async () => okResponse("hi"));
    vi.stubGlobal("fetch", fetchMock);
    await openaiCompatibleProvider.summarize({ sha: "a", message: "m", diffExcerpt: "d" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(
      openaiCompatibleProvider.summarize({ sha: "a", message: "m", diffExcerpt: "d" }),
    ).rejects.toThrow("ai_cap_exceeded");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("getProvider", () => {
  it("selects echo by default and openai on request", async () => {
    setEnv({});
    const { echoProvider } = await import("../src/ai/providers/echo.js");
    expect(getProvider()).toBe(echoProvider);
    setEnv({ AI_PROVIDER: "openai" });
    expect(getProvider()).toBe(openaiCompatibleProvider);
  });
});
