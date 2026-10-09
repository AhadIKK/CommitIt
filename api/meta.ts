import type { IncomingMessage, ServerResponse } from "node:http";

// GET /api/meta — public integration config (no secrets): GitHub App install
// URL + which flows are configured. Dashboard degrades when unset.
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
  const slug = (process.env.GITHUB_APP_SLUG ?? "").trim();
  const data = {
    appSlug: slug || null,
    installUrl: slug ? `https://github.com/apps/${slug}/installations/new` : null,
    authEnabled: Boolean((process.env.GITHUB_CLIENT_ID ?? "").trim()),
    appConfigured: Boolean(
      (process.env.GITHUB_APP_ID ?? "").trim() &&
        (process.env.GITHUB_APP_PRIVATE_KEY_BASE64 ?? "").trim() &&
        (process.env.GITHUB_APP_WEBHOOK_SECRET ?? "").trim(),
    ),
  };
  res.statusCode = 200;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ ok: true, data }));
}
