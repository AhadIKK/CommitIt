// linkApi.ts — website side of Telegram linking. Read-only except the two
// POSTs that mint/claim single-use link rows. Errors surface as messages.
export type LinkToken = { code: string; url: string | null };

async function parse<T>(res: Response): Promise<T> {
  const body = (await res.json()) as { ok: boolean; data?: T; error?: string };
  if (!res.ok || !body.ok) throw new Error(body.error ?? `request failed: ${res.status}`);
  return body.data as T;
}

export function issueLinkToken(repo: string): Promise<LinkToken> {
  return fetch("/api/link-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repo }),
  }).then((r) => parse<LinkToken>(r));
}

export function pollLinkToken(code: string): Promise<{ claimed: boolean }> {
  return fetch(`/api/link-token/${encodeURIComponent(code)}`).then((r) =>
    parse<{ claimed: boolean }>(r),
  );
}

export function claimLinkCode(code: string, repo: string): Promise<void> {
  return fetch("/api/link-code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, repo }),
  }).then((r) => parse<unknown>(r).then(() => undefined));
}

const LINK_ERRORS: Record<string, string> = {
  invalid_repo: "Enter a repo as owner/name.",
  invalid_input: "Enter a 6-letter code and a repo as owner/name.",
  invalid_or_expired: "That code is wrong, used, or expired. Send /link to the bot for a fresh one.",
  bot_not_configured: "Telegram bot is not configured yet.",
  rate_limited: "Too many tries — wait a minute.",
  unavailable: "Linking is temporarily unavailable, try again soon.",
  not_found: "That link does not exist.",
};

export function linkErrorMessage(err: unknown): string {
  const key = err instanceof Error ? err.message : "";
  return LINK_ERRORS[key] ?? "Something went wrong, try again.";
}
