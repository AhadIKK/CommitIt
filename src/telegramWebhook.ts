import crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleMessage } from "./telegramBot.js";

// Telegram inbound via webhook — the PRIMARY path, served by Vercel which
// never sleeps, so replies are instant 24/7 even while Render's free instance
// is hibernated. Render's getUpdates poller stays in the build as the
// automatic fallback (it backs off while a webhook is registered and resumes
// on its own if the webhook is ever deleted).
//
// Mounted on the shared dynamic function `api/auth/[action].ts` (action
// "telegram") to stay inside Vercel Hobby's 12-function cap; `/api/telegram`
// is a vercel.json rewrite onto that same function. `actionOf()` reads the
// last path segment, which is "telegram" under either URL.
//
// Auth: Telegram echoes X-Telegram-Bot-Api-Secret-Token, compared against
// TELEGRAM_WEBHOOK_SECRET. No secret configured = 503 (never accept
// forgeries), mismatch = 401. Anything past the gate 200s, because Telegram
// retries non-2xx and a poison update would otherwise storm the endpoint.

/** Vercel's Node runtime hands functions a pre-parsed body on the request. */
export type VercelRequest = IncomingMessage & { body?: unknown };

type TgUpdate = {
  update_id?: number;
  message?: {
    chat?: { id?: number; type?: string };
    from?: { id?: number };
    text?: string;
  };
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

/** Timing-safe compare; length mismatch short-circuits (leaks length only). */
function secretsMatch(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function readStreamJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer | string) =>
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
    );
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

async function readUpdate(req: VercelRequest): Promise<TgUpdate> {
  // Prefer the parsed body: Vercel drains the request stream to parse JSON,
  // so re-reading it yields {} and would silently drop every update.
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === "object") return req.body as TgUpdate;
    if (typeof req.body === "string") {
      try {
        return JSON.parse(req.body) as TgUpdate;
      } catch {
        return {};
      }
    }
    return {};
  }
  return (await readStreamJson(req)) as TgUpdate;
}

export async function handleTelegramWebhook(
  req: VercelRequest,
  res: ServerResponse,
): Promise<void> {
  if ((req.method ?? "GET").toUpperCase() !== "POST") {
    sendJson(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }
  const secret = (process.env.TELEGRAM_WEBHOOK_SECRET ?? "").trim();
  if (!secret) {
    sendJson(res, 503, { ok: false, error: "webhook_not_configured" });
    return;
  }
  const header = req.headers["x-telegram-bot-api-secret-token"];
  const presented = (Array.isArray(header) ? header[0] : header ?? "").trim();
  if (!secretsMatch(presented, secret)) {
    sendJson(res, 401, { ok: false, error: "bad_secret" });
    return;
  }

  const update = await readUpdate(req);
  const chat = update.message?.chat?.id;
  if (chat !== undefined) {
    const fromId = update.message?.from?.id;
    try {
      await handleMessage(String(chat), update.message?.text, {
        telegramUserId: fromId === undefined ? undefined : String(fromId),
        chatType: update.message?.chat?.type,
      });
    } catch (err) {
      // One bad message never turns into a retry storm.
      console.warn(JSON.stringify({ msg: "telegram webhook handling failed", err: String(err) }));
    }
  }
  sendJson(res, 200, { ok: true });
}
