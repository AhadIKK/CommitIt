import crypto from "node:crypto";
import { prisma } from "./db.js";

// session.ts — session cookies + server-side session records (Phase C).
// Cookie carries only a random session id, HMAC-signed (same format family
// as before: v1.<hex>.<hmac>). The DB stores ONLY the SHA-256 hash, so a
// leak of either side alone is useless — and revocation actually works
// (github_app_authorization, logout). Never log ids, hashes, or cookies.

export type SessionUser = { id: string; login: string; avatarUrl: string | null };

const VERSION = "v1";
export const SESSION_TTL_SEC = 30 * 24 * 3600; // 30 days
export const STATE_TTL_MS = 10 * 60 * 1000; // OAuth state CSRF cookie

function hmac(secret: string, data: string): Buffer {
  return crypto.createHmac("sha256", secret).update(data).digest();
}

/** Random unguessable OAuth `state` (double-submit cookie pattern). */
export function genState(): string {
  return crypto.randomBytes(16).toString("hex");
}

/** Random 32-byte session id (hex). Only its hash is ever stored. */
export function genSessionId(): string {
  return crypto.randomBytes(32).toString("hex");
}

/** SHA-256 hex of a token. Constant-time compare via safeEqual(). */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

/** Constant-time string comparison (signatures, hashes). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** Cookie value for a session id: v1.<sid>.<hmac(sid)>. */
export function sessionCookieValue(sessionId: string, secret: string): string {
  const sig = hmac(secret, `${VERSION}.${sessionId}`).toString("base64url");
  return `${VERSION}.${sessionId}.${sig}`;
}

/** Verify cookie HMAC and extract the session id (no DB touch). */
export function parseSessionCookie(
  token: string | undefined,
  secret: string,
): string | null {
  if (!token || !secret) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) return null;
  const [version, sid, sig] = parts as [string, string, string];
  if (!/^[0-9a-f]{64}$/.test(sid)) return null;
  const expected = hmac(secret, `${version}.${sid}`);
  const actual = Buffer.from(sig, "base64url");
  if (actual.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(actual, expected)) return null;
  return sid;
}

/** Create a server-side session row; returns the raw id for the cookie. */
export async function createSession(
  userId: string,
  ttlSec: number = SESSION_TTL_SEC,
  nowMs: number = Date.now(),
): Promise<string> {
  const sid = genSessionId();
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(sid),
      expiresAt: new Date(nowMs + ttlSec * 1000),
    },
  });
  return sid;
}

/** Resolve a cookie value to its user (HMAC + live DB row). Null = logged out. */
export async function getSessionUser(
  cookieValue: string | undefined,
  secret: string,
  nowMs: number = Date.now(),
): Promise<SessionUser | null> {
  const sid = parseSessionCookie(cookieValue, secret);
  if (!sid) return null;
  try {
    const row = await prisma.session.findUnique({
      where: { tokenHash: hashToken(sid) },
      include: { user: { select: { id: true, githubLogin: true, avatarUrl: true } } },
    });
    if (!row || row.revokedAt || row.expiresAt.getTime() <= nowMs) return null;
    if (!row.user.githubLogin) return null;
    return { id: row.user.id, login: row.user.githubLogin, avatarUrl: row.user.avatarUrl };
  } catch {
    return null;
  }
}

/** Revoke one session by cookie value. Never throws. */
export async function revokeSession(cookieValue: string | undefined): Promise<void> {
  if (!cookieValue) return;
  // Hash without verifying: logout must work even on malformed cookies.
  const sid = cookieValue.split(".")[1] ?? "";
  if (!/^[0-9a-f]{64}$/.test(sid)) return;
  try {
    await prisma.session.updateMany({
      where: { tokenHash: hashToken(sid), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  } catch {
    // logout is best-effort; the cookie is cleared regardless
  }
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
