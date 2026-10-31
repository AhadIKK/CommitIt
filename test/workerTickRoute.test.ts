import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { tick } = vi.hoisted(() => ({
  tick: vi.fn(async () => ({ reclaimed: 0, jobs: 2, sent: 1, stoppedEarly: false })),
}));

vi.mock("../src/workerTick.js", () => ({ runWorkerTick: tick }));

import { handleWorkspace } from "../src/workspaceRoutes.js";

const SECRET = "s".repeat(40);

function call(headers: Record<string, string> = {}, method = "POST") {
  return handleWorkspace({
    method,
    path: "/worker/tick",
    query: new URLSearchParams(),
    body: {},
    cookies: {},
    headers,
    ip: "203.0.113.7",
  });
}

beforeEach(() => {
  tick.mockClear();
});

afterEach(() => {
  delete process.env.WORKER_TICK_SECRET;
});

describe("POST /worker/tick", () => {
  it("refuses to run when no key is configured, rather than running open", async () => {
    const out = await call({ "x-worker-key": SECRET });

    expect(out).toMatchObject({ status: 503, body: { error: "worker_tick_not_configured" } });
    expect(tick).not.toHaveBeenCalled();
  });

  it("rejects a wrong or missing key", async () => {
    process.env.WORKER_TICK_SECRET = SECRET;

    expect(await call({})).toMatchObject({ status: 401, body: { error: "unauthorized" } });
    expect(await call({ "x-worker-key": "s".repeat(39) + "x" })).toMatchObject({
      status: 401,
    });
    expect(tick).not.toHaveBeenCalled();
  });

  it("runs one tick and returns its counts", async () => {
    process.env.WORKER_TICK_SECRET = SECRET;

    const out = await call({ "x-worker-key": SECRET });

    expect(out).toEqual({ status: 200, body: { reclaimed: 0, jobs: 2, sent: 1, stoppedEarly: false } });
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it("is not reachable by GET", async () => {
    process.env.WORKER_TICK_SECRET = SECRET;

    expect(await call({ "x-worker-key": SECRET }, "GET")).toBeNull();
    expect(tick).not.toHaveBeenCalled();
  });
});
