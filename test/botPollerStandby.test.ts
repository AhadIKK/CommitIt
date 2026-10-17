import { afterEach, describe, expect, it, vi } from "vitest";
import { pollOnce, startBotPolling } from "../src/telegramBot.js";

vi.mock("../src/db.js", () => ({ prisma: {} }));

const conflict = () =>
  new Response(JSON.stringify({ ok: false, error_code: 409 }), { status: 409 });
const updates = (result: unknown[] = []) =>
  new Response(JSON.stringify({ ok: true, result }), { status: 200 });

afterEach(() => {
  delete process.env.TELEGRAM_BOT_TOKEN;
  vi.unstubAllGlobals();
});

describe("pollOnce", () => {
  it("reports webhookActive on 409 instead of throwing", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "tok";
    vi.stubGlobal("fetch", vi.fn(async () => conflict()));
    await expect(pollOnce(0)).resolves.toEqual({ next: 0, webhookActive: true });
  });

  it("advances the offset on a normal batch", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "tok";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        updates([{ update_id: 4, message: { chat: { id: 1 }, from: { id: 2 }, text: "/x" } }]),
      ),
    );
    await expect(pollOnce(0)).resolves.toEqual({ next: 5, webhookActive: false });
  });

  it("is a no-op without a token", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(pollOnce(3)).resolves.toEqual({ next: 3, webhookActive: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("startBotPolling standby", () => {
  it("disables itself when no token is set", () => {
    const log = { info: () => {}, error: () => {} };
    expect(startBotPolling(log)).toBeNull();
  });

  // While a webhook is registered Telegram 409s getUpdates. The poller must
  // step aside quietly, and must come back by itself if the webhook vanishes —
  // that automatic resume is what makes the webhook safe to ship as primary.
  it("backs off while a webhook is registered, then resumes", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "tok";
    let mode: "conflict" | "ok" = "conflict";
    const fetchMock = vi.fn(async () => (mode === "conflict" ? conflict() : updates()));
    vi.stubGlobal("fetch", fetchMock);
    const logs: string[] = [];
    const log = { info: (_o: object, m: string) => logs.push(m), error: () => {} };

    const timer = startBotPolling(log, 10, 60);
    expect(timer).not.toBeNull();
    try {
      await new Promise((r) => setTimeout(r, 90));
      const standbyCalls = fetchMock.mock.calls.length;
      // Backed off to one call per ~60ms, not one per 10ms tick.
      expect(standbyCalls).toBeLessThanOrEqual(3);
      expect(logs).toContain("telegram webhook active — polling backed off (standby)");

      mode = "ok";
      await new Promise((r) => setTimeout(r, 200));
      expect(fetchMock.mock.calls.length).toBeGreaterThan(standbyCalls);
      expect(logs).toContain("telegram webhook gone — polling resumed");
    } finally {
      if (timer) clearInterval(timer);
    }
  });
});
