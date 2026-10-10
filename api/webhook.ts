import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { prisma } from "../src/db.js";
import { isRateLimited } from "../src/rateLimit.js";
import { verifySignature } from "../src/verify.js";

const PushSchema = z.object({
  ref: z.string().optional(),
  repository: z.object({ full_name: z.string() }).optional(),
  commits: z
    .array(
      z.object({
        id: z.string(),
        message: z.string(),
        timestamp: z.string().optional(),
        author: z
          .object({ username: z.string().optional(), name: z.string().optional() })
          .optional(),
      }),
    )
    .optional(),
});

const PullRequestSchema = z.object({
  action: z.string().optional(),
  pull_request: z
    .object({ number: z.number(), title: z.string(), state: z.string() })
    .optional(),
  repository: z.object({ full_name: z.string() }).optional(),
});

const CheckRunSchema = z.object({
  action: z.string().optional(),
  check_run: z
    .object({ name: z.string(), head_sha: z.string() })
    .optional(),
  repository: z.object({ full_name: z.string() }).optional(),
});

const MilestoneSchema = z.object({
  action: z.string().optional(),
  milestone: z.object({ number: z.number(), title: z.string() }).optional(),
  repository: z.object({ full_name: z.string() }).optional(),
});

const RepositorySchema = z.object({
  action: z.string().optional(),
  repository: z.object({ full_name: z.string() }).optional(),
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

/**
 * Direct push ingest for serverless (no worker on Vercel). Upserts the repo,
 * authors, and commits with raw metadata only — no AI, no linking (the
 * long-lived worker enriches via jobs when it runs). Idempotent on
 * (repoId, sha), so redeliveries are safe.
 */
export async function storePushCommits(push: z.infer<typeof PushSchema>): Promise<number> {
  const fullName = push.repository?.full_name;
  if (!fullName) return 0;
  const branch = (push.ref ?? "").replace("refs/heads/", "") || null;
  const repoRow = await prisma.repo.upsert({
    where: { fullName },
    update: {},
    create: { fullName },
  });
  let stored = 0;
  for (const c of push.commits ?? []) {
    const login = c.author?.username ?? c.author?.name ?? null;
    let authorId: string | null = null;
    if (login) {
      const author = await prisma.author.upsert({
        where: { githubLogin: login },
        update: {},
        create: { githubLogin: login },
      });
      authorId = author.id;
    }
    let committedAt: Date | null = null;
    if (c.timestamp) {
      const parsed = new Date(c.timestamp);
      if (!Number.isNaN(parsed.getTime())) committedAt = parsed;
    }
    await prisma.commit.upsert({
      where: { repoId_sha: { repoId: repoRow.id, sha: c.id } },
      update: {},
      create: {
        sha: c.id,
        repoId: repoRow.id,
        authorId,
        message: c.message.slice(0, 2000),
        branch,
        committedAt,
      },
    });
    stored += 1;
  }
  return stored;
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
  const schema =
    event === "pull_request"
      ? PullRequestSchema
      : event === "check_run"
        ? CheckRunSchema
        : event === "push"
          ? PushSchema
          : event === "milestone"
            ? MilestoneSchema
            : event === "repository"
              ? RepositorySchema
              : null;
  if (schema) {
    const checked = schema.safeParse(parsed);
    if (!checked.success) {
      sendJson(res, 400, { ok: false, error: "invalid_payload" });
      return;
    }
    // Serverless ingest: Vercel never runs the worker poller, so push
    // commits are stored directly (best-effort — a DB failure still acks
    // 200; the long-lived path reprocesses via jobs). Never 500s.
    if (event === "push") {
      try {
        await storePushCommits(checked.data as z.infer<typeof PushSchema>);
      } catch (err) {
        console.warn(JSON.stringify({ delivery, msg: "push ingest failed", err: String(err) }));
      }
    }
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
