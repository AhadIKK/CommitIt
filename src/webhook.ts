import type { FastifyInstance } from "fastify";

// Phase 0: log raw webhook payload, return 200. No verification/storage yet (Phase 1).
export async function webhookRoutes(app: FastifyInstance) {
  app.post("/webhook", async (req, reply) => {
    const delivery = req.headers["x-github-delivery"];
    const event = req.headers["x-github-event"];
    const signature = req.headers["x-hub-signature-256"];

    req.log.info(
      {
        delivery,
        event,
        hasSignature: Boolean(signature),
        body: req.body,
      },
      "webhook received (phase 0: logged only)",
    );

    return reply.send({ ok: true });
  });
}
