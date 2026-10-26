// Telegram sender. Real Bot API calls whenever TELEGRAM_BOT_TOKEN is set.
//
// Deliberately LOUD on failure. A missing token used to return
// { ok: true, placeholder: true } with no log at all — which meant a host with
// no token (Vercel, before this was wired) accepted webhook updates, ran the
// command handler, and silently discarded every reply. An outbound outage
// looked exactly like the bot ignoring you. Failures now return ok:false and
// emit a warning, so the next occurrence is one log line away.
//
// Every call funnels through callTelegram(), so the missing-token trap cannot
// come back through a side door: one place checks the token, one place logs
// Telegram's refusal reason. The token itself is never logged.

import { CALLBACK_TOAST_MAX, type InlineKeyboard } from "./telegramUi.js";

export type TelegramResult = { ok: boolean; placeholder: boolean };

type Logger = {
  info?: (o: object, m: string) => void;
  error?: (o: object, m: string) => void;
};

export type SendOptions = { log?: Logger; replyMarkup?: InlineKeyboard };

type CallOutcome = { ok: boolean; missingToken: boolean; detail: string };

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function callTelegram(
  method: string,
  payload: Record<string, unknown>,
  log?: Logger,
): Promise<CallOutcome> {
  const token = (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
  if (!token) {
    const msg = "TELEGRAM_BOT_TOKEN unset — outbound Telegram disabled, reply dropped";
    log?.error?.({ method }, msg);
    console.warn(JSON.stringify({ msg, method }));
    return { ok: false, missingToken: true, detail: "" };
  }
  let res: Response;
  try {
    res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    const msg = "telegram send failed (network)";
    log?.error?.({ method, err: String(err) }, msg);
    console.warn(JSON.stringify({ msg, method, err: String(err) }));
    return { ok: false, missingToken: false, detail: "" };
  }
  if (!res.ok) {
    // Telegram's description is the actionable part ("chat not found", "bot was
    // blocked by the user", "Too Many Requests"). Never the token.
    let detail = "";
    try {
      detail = JSON.stringify(await res.json()).slice(0, 300);
    } catch {
      detail = "";
    }
    const msg = "telegram send rejected";
    log?.error?.({ method, status: res.status, detail }, msg);
    console.warn(JSON.stringify({ msg, method, status: res.status, detail }));
    return { ok: false, missingToken: false, detail };
  }
  return { ok: true, missingToken: false, detail: "" };
}

export async function sendMessage(
  chatId: string,
  html: string,
  opts: SendOptions = {},
): Promise<TelegramResult> {
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text: html,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (opts.replyMarkup) payload.reply_markup = opts.replyMarkup;
  const out = await callTelegram("sendMessage", payload, opts.log);
  return { ok: out.ok, placeholder: out.missingToken };
}

/** Rewrites a message in place — how a tapped button refreshes itself. */
export async function editMessageText(
  chatId: string,
  messageId: number,
  html: string,
  replyMarkup?: InlineKeyboard,
  opts: SendOptions = {},
): Promise<TelegramResult> {
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    message_id: messageId,
    text: html,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  const out = await callTelegram("editMessageText", payload, opts.log);
  // "message is not modified" means the view was already current: success.
  const alreadyCurrent = out.detail.includes("not modified");
  return { ok: out.ok || alreadyCurrent, placeholder: out.missingToken };
}

/**
 * Stops the client's button spinner and shows a short toast. Must be called for
 * every tap — otherwise Telegram leaves the button spinning for the user.
 */
export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string,
  opts: SendOptions = {},
): Promise<boolean> {
  const payload: Record<string, unknown> = { callback_query_id: callbackQueryId };
  if (text) payload.text = text.slice(0, CALLBACK_TOAST_MAX);
  const out = await callTelegram("answerCallbackQuery", payload, opts.log);
  // A tap that aged out is not worth failing on.
  return out.ok || out.detail.includes("too old");
}

export { escapeHtml };

/**
 * A Bot API call whose answer we need (getChat, getMe). Not a send: it returns
 * the `result` payload, or null with Telegram's reason logged. The token never
 * appears in the log.
 */
export async function telegramApi<T = unknown>(
  method: string,
  payload: Record<string, unknown> = {},
): Promise<T | null> {
  const token = (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
  if (!token) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await res.json()) as { ok?: boolean; result?: T; description?: string };
    if (!res.ok || !body.ok) {
      console.warn(
        JSON.stringify({
          msg: "telegram api rejected",
          method,
          status: res.status,
          detail: body.description ?? "",
        }),
      );
      return null;
    }
    return (body.result ?? null) as T | null;
  } catch (err) {
    console.warn(JSON.stringify({ msg: "telegram api failed", method, err: String(err) }));
    return null;
  }
}

let cachedBotUsername = "";

/**
 * The bot's own @username, from getMe. The connect flow can therefore build a
 * deep link from the token alone, instead of failing with "bot_not_configured"
 * when TELEGRAM_BOT_NAME was never copied into the environment.
 */
export async function botUsername(): Promise<string> {
  const configured = (process.env.TELEGRAM_BOT_NAME ?? "").trim().replace(/^@/, "");
  if (configured) return configured;
  if (cachedBotUsername) return cachedBotUsername;
  const me = await telegramApi<{ username?: string }>("getMe");
  cachedBotUsername = (me?.username ?? "").trim().replace(/^@/, "");
  return cachedBotUsername;
}
