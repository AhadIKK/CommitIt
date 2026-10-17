// Telegram sender. Real Bot API calls whenever TELEGRAM_BOT_TOKEN is set.
//
// Deliberately LOUD on failure. A missing token used to return
// { ok: true, placeholder: true } with no log at all — which meant a host with
// no token (Vercel, before this was wired) accepted webhook updates, ran the
// command handler, and silently discarded every reply. An outbound outage
// looked exactly like the bot ignoring you. Failures now return ok:false and
// emit a warning, so the next occurrence is one log line away.

export type TelegramResult = { ok: boolean; placeholder: boolean };

type Logger = {
  info?: (o: object, m: string) => void;
  error?: (o: object, m: string) => void;
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function sendMessage(
  chatId: string,
  html: string,
  log?: Logger,
): Promise<TelegramResult> {
  const token = (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
  if (!token) {
    const msg = "TELEGRAM_BOT_TOKEN unset — outbound Telegram disabled, reply dropped";
    log?.error?.({ chatId, len: html.length }, msg);
    console.warn(JSON.stringify({ msg, chatId }));
    return { ok: false, placeholder: true };
  }
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: html,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
  } catch (err) {
    const msg = "telegram send failed (network)";
    log?.error?.({ chatId, err: String(err) }, msg);
    console.warn(JSON.stringify({ msg, chatId, err: String(err) }));
    return { ok: false, placeholder: false };
  }
  if (!res.ok) {
    // Telegram's description is the actionable part ("chat not found",
    // "bot was blocked by the user", "Too Many Requests"). Never the token.
    let detail = "";
    try {
      detail = JSON.stringify(await res.json()).slice(0, 300);
    } catch {
      detail = "";
    }
    const msg = "telegram send rejected";
    log?.error?.({ chatId, status: res.status, detail }, msg);
    console.warn(JSON.stringify({ msg, chatId, status: res.status, detail }));
    return { ok: false, placeholder: false };
  }
  return { ok: true, placeholder: false };
}

export { escapeHtml };
