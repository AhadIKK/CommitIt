import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { isRateLimited } from "../src/rateLimit.js";
import { verifySignature } from "../src/verify.js";

const PushSchema = z.object({
  ref: z.string().optional(),
  repository: z.object({ full_name: z.string() }).optional(),
  commits: z.array(z.object({ id: z.string(), message: z.string() })).optional(),
});

/**
 * POST /api/webhook — Vercel serverless GitHub webhook endpoint.
 * Mirrors `POST /webhook` in `src/webhook.ts` (used by Render/local):
 * same rate-limit (429) and HMAC-verify (401) semantics.
 *
 * NOTE: reads the raw request stream (no framework body parser) so the
 * `X-Hub-Signature-256` HMAC check runs against the exact bytes GitHub sent.
 */
function readRawBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }

  const forwarded = req.headers["x-forwarded-for"];
  const ip =
    (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0]?.trim()) ||
    req.socket?.remoteAddress ||
    "unknown";
  if (isRateLimited(`webhook:${ip}`)) {
    sendJson(res, 429, { ok: false, error: "rate_limited" });
    return;
  }

  const delivery = req.headers["x-github-delivery"];
  const event = req.headers["x-github-event"];
  const signature = req.headers["x-hub-signature-256"];
  const rawBody = await readRawBody(req);
  const secret = process.env.GITHUB_WEBHOOK_SECRET ?? "";

  if (secret) {
    const sig = Array.isArray(signature) ? signature[0] : signature;
    if (!verifySignature(rawBody, sig, secret)) {
      console.warn(
        JSON.stringify({ delivery, event, msg: "webhook rejected: bad signature" }),
      );
      sendJson(res, 401, { ok: false, error: "bad_signature" });
      return;
    }
  } else {
    console.warn(
      JSON.stringify({
        msg: "GITHUB_WEBHOOK_SECRET not set — skipping verify (dev only)",
      }),
    );
  }

  let parsed: unknown = null;
  try {
    parsed = rawBody.length > 0 ? JSON.parse(rawBody.toString("utf8")) : {};
  } catch {
    sendJson(res, 400, { ok: false, error: "invalid_json" });
    return;
  }

  if (!delivery) {
    sendJson(res, 400, { ok: false, error: "missing_delivery_id" });
    return;
  }

  // Light validation mirrors src/webhook.ts; storage/queue run in src path.
  if (event === "push" && !PushSchema.safeParse(parsed).success) {
    sendJson(res, 400, { ok: false, error: "invalid_payload" });
    return;
  }

  console.log(
    JSON.stringify({
      delivery,
      event,
      hasSignature: Boolean(signature),
      body: parsed,
      msg: "webhook received",
    }),
  );

  sendJson(res, 200, { ok: true });
}
