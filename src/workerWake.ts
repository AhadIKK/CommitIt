// workerWake.ts — the free Render worker sleeps; its in-process poller only
// runs while awake, so queued backfill/digest jobs sit until traffic wakes
// it. Ping the worker after enqueueing its work. Awaited with a cap
// (serverless freezes fire-and-forget, so it must be awaited to count),
// never throws, skipped when WORKER_URL is unset. Render wakes on the
// incoming connection even if we stop waiting — the cap only bounds us.
export async function pingWorker(timeoutMs = 5_000): Promise<boolean> {
  const base = (process.env.WORKER_URL ?? "").trim().replace(/\/+$/, "");
  if (!base) return false;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${base}/health`, { signal: ctrl.signal });
      return res.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}
