import "dotenv/config";
import Fastify from "fastify";
import { registerDashboardRoutes } from "./dashboard.js";
import { webhookRoutes } from "./webhook.js";
import { startWorker } from "./worker.js";

const port = Number(process.env.PORT ?? 3000);

const app = Fastify({ logger: true });

// Keep raw body for HMAC verification (verify.ts) while still parsing JSON.
app.addContentTypeParser(
  "application/json",
  { parseAs: "string" },
  (req, body, done) => {
    try {
      (req as unknown as { rawBody: string }).rawBody =
        typeof body === "string" ? body : "";
      done(null, body ? JSON.parse(body as string) : {});
    } catch (err) {
      done(err as Error, undefined);
    }
  },
);

app.get("/health", async () => ({ ok: true }));
await app.register(webhookRoutes);
await app.register(registerDashboardRoutes);

// In-process worker poller (queue.ts SKIP LOCKED). Single stack, no Redis.
startWorker(app.log);

try {
  await app.listen({ port, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
