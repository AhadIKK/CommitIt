// MVP in-memory fixed-window rate limiter for POST /webhook.
// Phase 6+ can swap for Redis; keep the same function signature.

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export function isRateLimited(
  key: string,
  opts: { windowMs?: number; max?: number; now?: number } = {},
): boolean {
  const windowMs = opts.windowMs ?? 60_000;
  const max = opts.max ?? 60;
  const now = opts.now ?? Date.now();

  const existing = buckets.get(key);
  if (!existing || now >= existing.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  existing.count += 1;
  return existing.count > max;
}

export function clearRateLimit(): void {
  buckets.clear();
}
