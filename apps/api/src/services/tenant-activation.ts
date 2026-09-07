/**
 * Activation grants: how a new account learns which tenant it belongs to.
 *
 * ── The rule ─────────────────────────────────────────────────────────────────
 *
 * A registering browser never names a tenant, and nothing here reads a
 * hostname, a `Referer`, an `Origin`, a path or a subdomain. The caller
 * presents a token; the token was minted by the server at a moment when it had
 * already verified something real — a completed Stripe Checkout session, or an
 * invitation sent by an authenticated OWNER/ADMIN of that same tenant — and the
 * tenant travels with the token, not with the request.
 *
 * That is the whole reason this module exists. See the migration
 * `20260906000000_add_tenant_activation_grants` for what registration used to
 * do instead, which was to pick the first active tenant row in the database.
 *
 * ── Token handling ───────────────────────────────────────────────────────────
 *
 * 32 bytes from `crypto.randomBytes`, base64url. Only its SHA-256 is stored, so
 * a database dump contains no usable activation links — the same treatment
 * `ApiKey.keyHash` gets. The plaintext is returned exactly once, by
 * `issueActivationGrant`, for whoever is about to email it.
 *
 * Redemption is single-use, time-boxed, and bound to the email address the
 * grant was issued for. The last of those matters: without it, anyone who
 * intercepts a link can create an account under their own address inside the
 * paying agency's tenant, which is the same breach by a different route.
 */

import { createHash, randomBytes, timingSafeEqual } from 'crypto';

import { RoleName, TenantActivationSource } from '@prisma/client';

import { getPrismaClient } from '../lib/prisma.js';

/** How long an activation link stays usable. Long enough to survive a weekend. */
export const ACTIVATION_GRANT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type ActivationFailureReason =
  | 'TOKEN_REQUIRED'
  | 'TOKEN_INVALID'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_ALREADY_USED'
  | 'TOKEN_EMAIL_MISMATCH'
  | 'TENANT_INACTIVE';

/**
 * A redemption that did not succeed.
 *
 * Every reason is answered to the caller with one generic message (see
 * `auth.ts`): distinguishing "this token does not exist" from "this token is
 * for a different address" tells an attacker which half of a guess was right.
 * The specific reason is kept here for the audit log and the server log.
 */
export class ActivationGrantError extends Error {
  readonly reason: ActivationFailureReason;

  constructor(reason: ActivationFailureReason, message: string) {
    super(message);
    this.name = 'ActivationGrantError';
    this.reason = reason;
  }
}

export interface IssuedGrant {
  grantId: string;
  /** The plaintext token. Returned once, never stored, never logged. */
  token: string;
  expiresAt: Date;
}

export interface RedeemedGrant {
  grantId: string;
  tenantId: string;
  roleName: RoleName;
  source: TenantActivationSource;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Compare two email addresses without letting the comparison time say how much
 * of the address matched.
 *
 * Both sides are already lowercased and trimmed by their callers; this only
 * settles equality.
 */
function emailsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Mint a single-use activation grant for one address inside one tenant.
 *
 * `tenantId` must come from something the server verified: the Stripe Checkout
 * session's own metadata, or the authenticated session of the OWNER/ADMIN doing
 * the inviting. Passing a tenant that arrived in a request body or a header
 * reintroduces exactly the hole this replaces.
 */
export async function issueActivationGrant(params: {
  tenantId: string;
  email: string;
  roleName?: RoleName;
  source: TenantActivationSource;
  stripeSessionId?: string;
  ttlMs?: number;
}): Promise<IssuedGrant> {
  const prisma = getPrismaClient();

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + (params.ttlMs ?? ACTIVATION_GRANT_TTL_MS));

  const grant = await prisma.tenantActivationGrant.create({
    data: {
      tenantId: params.tenantId,
      tokenHash: hashToken(token),
      email: params.email.trim().toLowerCase(),
      roleName: params.roleName ?? RoleName.AGENT,
      source: params.source,
      stripeSessionId: params.stripeSessionId ?? null,
      expiresAt,
    },
    select: { id: true },
  });

  return { grantId: grant.id, token, expiresAt };
}

/**
 * Resolve a token to the tenant it names, without consuming it.
 *
 * Used by the pre-flight check the signup page makes so it can show the agency
 * name before asking for a password. It deliberately returns only the tenant's
 * display name and the role: enumerating tokens must not enumerate tenants.
 */
export async function peekActivationGrant(
  token: string,
  email: string
): Promise<{ tenantName: string; roleName: RoleName }> {
  const grant = await loadRedeemableGrant(token, email);
  return { tenantName: grant.tenant.name, roleName: grant.roleName };
}

/**
 * Consume a grant, returning the tenant the new account belongs to.
 *
 * The update is conditional on `redeemedAt` still being null, so two requests
 * racing on the same token produce one account and one failure rather than two
 * accounts. `redeemedByUserId` is filled in by the caller once the user row
 * exists — see `completeActivationGrant`.
 */
export async function redeemActivationGrant(
  token: string,
  email: string
): Promise<RedeemedGrant> {
  const prisma = getPrismaClient();
  const grant = await loadRedeemableGrant(token, email);

  const claimed = await prisma.tenantActivationGrant.updateMany({
    where: { id: grant.id, redeemedAt: null },
    data: { redeemedAt: new Date() },
  });

  if (claimed.count === 0) {
    throw new ActivationGrantError(
      'TOKEN_ALREADY_USED',
      'This activation link has already been used'
    );
  }

  return {
    grantId: grant.id,
    tenantId: grant.tenantId,
    roleName: grant.roleName,
    source: grant.source,
  };
}

/**
 * Record which user a redeemed grant produced.
 *
 * Separate from `redeemActivationGrant` because the user row does not exist
 * until after the grant is claimed, and claiming first is what makes the race
 * above safe. A failure here loses the back-reference, not the isolation, so it
 * is not worth failing the registration over.
 */
export async function completeActivationGrant(
  grantId: string,
  userId: string
): Promise<void> {
  const prisma = getPrismaClient();
  await prisma.tenantActivationGrant
    .update({ where: { id: grantId }, data: { redeemedByUserId: userId } })
    .catch(() => {});
}

/**
 * Look a token up and check every condition except single-use consumption.
 *
 * Shared by peek and redeem so the two cannot disagree about what a usable
 * grant is.
 */
async function loadRedeemableGrant(token: string, email: string) {
  if (!token || !token.trim()) {
    throw new ActivationGrantError('TOKEN_REQUIRED', 'An activation token is required');
  }

  const prisma = getPrismaClient();
  const grant = await prisma.tenantActivationGrant.findUnique({
    where: { tokenHash: hashToken(token.trim()) },
    include: { tenant: { select: { name: true, status: true } } },
  });

  if (!grant) {
    throw new ActivationGrantError('TOKEN_INVALID', 'Activation token is not valid');
  }

  if (grant.redeemedAt) {
    throw new ActivationGrantError(
      'TOKEN_ALREADY_USED',
      'This activation link has already been used'
    );
  }

  if (grant.expiresAt.getTime() <= Date.now()) {
    throw new ActivationGrantError('TOKEN_EXPIRED', 'This activation link has expired');
  }

  if (!emailsMatch(grant.email, email.trim().toLowerCase())) {
    throw new ActivationGrantError(
      'TOKEN_EMAIL_MISMATCH',
      'This activation link was issued for a different email address'
    );
  }

  if (grant.tenant.status !== 'ACTIVE') {
    throw new ActivationGrantError('TENANT_INACTIVE', 'This agency account is not active');
  }

  return grant;
}
