import crypto from "node:crypto";
import { prisma } from "./db.js";
import { hashToken, safeEqual } from "./session.js";

// linkTokens.ts — Phase D Telegram deep-link tokens (hash-only, spec).
// - Token: 32 random bytes (64 hex, fits t.me ?start= which caps at 64).
// - Stored: SHA-256 hex only, 10-min expiry, single-use.
// - The legacy /link 6-letter codes stay on TelegramLink (rate-limited,
//   short-lived); this table serves the deep-link flow only.

export const LINK_TOKEN_TTL_MS = 10 * 60 * 1000;
export const TOKEN_RE = /^[0-9a-f]{32}$|^[0-9a-f]{64}$/; // legacy 16B + new 32B
export const PURPOSE_TELEGRAM_LINK = "telegram_link";

export function genLinkToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function linkTokenExpiry(now: number = Date.now()): Date {
  return new Date(now + LINK_TOKEN_TTL_MS);
}

/** Mint a deep-link token. Returns the raw token (shown once); stores hash. */
export async function createLinkToken(repoFullName: string): Promise<{ token: string } | null> {
  const token = genLinkToken();
  try {
    await prisma.linkToken.create({
      data: {
        tokenHash: hashToken(token),
        purpose: PURPOSE_TELEGRAM_LINK,
        repoFullName,
        expiresAt: linkTokenExpiry(),
      },
    });
    return { token };
  } catch {
    return null;
  }
}

export type ClaimResult =
  | { status: "linked"; repoFullName: string | null }
  | { status: "invalid" }
  | { status: "error" };

/**
 * Claim a deep-link token for a chat. Hash recomputed + constant-time
 * re-compared after lookup; expiry + single-use enforced.
 */
export async function claimLinkToken(token: string, chatId: string): Promise<ClaimResult> {
  const clean = token.trim().toLowerCase();
  if (!TOKEN_RE.test(clean)) return { status: "invalid" };
  try {
    const row = await prisma.linkToken.findUnique({ where: { tokenHash: hashToken(clean) } });
    if (
      !row ||
      row.purpose !== PURPOSE_TELEGRAM_LINK ||
      !safeEqual(row.tokenHash, hashToken(clean)) ||
      row.usedAt ||
      row.expiresAt < new Date()
    ) {
      return { status: "invalid" };
    }
    await prisma.linkToken.update({
      where: { tokenHash: row.tokenHash },
      data: { chatId, usedAt: new Date() },
    });
    return { status: "linked", repoFullName: row.repoFullName };
  } catch {
    return { status: "error" };
  }
}

/** Has this token been claimed (website polling)? False on any failure. */
export async function isTokenClaimed(token: string): Promise<boolean> {
  const clean = token.trim().toLowerCase();
  if (!TOKEN_RE.test(clean)) return false;
  try {
    const row = await prisma.linkToken.findUnique({ where: { tokenHash: hashToken(clean) } });
    return row?.usedAt != null;
  } catch {
    return false;
  }
}
