/**
 * Tokens and codes, in the house pattern of `services/password-reset.ts`:
 * 32 random bytes, base64url, and only the SHA-256 is stored. The plaintext
 * exists in exactly one response (or one email) and nowhere else.
 */

import { createHash, randomBytes, randomInt, timingSafeEqual } from 'crypto';

export function hashToken(token: string): string {
  return createHash('sha256').update(token.trim()).digest('hex');
}

export function mintToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

/** Crockford-style base32 without 0, O, 1 or I: nothing to misread aloud. */
const REFERENCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** `NE-XXXXXXXX` for NetEnroll; another suite's own prefix (`LLP-...`). */
export function newReference(prefix = 'NE'): string {
  let out = '';
  for (let i = 0; i < 8; i += 1) out += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  return `${prefix}-${out}`;
}

/** A six-digit one-time code. */
export function newOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** Bound to the envelope, so a code hash is meaningless on any other. */
export function hashOtp(envelopeId: string, code: string): string {
  return createHash('sha256').update(`${envelopeId}:${code.trim()}`).digest('hex');
}

/** Constant-time comparison of two hex digests. */
export function digestsEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}
