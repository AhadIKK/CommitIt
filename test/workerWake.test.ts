import { afterEach, describe, expect, it, vi } from "vitest";
import { pingWorker } from "../src/workerWake.js";

afterEach(() => {
  delete process.env.WORKER_URL;
  vi.unstubAllGlobals();
});

describe("pingWorker", () => {
  it("skips without WORKER_URL and never fetches", async () => {
    const fetchFn = vi.fn();
    vi.stubGlobal("fetch", fetchFn);
    await expect(pingWorker()).resolves.toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("returns true on a healthy worker", async () => {
    process.env.WORKER_URL = "https://worker.example.com/";
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"ok":true}', { status: 200 })));
    await expect(pingWorker()).resolves.toBe(true);
  });

  it("returns false when the worker is down", async () => {
    process.env.WORKER_URL = "https://worker.example.com";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("down");
      }),
    );
    await expect(pingWorker()).resolves.toBe(false);
  });
});
