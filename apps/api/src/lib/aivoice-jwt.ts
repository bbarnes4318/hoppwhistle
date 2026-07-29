import { createHmac } from 'crypto';

/**
 * Mint a Dograh (AI Voice) OSS JWT so a Hopwhistle-authenticated user can be
 * transparently signed into the embedded AI Voice app (aivoice.hopwhistle.com).
 *
 * Must match what Dograh's backend expects (api/utils/auth.py `create_jwt_token`):
 *   payload = { sub: str(user_id), email, iat, exp }, HS256, secret = OSS_JWT_SECRET.
 *
 * We sign with the Node crypto HMAC primitive to avoid introducing a second JWT
 * library (the app already uses @fastify/jwt for its own tokens with a different
 * secret; this token deliberately uses Dograh's secret instead).
 */
function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

export interface DograhTokenClaims {
  /** Dograh user id (stringified) → JWT `sub`. */
  userId: string;
  /** Dograh user email. */
  email: string;
}

export function signDograhToken(
  claims: DograhTokenClaims,
  secret: string,
  expiresInHours = 24
): string {
  if (!secret) {
    throw new Error('AIVOICE_JWT_SECRET is not configured');
  }
  const header = { alg: 'HS256', typ: 'JWT' };
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload = {
    sub: String(claims.userId),
    email: claims.email,
    iat: nowSeconds,
    exp: nowSeconds + expiresInHours * 3600,
  };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signature = createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}
