// telegramUi.ts — the bot's UI surface: the "/" command menu (which is what
// gives clients autofill) and the inline keyboards attached to replies.
//
// Pure builders only — no DB, no fetch — so the Vercel webhook and the Render
// poller render byte-identical UI, and tests can assert the exact markup with no
// network stub. Telegram's limits are enforced here rather than at each call
// site:
//   setMyCommands : ≤ 32 commands, name ≤ 32 chars, description ≤ 256
//   callback_data : ≤ 64 bytes (button text is plain text — no HTML)
//   toast text    : ≤ 200 chars (answerCallbackQuery)

export type InlineButton = { text: string; url?: string; callback_data?: string };
export type InlineKeyboard = { inline_keyboard: InlineButton[][] };
export type BotCommand = { command: string; description: string };

export const CALLBACK_DATA_MAX = 64;
export const CALLBACK_TOAST_MAX = 190;

/** The "/" autofill menu. Registered by scripts/setBotCommands.ts (`npm run bot:setup`). */
export const BOT_COMMANDS: BotCommand[] = [
  { command: "start", description: "Link this chat to CommitIt" },
  { command: "repos", description: "Your repos, with subscribe buttons" },
  { command: "recent", description: "Latest commits in this chat's repos" },
  { command: "digest", description: "How often this chat is notified" },
  { command: "bind", description: "Subscribe this chat: /bind owner/repo" },
  { command: "unlink", description: "Unsubscribe: /unlink [owner/repo]" },
  { command: "link", description: "Get a 6-character code for the website" },
  { command: "help", description: "What this bot can do" },
];

// Mirrors notifyPrefs.DIGEST_MODES; telegramUi.test.ts fails if they drift.
export const UI_DIGEST_MODES = ["instant", "hourly", "daily", "weekly"] as const;
export type UiDigestMode = (typeof UI_DIGEST_MODES)[number];

const MODE_LABEL: Record<UiDigestMode, string> = {
  instant: "Instant",
  hourly: "Hourly",
  daily: "Daily",
  weekly: "Weekly",
};

const DEFAULT_SITE = "https://commitit-web.vercel.app";

/** Website base URL — APP_URL when configured, which both hosts define. */
export function websiteUrl(): string {
  const configured = (process.env.APP_URL ?? "").trim().replace(/\/+$/, "");
  return configured || DEFAULT_SITE;
}

function fits(data: string): boolean {
  return Buffer.byteLength(data, "utf8") <= CALLBACK_DATA_MAX;
}

/** A URL button, so "what next?" replies always have somewhere to go. */
export function startKeyboard(): InlineKeyboard {
  return { inline_keyboard: [[{ text: "🌐 Open CommitIt", url: websiteUrl() }]] };
}

export type RepoToggle = { repo: string; bound: boolean };

/** "sub:o/r" / "unsub:o/r" — the tap target behind one repo row. */
export function toggleCallbackData(bound: boolean, repo: string): string {
  return `${bound ? "unsub" : "sub"}:${repo}`;
}

/** One row per repo: "＋ o/r" subscribes, "✓ o/r" removes. */
export function reposKeyboard(rows: RepoToggle[]): InlineKeyboard | undefined {
  const buttons: InlineButton[] = [];
  for (const row of rows) {
    const data = toggleCallbackData(row.bound, row.repo);
    // Repo names can exceed the 64-byte callback cap. Those keep the typed
    // /bind /unlink path rather than a button Telegram would reject.
    if (!fits(data)) continue;
    buttons.push({ text: `${row.bound ? "✓" : "＋"} ${row.repo}`, callback_data: data });
  }
  return buttons.length > 0 ? { inline_keyboard: buttons.map((b) => [b]) } : undefined;
}

export type ReposView = { text: string; keyboard?: InlineKeyboard };

/** The /repos body. Same listing as before buttons, plus a tap hint when tappable. */
export function reposView(repos: string[], bound: Set<string>, cap = 15): ReposView {
  const shown = repos.slice(0, cap);
  const lines = shown.map((r) => `${bound.has(r) ? "✓" : "·"} <code>${r}</code>`);
  if (repos.length > cap) lines.push(`+${repos.length - cap} more`);
  const keyboard = reposKeyboard(shown.map((r) => ({ repo: r, bound: bound.has(r) })));
  const hint = keyboard
    ? "/bind owner/repo to add — or tap a repo below."
    : "/bind owner/repo to add.";
  return {
    text: `Your repos (✓ = this chat is subscribed):\n${lines.join("\n")}\n${hint}`,
    keyboard,
  };
}

export type DigestRow = { repo: string; digestMode: string; isMuted: boolean };
export type DigestView = { text: string; keyboard?: InlineKeyboard };

/**
 * Mode buttons. With exactly one subscription the repo is pinned into the
 * callback data so the tap applies to that repo; with several, the tap is
 * chat-wide — the same thing "/digest <mode>" does (admin-gated in groups).
 */
export function digestKeyboard(current?: string, repo?: string): InlineKeyboard {
  const pinned = repo && fits(`digest:${"weekly"}:${repo}`) ? `:${repo}` : "";
  const row = UI_DIGEST_MODES.map<InlineButton>((m) => ({
    text: (current === m ? "• " : "") + MODE_LABEL[m],
    callback_data: `digest:${m}${pinned}`,
  }));
  return { inline_keyboard: [row] };
}

/** The /digest body: per-subscription modes, then the mode buttons. */
export function digestView(subs: DigestRow[]): DigestView {
  if (subs.length === 0) return { text: "This chat has no subscriptions." };
  const lines = subs.map(
    (s) => `<code>${s.repo}</code> → ${s.digestMode}${s.isMuted ? " (muted)" : ""}`,
  );
  const modes = new Set(subs.map((s) => s.digestMode));
  const only = subs.length === 1 ? subs[0] : undefined;
  return {
    text:
      `Notifications for this chat:\n${lines.join("\n")}\n` +
      "/digest <instant|hourly|daily|weekly> [owner/repo] to change" +
      (only ? " — or tap a mode below." : "."),
    keyboard: digestKeyboard(modes.size === 1 ? only?.digestMode : undefined, only?.repo),
  };
}
