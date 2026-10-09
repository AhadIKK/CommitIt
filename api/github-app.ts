import type { IncomingMessage, ServerResponse } from "node:http";
import { prisma } from "../src/db.js";
import { parseInstallationEvent } from "../src/githubApp.js";
import {
  recordInstall,
  removeInstallRepos,
  revokeGithubAuthorization,
  setInstallSuspended,
} from "../src/installations.js";
import { enqueueJob } from "../src/queue.js";
import { isRateLimited } from "../src/rateLimit.js";
import { verifySignature } from "../src/verify.js";

// POST /api/github-app — GitHub App webhook receiver (replaces manual repo
// webhooks once the App is installed). Same hard rules as /api/webhook:
// HMAC-verify (401), rate-limit (429), delivery idempotency via
// events.delivery_id, all code-event enqueueing via enqueueJob().
// - installation / installation_repositories → route installs to Repo rows
// - push / issues / pull_request / check_run → same pipeline as webhooks
// - anything else → 200 ignored
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
  if (isRateLimited(`github-app:${ip}`)) {
    sendJson(res, 429, { ok: false, error: "rate_limited" });
    return;
  }

  const delivery = (
    Array.isArray(req.headers["x-github-delivery"])
      ? req.headers["x-github-delivery"][0]
      : req.headers["x-github-delivery"]
  )?.toString();
  const event = (
    Array.isArray(req.headers["x-github-event"])
      ? req.headers["x-github-event"][0]
      : req.headers["x-github-event"]
  )?.toString();
  const signature = req.headers["x-hub-signature-256"];
  const rawBody = await readRawBody(req);
  const secret = process.env.GITHUB_APP_WEBHOOK_SECRET ?? "";

  if (secret) {
    const sig = Array.isArray(signature) ? signature[0] : signature;
    if (!verifySignature(rawBody, sig, secret)) {
      sendJson(res, 401, { ok: false, error: "bad_signature" });
      return;
    }
  } else {
    console.warn(
      JSON.stringify({ msg: "GITHUB_APP_WEBHOOK_SECRET not set — skipping verify (dev only)" }),
    );
  }

  let body: unknown = null;
  try {
    body = rawBody.length > 0 ? JSON.parse(rawBody.toString("utf8")) : {};
  } catch {
    sendJson(res, 400, { ok: false, error: "invalid_json" });
    return;
  }
  if (!delivery) {
    sendJson(res, 400, { ok: false, error: "missing_delivery_id" });
    return;
  }

  // Install lifecycle: applied directly (drives project profiles).
  if (event === "installation" || event === "installation_repositories") {
    const change = parseInstallationEvent(body);
    if (!change) {
      sendJson(res, 200, { ok: true, ignored: true });
      return;
    }
    try {
      if (change.kind === "installed") {
        await recordInstall(change);
      } else if (change.kind === "removed") {
        await removeInstallRepos(change);
      } else if (change.kind === "suspended") {
        await setInstallSuspended(change.installationId, true);
      } else {
        await setInstallSuspended(change.installationId, false);
      }
    } catch {
      sendJson(res, 503, { ok: false, error: "unavailable" });
      return;
    }
    try {
      await prisma.event.upsert({
        where: { deliveryId: delivery },
        update: {},
        create: { deliveryId: delivery, type: event ?? "installation" },
      });
    } catch {
      // idempotency store down: install already applied above, still ack
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  // Authorization revoked: kill that GitHub user's sessions immediately.
  if (event === "github_app_authorization") {
    await revokeGithubAuthorization(body);
    try {
      await prisma.event.upsert({
        where: { deliveryId: delivery },
        update: {},
        create: { deliveryId: delivery, type: event },
      });
    } catch {
      // idempotency store down: revocation already applied, still ack
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  // Code events: same pipeline as manual webhooks (AGENTS.md rules 2+3).
  if (event === "push" || event === "issues" || event === "pull_request" || event === "check_run") {
    try {
      await prisma.event.upsert({
        where: { deliveryId: delivery },
        update: {},
        create: { deliveryId: delivery, type: event },
      });
    } catch {
      // event store unavailable: enqueueJob upserts jobs.delivery_id anyway
    }
    try {
      await enqueueJob(event, delivery, body);
    } catch {
      sendJson(res, 500, { ok: false, error: "enqueue_failed" });
      return;
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 200, { ok: true, ignored: true });
}
