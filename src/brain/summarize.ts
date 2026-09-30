import { getProvider } from "../ai/providers/index.js";

// summarize(): LLM behind provider interface, cached by SHA.
// Respects repos.ai_enabled=false. Degraded fallback (raw msg) on
// timeout/error — never blocks the pipeline. Char-cap enforced by caller.

const cache = new Map<string, string>();

export function clearSummaryCache(): void {
  cache.clear();
}

export async function summarize(opts: {
  sha: string;
  message: string;
  diffExcerpt: string;
  aiEnabled: boolean;
}): Promise<{ text: string; degraded: boolean }> {
  if (!opts.aiEnabled) return { text: opts.message, degraded: true };
  const hit = cache.get(opts.sha);
  if (hit) return { text: hit, degraded: false };
  try {
    const provider = getProvider();
    const timed = await withTimeout(
      provider.summarize({
        sha: opts.sha,
        message: opts.message,
        diffExcerpt: opts.diffExcerpt,
      }),
      8000,
    );
    cache.set(opts.sha, timed);
    return { text: timed, degraded: false };
  } catch {
    return { text: opts.message, degraded: true };
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("ai_timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
