// linkApi.ts — website side of Telegram linking. Read-only except the two
// POSTs that mint/claim single-use link rows. Errors surface as messages.
export type LinkToken = { code: string; url: string | null };

async function parse<T>(res: Response): Promise<T> {
  const body = (await res.json()) as { ok: boolean; data?: T; error?: string };
  if (!res.ok || !body.ok) throw new Error(body.error ?? `request failed: ${res.status}`);
  return body.data as T;
}

export function issueLinkToken(repo: string): Promise<LinkToken> {
  return fetch("/api/link?op=issue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repo }),
  }).then((r) => parse<LinkToken>(r));
}

export function pollLinkToken(code: string): Promise<{ claimed: boolean }> {
  return fetch(`/api/link?op=poll&code=${encodeURIComponent(code)}`).then((r) =>
    parse<{ claimed: boolean }>(r),
  );
}

export function claimLinkCode(code: string, repo: string): Promise<void> {
  return fetch("/api/link?op=claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, repo }),
  }).then((r) => parse<unknown>(r).then(() => undefined));
}

export type MySubscription = { repo: string; digestMode: string; isMuted: boolean };

export function fetchMySubscriptions(): Promise<MySubscription[]> {
  return fetch("/api/link?op=my-subscriptions").then((r) => parse<MySubscription[]>(r));
}

export function setDigestMode(repo: string, mode: string): Promise<{ updated: number }> {
  return fetch("/api/link?op=set-digest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repo, mode }),
  }).then((r) => parse<{ updated: number }>(r));
}

const LINK_ERRORS: Record<string, string> = {
  invalid_repo: "Enter a repo as owner/name.",
  invalid_input: "Enter a 6-letter code and a repo as owner/name.",
  invalid_or_expired: "That code is wrong, used, or expired. Send /link to the bot for a fresh one.",
  invalid_mode: "Pick instant, hourly, daily, or weekly.",
  bot_not_configured: "Telegram bot is not configured yet.",
  rate_limited: "Too many tries — wait a minute.",
  unavailable: "Linking is temporarily unavailable, try again soon.",
  not_found: "That link does not exist.",
  logged_out: "Link your GitHub account first.",
  forbidden: "Your account can't change that repo.",
  no_subscription: "No Telegram subscription for that repo yet — link a chat first.",
};

export function linkErrorMessage(err: unknown): string {
  const key = err instanceof Error ? err.message : "";
  return LINK_ERRORS[key] ?? "Something went wrong, try again.";
}
