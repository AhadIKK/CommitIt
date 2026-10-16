import type { IncomingMessage, ServerResponse } from "node:http";
import { handleMessage } from "../src/telegramBot.js";

// POST /api/telegram — Telegram Bot API webhook receiver (inbound on
// Vercel, which never sleeps). Render long-polling stays as the automatic
// fallback: Telegram delivers to webhook XOR getUpdates, so the poller idles
// while this is set and resumes if the webhook is ever deleted.
// Auth: Telegram sends X-Telegram-Bot-Api-Secret-Token, compared against
// TELEGRAM_WEBHOOK_SECRET. Unset secret = 503 (never accept forgeries).

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on("end", () => {
      try {
        resolve(chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

type TgUpdate = {
  update_id?: number;
  message?: { chat?: { id?: number; type?: string }; from?: { id?: number }; text?: string };
};

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if ((req.method ?? "GET") !== "POST") {
    sendJson(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }
  const secret = (process.env.TELEGRAM_WEBHOOK_SECRET ?? "").trim();
  if (!secret) {
    console.warn(JSON.stringify({ msg: "telegram webhook rejected: no secret configured" }));
    sendJson(res, 503, { ok: false, error: "webhook_not_configured" });
    return;
  }
  const presented = req.headers["x-telegram-bot-api-secret-token"];
  if (presented !== secret) {
    sendJson(res, 401, { ok: false, error: "bad_secret" });
    return;
  }
  let body: TgUpdate;
  try {
    body = (await readJsonBody(req)) as TgUpdate;
  } catch {
    sendJson(res, 200, { ok: true }); // ack anyway: retry won't fix bad JSON
    return;
  }
  const chat = body.message?.chat?.id;
  if (chat !== undefined) {
    try {
      const fromId = body.message?.from?.id;
      await handleMessage(String(chat), body.message?.text, {
        telegramUserId: fromId === undefined ? undefined : String(fromId),
        chatType: body.message?.chat?.type,
      });
    } catch (err) {
      console.warn(JSON.stringify({ msg: "telegram webhook handling failed", err: String(err) }));
    }
  }
  // Always 200: Telegram retries non-200s, and a poison update would storm us.
  sendJson(res, 200, { ok: true });
}
