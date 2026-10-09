import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "./db.js";
import {
  buildAuthorizeUrl,
  callbackUrl,
  claimUserRepos,
  exchangeCode,
  fetchViewer,
  isSecureCallback,
  parseInstallationEvent,
} from "./githubApp.js";
import {
  recordInstall,
  removeInstallRepos,
  revokeGithubAuthorization,
  setInstallSuspended,
} from "./installations.js";
import { enqueueJob } from "./queue.js";
import { isRateLimited } from "./rateLimit.js";
import {
  SESSION_COOKIE,
  STATE_COOKIE,
  clearSessionCookieHeader,
  createSession,
  genState,
  getSessionUser,
  parseCookies,
  revokeSession,
  sessionCookieHeader,
  sessionCookieValue,
  stateCookieHeader,
} from "./session.js";
import { verifySignature } from "./verify.js";

// auth.ts — Fastify mirrors of the Vercel auth/install endpoints
// (api/auth/*, api/me, api/meta, api/repo, api/github-app.ts) for local dev.
// Same semantics; thin shells over src/session.ts + src/githubApp.ts.

function clientIp(req: { ip?: string; headers: Record<string, unknown> }): string {
  return req.ip ?? req.headers["x-forwarded-for"]?.toString() ?? "unknown";
}

function reqHeaders(req: {
  headers: Record<string, string | string[] | undefined>;
}): Record<string, string | string[] | undefined> {
  return req.headers;
}

