import crypto from "node:crypto";

// session.ts — stateless HMAC-signed session cookies (no Redis; serverless
// safe). Pure functions: sign/verify only, no I/O. Cookie transport lives
// in the route shells (api/*.ts, src/auth.ts). Never put secrets in payload.

export type SessionPayload = {
  login: string;
  avatarUrl?: string;
  iat: number; // issued-at, unix seconds
  exp: number; // expiry, unix seconds
};

const VERSION = "v1";
export const SESSION_TTL_SEC = 30 * 24 * 3600; // 30 days
export const STATE_TTL_MS = 10 * 60 * 1000; // OAuth state CSRF cookie

function b64urlEncode(data: string | Buffer): string {
  return Buffer.from(data).toString("base64url");
}

function b64urlDecode(s: string): string {
  return Buffer.from(s, "base64url").toString("utf8");
}

function hmac(secret: string, data: string): Buffer {
  return crypto.createHmac("sha256", secret).update(data).digest();
}

/** Random unguessable OAuth `state` (double-submit cookie pattern). */
export function genState(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function signSession(
  input: { login: string; avatarUrl?: string },
  secret: string,
  nowSec = Math.floor(Date.now() / 1000),
): string {
  const payload: SessionPayload = {
    login: input.login,
    ...(input.avatarUrl ? { avatarUrl: input.avatarUrl } : {}),
    iat: nowSec,
    exp: nowSec + SESSION_TTL_SEC,
  };
  const body = b64urlEncode(JSON.stringify(payload));
  const sig = hmac(secret, `${VERSION}.${body}`).toString("base64url");
  return `${VERSION}.${body}.${sig}`;
}

/** Returns the payload on valid signature + unexpired, else null. */
export function verifySession(
  token: string | undefined,
  secret: string,
  nowSec = Math.floor(Date.now() / 1000),
): SessionPayload | null {
  if (!token || !secret) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) return null;
  const [version, body, sig] = parts as [string, string, string];
  const expected = hmac(secret, `${version}.${body}`);
  const actual = Buffer.from(sig, "base64url");
  if (actual.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(actual, expected)) return null;
  let payload: SessionPayload;
  try {
    payload = JSON.parse(b64urlDecode(body)) as SessionPayload;
  } catch {
    return null;
  }
  if (typeof payload.login !== "string" || payload.login.length === 0) return null;
  if (typeof payload.exp !== "number" || nowSec >= payload.exp) return null;
  return payload;
}

/** Minimal `Cookie` header parser (no new deps). First value wins. */
export function parseCookies(header: string | string[] | undefined): Record<string, string> {
  const raw = Array.isArray(header) ? header[0] ?? "" : (header ?? "");
  const out: Record<string, string> = {};
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const name = part.slice(0, idx).trim();
    if (!name || name in out) continue;
    try {
      out[name] = decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      out[name] = part.slice(idx + 1).trim();
    }
  }
  return out;
}

export const SESSION_COOKIE = "commitit_session";
export const STATE_COOKIE = "commitit_oauth_state";

export function sessionCookieHeader(token: string, secure: boolean): string {
  return (
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; ` +
    `Max-Age=${SESSION_TTL_SEC}; ${secure ? "Secure; " : ""}`.trim()
  );
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function stateCookieHeader(state: string, secure: boolean): string {
  return (
    `${STATE_COOKIE}=${encodeURIComponent(state)}; Path=/api/auth; HttpOnly; SameSite=Lax; ` +
    `Max-Age=${STATE_TTL_MS / 1000}; ${secure ? "Secure; " : ""}`.trim()
  );
}
