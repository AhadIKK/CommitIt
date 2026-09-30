// Telegram sender. PLACEHOLDER: no real Bot API calls.
// When TELEGRAM_BOT_TOKEN is unset (current state), everything is logged
// and returned as { ok: true, placeholder: true } so the pipeline,
// formatter limits and worker flow can be verified end-to-end.
// Swap the internals of sendMessage() for fetch() to api.telegram.org later;
// keep the same signature.

export type TelegramResult = { ok: boolean; placeholder: boolean };

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function sendMessage(
  chatId: string,
  html: string,
  log?: { info: (o: object, m: string) => void },
): Promise<TelegramResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN ?? "";
  if (!token) {
    log?.info({ chatId, len: html.length }, "telegram placeholder: logged only");
    return { ok: true, placeholder: true };
  }
  // Real send (unused while placeholder): HTML parse mode.
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: html,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
  return { ok: res.ok, placeholder: false };
}

export { escapeHtml };
