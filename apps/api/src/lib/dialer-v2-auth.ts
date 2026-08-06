/**
 * Dialer V2 — verified authentication.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 *
 * The global `onRequest` hook in `apps/api/src/index.ts` populates
 * `request.user` from a demo fallback:
 *
 *   const demoTenantId = headers['x-demo-tenant-id'] || query.demoTenantId;
 *   if (demoTenantId) { request.user = { tenantId: demoTenantId,
 *                                        roles: ['ADMIN', 'OWNER'] }; return; }
 *
 * That fallback is evaluated BEFORE the API-key branch, so a browser-supplied
 * header both fabricates a tenant and grants ADMIN+OWNER, and short-circuits
 * real API-key verification entirely. Any route that trusts `request.user` is
 * therefore trusting a browser-controlled tenant id.
 *
 * `MULTITENANT_GAP_ANALYSIS.md` §1 documents this as a platform-wide issue.
 * Fixing the global hook is a separate, wider-blast-radius change that would
 * alter behaviour for every existing route. Dialer V2 instead verifies
 * independently.
 *
 * ── The rule ─────────────────────────────────────────────────────────────────
 *
 * This module reads ONLY `Authorization: Bearer <jwt>` and `x-api-key`. It never
 * reads `request.user`, `x-demo-tenant-id`, `?demoTenantId=`, a body field, or
 * any other header. There is no default tenant and no fallback. If verification
 * does not succeed, the answer is null and the caller returns 401.
 */

export type AuthSource = 'jwt' | 'api_key';

export interface VerifiedAuthContext {
  source: AuthSource;
  tenantId: string;
  userId?: string;
  roles: string[];
  scopes?: string[];
}

export enum AuthFailure {
  NO_CREDENTIALS = 'NO_CREDENTIALS',
  INVALID_JWT = 'INVALID_JWT',
  INVALID_API_KEY = 'INVALID_API_KEY',
  MALFORMED_CLAIMS = 'MALFORMED_CLAIMS',
  TENANT_INACTIVE = 'TENANT_INACTIVE',
  /** The token is validly signed, but the account no longer exists or is not ACTIVE. */
  USER_INACTIVE = 'USER_INACTIVE',
  /** The token's tenant is no longer the user's tenant. */
  TENANT_MISMATCH = 'TENANT_MISMATCH',
}

export type VerifyResult =
  | { ok: true; context: VerifiedAuthContext }
  | { ok: false; failure: AuthFailure };

/** Roles permitted to view Dialer V2 supervisor data. Deny by default. */
export const DIALER_V2_VIEW_ROLES: readonly string[] = Object.freeze(['OWNER', 'ADMIN', 'ANALYST']);

/**
 * API-key scope required for Dialer V2 read access. A key must carry this
 * explicitly — there is no wildcard and no "all scopes" shortcut, because an
 * existing integration key should not silently gain dialer visibility.
 */
export const DIALER_V2_READ_SCOPE = 'dialer-v2:read';

export interface ApiKeyRecord {
  id: string;
  tenantId: string;
  status: string;
  expiresAt: Date | null;
  scopes: unknown;
  tenantStatus: string;
}

/** A user's current account state and the roles they hold right now. */
export interface UserRoleRecord {
  /** The account's status. Anything other than `ACTIVE` is refused. */
  status: string;
  /** The tenant the user actually belongs to, as stored. */
  tenantId: string | null;
  /** Role names, e.g. `['ADMIN']`. */
  roles: string[];
}

export interface VerifyDeps {
  /** Verifies and decodes a JWT. MUST throw on an invalid signature. */
  verifyJwt: (token: string) => unknown;
  /** Looks up an API key by its SHA-256 hash. */
  lookupApiKey: (keyHash: string) => Promise<ApiKeyRecord | null>;
  /**
   * Resolves a user's current roles and account state.
   *
   * Always keyed on the `userId` of a signature-verified token — never on
   * anything a caller can set. Returns null when no such user exists.
   */
  lookupUserRoles: (userId: string) => Promise<UserRoleRecord | null>;
  /** SHA-256 hex of the presented key. */
  hashApiKey: (raw: string) => string;
  now: () => Date;
}

