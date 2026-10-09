import type { IncomingMessage, ServerResponse } from "node:http";
import { prisma } from "../src/db.js";
import { SESSION_COOKIE, parseCookies, verifySession } from "../src/session.js";

// GET /api/me — current linked GitHub account from the session cookie,
// plus repos owned by this account. 401 when logged out.
export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if ((req.method ?? "GET") !== "GET") {
    res.statusCode = 405;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
    return;
  }
  const session = verifySession(
    parseCookies(req.headers.cookie)[SESSION_COOKIE],
    process.env.SESSION_SECRET ?? "",
  );
  if (!session) {
    res.statusCode = 401;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: false, error: "logged_out" }));
    return;
  }
  let repos: string[] = [];
  try {
    const user = await prisma.user.findUnique({ where: { githubLogin: session.login } });
    if (user) {
      const rows = await prisma.repo.findMany({
        where: { ownerUserId: user.id },
        select: { fullName: true },
      });
      repos = rows.map((r) => r.fullName);
    }
  } catch {
    repos = [];
  }
  res.statusCode = 200;
  res.setHeader("content-type", "application/json");
  res.end(
    JSON.stringify({
      ok: true,
      data: { login: session.login, avatarUrl: session.avatarUrl ?? null, repos },
    }),
  );
}
