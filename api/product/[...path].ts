import type { IncomingMessage, ServerResponse } from "node:http";
import { parseCookies } from "../../src/session.js";
import { handleWorkspace, workspacePath } from "../../src/workspaceRoutes.js";

// api/product/[...path].ts — the whole signed-in API in ONE serverless
// function (Vercel Hobby caps at 12 per deployment). vercel.json rewrites
// /api/repos/*, /api/me, /api/auth/github/*, /api/link/telegram* and
// /api/onboarding/mode here, so the paths the client calls stay short.
//
// The rules live in src/workspaceRoutes.ts, shared with the Fastify host used
// for local dev. This file only adapts Node's request/response.

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

function ipOf(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  return (
    (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0]?.trim()) ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const method = (req.method ?? "GET").toUpperCase();
  const hasBody = method === "POST" || method === "PUT" || method === "PATCH";

  const out = await handleWorkspace({
    method,
    // `/api/product/repos/x/today` and `/api/repos/x/today` both normalise to
    // `/repos/x/today`, so this works whether or not the rewrite is visible.
    path: workspacePath(url.pathname),
    query: url.searchParams,
    body: hasBody ? await readBody(req) : {},
    cookies: parseCookies(req.headers.cookie),
    ip: ipOf(req),
  });

  if (!out) {
    res.statusCode = 404;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: false, error: "not_found" }));
    return;
  }

  res.statusCode = out.status;
  for (const [key, value] of Object.entries(out.headers ?? {})) res.setHeader(key, value);
  if (out.status === 204) {
    res.end();
    return;
  }
  res.setHeader("content-type", "application/json");
  // Never cache account data in a shared cache.
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(out.body ?? null));
}