/** Only these two headers are ever consulted. */
export interface AuthHeaders {
  authorization?: string;
  'x-api-key'?: string;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

/**
 * Verify a request's credentials. Pure with respect to I/O — every dependency
 * is injected, so every branch is testable without a server or a database.
 */
export async function verifyDialerV2Auth(
  headers: AuthHeaders,
  deps: VerifyDeps
): Promise<VerifyResult> {
  const authorization = headers.authorization;
  const apiKey = headers['x-api-key'];

  // ---- JWT ----------------------------------------------------------------
  if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
    const token = authorization.slice('Bearer '.length).trim();
    if (token.length === 0) return { ok: false, failure: AuthFailure.INVALID_JWT };

    let decoded: unknown;
    try {
      decoded = deps.verifyJwt(token);
    } catch {
      return { ok: false, failure: AuthFailure.INVALID_JWT };
    }

    if (typeof decoded !== 'object' || decoded === null) {
      return { ok: false, failure: AuthFailure.MALFORMED_CLAIMS };
    }

    const claims = decoded as Record<string, unknown>;
    const tenantId = claims.tenantId;
    if (typeof tenantId !== 'string' || tenantId.length === 0) {
      // A validly signed token with no tenant claim is not usable here. It is
      // never backfilled from a header.
      return { ok: false, failure: AuthFailure.MALFORMED_CLAIMS };
    }

    const userId = typeof claims.userId === 'string' ? claims.userId : undefined;

    // ---- Roles come from the database, not from the token -------------------
    //
    // The platform's login tokens carry tenantId/userId/email and NO `roles`
    // claim (`apps/api/src/routes/auth.ts` — all three jwtSign sites, and
    // `JwtPayload` has no such field). Reading roles from the token therefore
    // resolved `[]` for every browser session, and `isAuthorizedForDialerV2`
    // denied all of them: a guaranteed 403 that no database role grant could
    // fix, because the claim was never written in the first place.
    //
    // Resolving here also means a revoked role takes effect on the next
    // request, rather than surviving for the remainder of a 7-day token. This
    // is a database read, like the API-key branch below — the rule this module
    // enforces is that nothing browser-supplied is trusted, and `userId` comes
    // from a verified signature.
    let roles = asStringArray(claims.roles);
    if (userId) {
      let record: UserRoleRecord | null;
      try {
        record = await deps.lookupUserRoles(userId);
      } catch {
        // A failed lookup must deny. Falling through to the token's roles would
        // restore the original bug the moment the database blipped.
        return { ok: false, failure: AuthFailure.USER_INACTIVE };
      }

      if (!record || record.status !== 'ACTIVE') {
        return { ok: false, failure: AuthFailure.USER_INACTIVE };
      }
      // A token issued before the user moved tenants must not keep reading the
      // old one's data.
      if (record.tenantId !== tenantId) {
        return { ok: false, failure: AuthFailure.TENANT_MISMATCH };
      }

      roles = record.roles;
    }

    return {
      ok: true,
      context: {
        source: 'jwt',
        tenantId,
        userId,
        roles,
      },
    };
  }

  // ---- API key ------------------------------------------------------------
  if (typeof apiKey === 'string' && apiKey.length > 0) {
    let record: ApiKeyRecord | null;
    try {
      record = await deps.lookupApiKey(deps.hashApiKey(apiKey));
    } catch {
      return { ok: false, failure: AuthFailure.INVALID_API_KEY };
    }

    if (!record || record.status !== 'ACTIVE') {
      return { ok: false, failure: AuthFailure.INVALID_API_KEY };
    }
    if (record.expiresAt && record.expiresAt <= deps.now()) {
      return { ok: false, failure: AuthFailure.INVALID_API_KEY };
    }
    if (record.tenantStatus !== 'ACTIVE') {
      return { ok: false, failure: AuthFailure.TENANT_INACTIVE };
    }

    return {
      ok: true,
      context: {
        source: 'api_key',
        tenantId: record.tenantId,
        roles: [],
        scopes: asStringArray(record.scopes),
      },
    };
  }

  return { ok: false, failure: AuthFailure.NO_CREDENTIALS };
}

/**
 * Authorisation, separate from authentication. A verified caller still needs
 * permission.
 */
export function isAuthorizedForDialerV2(context: VerifiedAuthContext): boolean {
  if (context.source === 'jwt') {
    return context.roles.some(role => DIALER_V2_VIEW_ROLES.includes(role));
  }
  return (context.scopes ?? []).includes(DIALER_V2_READ_SCOPE);
}
