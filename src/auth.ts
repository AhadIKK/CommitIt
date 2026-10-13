import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "./db.js";
import {
  buildAuthorizeUrl,
  callbackUrl,
  exchangeCode,
  fetchViewer,
  isSecureCallback,
  parseInstallationEvent,
} from "./githubApp.js";
import {
  fetchAppInstallation,
  recordInstall,
  registerInstallFromSetup,
  removeInstallRepos,
  revokeGithubAuthorization,
  setInstallSuspended,
  syncUserInstalls,
} from "./installations.js";
import { enqueueJob } from "./queue.js";
import { isRateLimited } from "./rateLimit.js";
import {
  SESSION_COOKIE,
  SETUP_COOKIE,
  STATE_COOKIE,
  clearSessionCookieHeader,
  clearSetupCookieHeader,
  createSession,
  genState,
  getSessionUser,
  parseCookies,
  revokeSession,
  sessionCookieHeader,
  sessionCookieValue,
  setupCookieHeader,
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
    const q = req.query as { code?: string; state?: string; installation_id?: string };
    const code = q.code ?? "";
    const state = q.state ?? "";
    const setupId = q.installation_id ?? "";
    const cookies = parseCookies(req.headers.cookie);
    const expectedState = cookies[STATE_COOKIE] ?? "";
    const clearState = `${STATE_COOKIE}=; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=0`;
    const secure = req.protocol === "https";
    // OAuth-during-install landing: stash the install id, bounce through login.
    if (!code && setupId) {
      try {
        const id = BigInt(setupId);
        if (id <= 0) throw new Error("bad id");
        return reply
          .header("Set-Cookie", setupCookieHeader(setupId, secure))
          .code(302)
          .header("Location", "/api/auth/login")
          .send();
      } catch {
        return reply
          .header("Set-Cookie", clearState)
          .code(400)
          .send({ ok: false, error: "invalid_installation" });
      }
    }
    const sessionSecret = process.env.SESSION_SECRET ?? "";
    if (!sessionSecret) {
      return reply
        .header("Set-Cookie", clearState)
        .code(503)
        .send({ ok: false, error: "sessions_not_configured" });
    }
    const completeLogin = async (
      login: string,
      avatarUrl: string | undefined,
      githubId: number,
      setupClaimed: boolean,
    ) => {
      if (!sessionSecret) {
        return reply
          .header("Set-Cookie", clearState)
          .code(503)
          .send({ ok: false, error: "sessions_not_configured" });
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
      // Full install sync (installs owned by this login get rows + backfill).
      await syncUserInstalls(login);
      if (!setupClaimed) {
        const stashed = cookies[SETUP_COOKIE] ?? setupId;
        if (stashed) {
          try {
            const out = await registerInstallFromSetup(BigInt(stashed));
            setupClaimed = out.ok;
          } catch {
            setupClaimed = false;
          }
        }
      }
      let sid: string;
      try {
        sid = await createSession(userRow.id);
      } catch {
        return reply
          .header("Set-Cookie", clearState)
          .code(503)
          .send({ ok: false, error: "unavailable" });
      }
      return reply
        .header("Set-Cookie", [
          sessionCookieHeader(sessionCookieValue(sid, sessionSecret), secure),
          clearState,
          clearSetupCookieHeader(),
        ])
        .code(302)
        .header("Location", setupClaimed ? "/?linked=github&setup_claimed=1" : "/?linked=github")
        .send();
    };
    const stateOk = Boolean(code && state && expectedState && state === expectedState);
    if (!stateOk) {
      // Combined install+authorize landing: accept the code only when its
      // owner matches the installation account; else stash + bounce.
      if (code && setupId) {
        try {
          const viewer = await fetchViewer(await exchangeCode(code));
          const inst = await fetchAppInstallation(BigInt(setupId));
          if (
            inst?.accountLogin &&
            viewer.login.toLowerCase() === inst.accountLogin.toLowerCase()
          ) {
            await completeLogin(viewer.login, viewer.avatarUrl, viewer.id, true);
            return;
          }
        } catch {
          // fall through to stash-and-bounce
        }
        try {
          if (BigInt(setupId) <= 0) throw new Error("bad id");
          return reply
            .header("Set-Cookie", setupCookieHeader(setupId, secure))
            .code(302)
            .header("Location", "/api/auth/login")
            .send();
        } catch {
          return reply
            .header("Set-Cookie", clearState)
            .code(400)
            .send({ ok: false, error: "invalid_installation" });
        }
      }
      return reply
        .header("Set-Cookie", clearState)
        .code(400)
        .send({ ok: false, error: "invalid_state" });
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
    await completeLogin(login, avatarUrl, githubId, false);
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

  app.post("/api/me", async (req, reply) => {
    const q = req.query as { op?: string };
    if (q.op !== "sync") {
      return reply.code(404).send({ ok: false, error: "not_found" });
    }
    if (isRateLimited(`me-sync:${clientIp(req)}`, { max: 5 })) {
      return reply.code(429).send({ ok: false, error: "rate_limited" });
    }
    const session = await getSessionUser(
      parseCookies(req.headers.cookie)[SESSION_COOKIE],
      process.env.SESSION_SECRET ?? "",
    );
    if (!session) {
      return reply.code(401).send({ ok: false, error: "logged_out" });
    }
    const synced = await syncUserInstalls(session.login);
    return reply.send({ ok: true, data: { synced } });
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
    const q = req.query as { repo?: string; installation_id?: string };
    if (q.installation_id) {
      let installationId: bigint;
      try {
        installationId = BigInt(q.installation_id);
        if (installationId <= 0) throw new Error("bad id");
      } catch {
        return reply.code(400).send({ ok: false, error: "invalid_installation" });
      }
      if (isRateLimited(`install-setup:${clientIp(req)}`, { max: 20 })) {
        return reply.code(429).send({ ok: false, error: "rate_limited" });
      }
      const session = await getSessionUser(
        parseCookies(req.headers.cookie)[SESSION_COOKIE],
        process.env.SESSION_SECRET ?? "",
      );
      if (!session) {
        return reply.code(401).send({ ok: false, error: "logged_out" });
      }
      const out = await registerInstallFromSetup(installationId);
      if (!out.ok) {
        const status =
          out.error === "app_not_configured" ? 503 : out.error === "unavailable" ? 503 : 502;
        return reply.code(status).send({ ok: false, error: out.error });
      }
      return reply.send({
        ok: true,
        data: { installationId: installationId.toString(), repos: out.repos },
      });
    }
    const repo = q.repo;
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
      event === "milestone" ||
      event === "repository" ||
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
