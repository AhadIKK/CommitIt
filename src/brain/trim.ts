// trim(): char-cap primary — 8KB / 200 lines max per file.
// Skip lockfiles, binaries, generated, vendor. gpt-tokenizer is estimate
// only; char count is the source of truth here.

const MAX_CHARS = 8000;
const MAX_LINES = 200;

const SKIP_RE =
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Gemfile\.lock|poetry\.lock|composer\.lock)$|\.min\.(js|css)$|\.(png|jpe?g|gif|ico|woff2?|ttf|pdf|zip|exe|dll|so)$|^(dist|build|vendor|node_modules|\.git)\//i;

export type TrimResult = {
  text: string;
  truncated: boolean;
  skipped: boolean;
  reason?: string;
};

export function shouldSkip(path: string): boolean {
  return SKIP_RE.test(path);
}

export function trim(path: string, content: string): TrimResult {
  if (shouldSkip(path)) {
    return { text: "", truncated: false, skipped: true, reason: "skip-list" };
  }
  const lines = content.split("\n");
  let text = lines.slice(0, MAX_LINES).join("\n");
  let truncated = lines.length > MAX_LINES;
  if (text.length > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS);
    truncated = true;
  }
  return { text, truncated, skipped: false };
}
