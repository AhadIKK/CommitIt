import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "./db.js";
import { enqueueJob } from "./queue.js";
import { isRateLimited } from "./rateLimit.js";
import { verifySignature } from "./verify.js";

const PushSchema = z.object({
  ref: z.string().optional(),
  compare: z.string().optional(),
  forced: z.boolean().optional(),
  repository: z.object({ full_name: z.string() }).optional(),
  pusher: z.object({ name: z.string() }).optional(),
  commits: z
    .array(
      z.object({
        id: z.string(),
        message: z.string(),
        author: z
          .object({ username: z.string().optional(), name: z.string().optional() })
          .optional(),
        added: z.array(z.string()).optional(),
        modified: z.array(z.string()).optional(),
      }),
    )
    .optional(),
});

const PullRequestSchema = z.object({
  action: z.string().optional(),
  number: z.number().optional(),
  pull_request: z
    .object({
      number: z.number(),
      title: z.string(),
      state: z.string(),
      merged: z.boolean().optional(),
      merged_at: z.string().nullable().optional(),
      body: z.string().nullable().optional(),
      user: z.object({ login: z.string() }).optional(),
      base: z.object({ ref: z.string() }).optional(),
      head: z.object({ ref: z.string() }).optional(),
    })
    .optional(),
  repository: z.object({ full_name: z.string() }).optional(),
});

const CheckRunSchema = z.object({
  action: z.string().optional(),
  check_run: z.object({
    id: z.number().optional(),
    name: z.string(),
    head_sha: z.string(),
    status: z.string().optional(),
    conclusion: z.string().nullable().optional(),
    html_url: z.string().optional(),
    check_suite: z.object({ head_branch: z.string().optional() }).optional(),
  }),
  repository: z.object({ full_name: z.string() }).optional(),
});

const IssuesSchema = z.object({
  action: z.string().optional(),
  issue: z
    .object({
      number: z.number(),
      title: z.string(),
      state: z.string(),
    })
    .optional(),
  repository: z.object({ full_name: z.string() }).optional(),
});

export const MilestoneSchema = z.object({
  action: z.string().optional(),
  milestone: z
    .object({
      number: z.number(),
      title: z.string(),
      state: z.string().optional(),
    })
    .optional(),
  repository: z.object({ full_name: z.string() }).optional(),
});

// Process-local fast path for duplicate deliveries. The DB upsert on
// events.delivery_id remains the source of truth across instances;
// this set just avoids re-enqueueing within one process.
const seenDeliveries = new Set<string>();
const MAX_SEEN = 10_000;

export function clearSeenDeliveries(): void {
  seenDeliveries.clear();
}

function markSeen(delivery: string): void {
  seenDeliveries.add(delivery);
  if (seenDeliveries.size > MAX_SEEN) {
    const oldest = seenDeliveries.values().next().value;
    if (oldest !== undefined) seenDeliveries.delete(oldest);
  }
}

export async function webhookRoutes(app: FastifyInstance) {
  app.post("/webhook", async (req, reply) => {
    const ip = req.ip ?? req.headers["x-forwarded-for"]?.toString() ?? "unknown";
    if (isRateLimited(`webhook:${ip}`)) {
      return reply.code(429).send({ ok: false, error: "rate_limited" });
    }

    const delivery = req.headers["x-github-delivery"]?.toString();
    const event = req.headers["x-github-event"]?.toString() ?? "unknown";
    const signature = req.headers["x-hub-signature-256"];
    const rawBody =
      (req as unknown as { rawBody?: string }).rawBody ??
      JSON.stringify(req.body ?? {});
    const secret = process.env.GITHUB_WEBHOOK_SECRET ?? "";

    if (secret) {
      if (!verifySignature(rawBody, signature as string | undefined, secret)) {
        req.log.warn({ delivery, event }, "webhook rejected: bad signature");
        return reply.code(401).send({ ok: false, error: "bad_signature" });
      }
    } else {
      req.log.warn("GITHUB_WEBHOOK_SECRET not set — skipping verify (dev only)");
    }

    if (!delivery) {
      return reply.code(400).send({ ok: false, error: "missing_delivery_id" });
    }

    const parsed =
      event === "pull_request"
        ? PullRequestSchema.safeParse(req.body ?? {})
        : event === "check_run"
          ? CheckRunSchema.safeParse(req.body ?? {})
          : event === "issues"
            ? IssuesSchema.safeParse(req.body ?? {})
            : event === "milestone"
              ? MilestoneSchema.safeParse(req.body ?? {})
              : PushSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      req.log.warn({ delivery, event }, "webhook rejected: invalid payload");
      return reply.code(400).send({ ok: false, error: "invalid_payload" });
    }

    if (seenDeliveries.has(delivery)) {
      return reply.send({ ok: true, deduped: true });
    }

    // Idempotency: events.delivery_id UNIQUE, insert-or-skip before processing.
    // Same key seeds jobs.delivery_id via enqueueJob().
    try {
      await prisma.event.upsert({
        where: { deliveryId: delivery },
        update: {},
        create: { deliveryId: delivery, type: event },
      });
    } catch (err) {
      req.log.warn({ delivery, err }, "event store unavailable, continuing");
    }

    try {
      await enqueueJob(event === "push" ? "push" : event, delivery, req.body);
      markSeen(delivery);
    } catch (err) {
      req.log.error({ delivery, err }, "enqueue failed");
      return reply.code(500).send({ ok: false, error: "enqueue_failed" });
    }

    req.log.info({ delivery, event }, "webhook accepted");
    return reply.send({ ok: true });
  });
}
