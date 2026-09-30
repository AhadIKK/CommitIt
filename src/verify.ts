import crypto from "node:crypto";

/**
 * Verify GitHub HMAC `X-Hub-Signature-256` against the raw request body.
 * Pure function — no I/O, safe to unit test.
 */
export function verifySignature(
  rawBody: string | Buffer,
  signatureHeader: string | string[] | undefined,
  secret: string,
): boolean {
  if (!signatureHeader || !secret) return false;
  const signature = Array.isArray(signatureHeader)
    ? signatureHeader[0]
    : signatureHeader;
  if (typeof signature !== "string" || !signature.startsWith("sha256=")) {
    return false;
  }
  const expected = `sha256=${crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function signPayload(rawBody: string | Buffer, secret: string): string {
  return `sha256=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}