export async function registerAuthRoutes(app: FastifyInstance) {
  const startLogin = async (req: FastifyRequest, reply: FastifyReply) => {
    if (isRateLimited(`oauth:${clientIp(req)}`, { max: 20 })) {
      return reply.code(429).send({ ok: false, error: "rate_limited" });
    }
    const clientId = (process.env.GITHUB_CLIENT_ID ?? "").trim();
    if (!clientId) {
      return reply.code(503).send({ ok: false, error: "oauth_not_configured" });
    }
    const redirectUri = callbackUrl(reqHeaders(req));
    const state = genState();
    const secure = isSecureCallback(redirectUri);
    return reply
      .header("Set-Cookie", stateCookieHeader(state, secure))
      .code(302)
      .header("Location", buildAuthorizeUrl({ clientId, redirectUri, state }))
      .send();
  };
  app.get("/api/auth/login", startLogin);
  app.get("/api/auth/github", startLogin); // legacy alias

  app.get("/api/auth/callback", async (req, reply) => {
    if (isRateLimited(`oauth:${clientIp(req)}`, { max: 20 })) {
      return reply.code(429).send({ ok: false, error: "rate_limited" });
    }
    const q = req.query as { code?: string; state?: string };
    const code = q.code ?? "";
    const state = q.state ?? "";
    const cookies = parseCookies(req.headers.cookie);
    const expectedState = cookies[STATE_COOKIE] ?? "";
    const clearState = `${STATE_COOKIE}=; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=0`;
    if (!code || !state || !expectedState || state !== expectedState) {
      return reply
        .header("Set-Cookie", clearState)
        .code(400)
        .send({ ok: false, error: "invalid_state" });
    }
    const sessionSecret = process.env.SESSION_SECRET ?? "";
    if (!sessionSecret) {
      return reply
        .header("Set-Cookie", clearState)
        .code(503)
        .send({ ok: false, error: "sessions_not_configured" });
    }
    let login = "";
    let avatarUrl: string | undefined;
    let githubId = 0;
    try {
      const token = await exchangeCode(code);
      const viewer = await fetchViewer(token);
      login = viewer.login;
      avatarUrl = viewer.avatarUrl;
      githubId = viewer.id;
    } catch {
      return reply
        .header("Set-Cookie", clearState)
        .code(502)
        .send({ ok: false, error: "oauth_failed" });
    }
    let userRow: { id: string };
    try {
      userRow = await prisma.user.upsert({
        where: { githubLogin: login },
        update: { githubUserId: BigInt(githubId), avatarUrl: avatarUrl ?? null },
        create: {
          githubLogin: login,
          githubUserId: BigInt(githubId),
          avatarUrl: avatarUrl ?? null,
        },
      });
    } catch {
      return reply
        .header("Set-Cookie", clearState)
        .code(503)
        .send({ ok: false, error: "unavailable" });
    }
    // Claim installs belonging to this login (installed before first login).
    // Best-effort: never blocks the login redirect.
    await claimUserRepos(prisma, login);
    // Server-side session: only the id hash hits the DB (Phase C).
    let sid: string;
    try {
      sid = await createSession(userRow.id);
    } catch {
      return reply
        .header("Set-Cookie", clearState)
        .code(503)
        .send({ ok: false, error: "unavailable" });
    }
    const secure = req.protocol === "https";
    return reply
      .header("Set-Cookie", [
        sessionCookieHeader(sessionCookieValue(sid, sessionSecret), secure),
        clearState,
      ])
      .code(302)
      .header("Location", "/?linked=github")
      .send();
  });

  app.post("/api/auth/logout", async (req, reply) => {
    await revokeSession(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
    return reply.header("Set-Cookie", clearSessionCookieHeader()).send({ ok: true });
  });

  app.get("/api/me", async (req, reply) => {
    const session = await getSessionUser(
      parseCookies(req.headers.cookie)[SESSION_COOKIE],
      process.env.SESSION_SECRET ?? "",
    );
    if (!session) {
      return reply.code(401).send({ ok: false, error: "logged_out" });
    }
    let repos: string[] = [];
    try {
      const rows = await prisma.repo.findMany({
        where: { ownerUserId: session.id },
        select: { fullName: true },
      });
      repos = rows.map((r) => r.fullName);
    } catch {
      repos = [];
    }
    return reply.send({
      ok: true,
      data: { login: session.login, avatarUrl: session.avatarUrl, repos },
    });
  });

  app.get("/api/meta", async (_req, reply) => {
    const slug = (process.env.GITHUB_APP_SLUG ?? "").trim();
    return reply.send({
      ok: true,
      data: {
        appSlug: slug || null,
        installUrl: slug ? `https://github.com/apps/${slug}/installations/new` : null,
        authEnabled: Boolean((process.env.GITHUB_CLIENT_ID ?? "").trim()),
        appConfigured: Boolean(
          (process.env.GITHUB_APP_ID ?? "").trim() &&
            (process.env.GITHUB_APP_PRIVATE_KEY_BASE64 ?? "").trim() &&
            (process.env.GITHUB_APP_WEBHOOK_SECRET ?? "").trim(),
        ),
      },
    });
  });

  app.get("/api/repo", async (req, reply) => {
    const repo = (req.query as { repo?: string }).repo;
    if (!repo) return reply.code(400).send({ ok: false, error: "missing_repo" });
    let installed = false;
    try {
      const row = await prisma.repo.findUnique({
        where: { fullName: repo },
        select: { installationId: true },
      });
      installed = row?.installationId != null;
    } catch {
      installed = false;
    }
    return reply.send({ ok: true, data: { fullName: repo, installed } });
  });

  app.post("/api/github-app", async (req, reply) => {
    if (isRateLimited(`github-app:${clientIp(req)}`)) {
      return reply.code(429).send({ ok: false, error: "rate_limited" });
    }
    const delivery = req.headers["x-github-delivery"]?.toString();
    const event = req.headers["x-github-event"]?.toString();
    const signature = req.headers["x-hub-signature-256"];
    const rawBody =
      (req as unknown as { rawBody?: string }).rawBody ??
      JSON.stringify(req.body ?? {});
    const secret = process.env.GITHUB_APP_WEBHOOK_SECRET ?? "";
    if (secret) {
      if (!verifySignature(rawBody, signature as string | undefined, secret)) {
        req.log.warn({ delivery, event }, "app webhook rejected: bad signature");
        return reply.code(401).send({ ok: false, error: "bad_signature" });
      }
    } else {
      req.log.warn("GITHUB_APP_WEBHOOK_SECRET not set — skipping verify (dev only)");
    }
    if (!delivery) {
      return reply.code(400).send({ ok: false, error: "missing_delivery_id" });
    }

    if (event === "installation" || event === "installation_repositories") {
      const change = parseInstallationEvent(req.body ?? {});
      if (!change) return reply.send({ ok: true, ignored: true });
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
        return reply.code(503).send({ ok: false, error: "unavailable" });
      }
      try {
        await prisma.event.upsert({
          where: { deliveryId: delivery },
          update: {},
          create: { deliveryId: delivery, type: event },
        });
      } catch (err) {
        req.log.warn({ delivery, err }, "event store unavailable, continuing");
      }
      return reply.send({ ok: true });
    }

    if (event === "github_app_authorization") {
      await revokeGithubAuthorization(req.body ?? {});
      try {
        await prisma.event.upsert({
          where: { deliveryId: delivery },
          update: {},
          create: { deliveryId: delivery, type: event },
        });
      } catch (err) {
        req.log.warn({ delivery, err }, "event store unavailable, continuing");
      }
      return reply.send({ ok: true });
    }

    if (
      event === "push" ||
      event === "issues" ||
      event === "pull_request" ||
      event === "check_run"
    ) {
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
        await enqueueJob(event, delivery, req.body);
      } catch (err) {
        req.log.error({ delivery, err }, "enqueue failed");
        return reply.code(500).send({ ok: false, error: "enqueue_failed" });
      }
      return reply.send({ ok: true });
    }

    return reply.send({ ok: true, ignored: true });
  });
}
