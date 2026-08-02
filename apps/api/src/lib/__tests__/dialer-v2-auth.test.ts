import { describe, expect, it, vi } from 'vitest';

import {
  AuthFailure,
  DIALER_V2_READ_SCOPE,
  isAuthorizedForDialerV2,
  verifyDialerV2Auth,
  type ApiKeyRecord,
  type VerifyDeps,
} from '../dialer-v2-auth.js';

const NOW = new Date('2026-08-02T00:00:00Z');

function deps(overrides: Partial<VerifyDeps> = {}): VerifyDeps {
  return {
    verifyJwt: (token: string) => {
      if (token !== 'good-jwt') throw new Error('invalid signature');
      return { tenantId: 'tenant-a', userId: 'user-1', roles: ['ADMIN'] };
    },
    hashApiKey: (raw: string) => `hash:${raw}`,
    now: () => NOW,
    lookupApiKey: (hash: string): Promise<ApiKeyRecord | null> =>
      Promise.resolve(
        hash === 'hash:good-key'
          ? {
              id: 'k1',
              tenantId: 'tenant-a',
              status: 'ACTIVE',
              expiresAt: null,
              scopes: [DIALER_V2_READ_SCOPE],
              tenantStatus: 'ACTIVE',
            }
          : null
      ),
    ...overrides,
  };
}

describe('the defect this module exists to close', () => {
  it('ignores x-demo-tenant-id entirely', async () => {
    // The global hook turns this header into request.user with ADMIN+OWNER.
    // verifyDialerV2Auth never reads it, so it carries no authority here.
    const result = await verifyDialerV2Auth(
      { 'x-demo-tenant-id': 'tenant-victim' } as never,
      deps()
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toBe(AuthFailure.NO_CREDENTIALS);
  });

  it('ignores a demoTenantId query parameter', async () => {
    const result = await verifyDialerV2Auth({ demoTenantId: 'tenant-victim' } as never, deps());
    expect(result.ok).toBe(false);
  });

  it('ignores a pre-populated request.user object', async () => {
    // Even handed an object shaped exactly like the global hook's output.
    const forged = {
      user: { tenantId: 'tenant-victim', roles: ['ADMIN', 'OWNER'] },
      'x-tenant-id': 'tenant-victim',
      tenantId: 'tenant-victim',
    };
    const result = await verifyDialerV2Auth(forged as never, deps());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toBe(AuthFailure.NO_CREDENTIALS);
  });

  it('reads only the authorization and x-api-key headers', async () => {
    const seen: string[] = [];
    const headers = new Proxy(
      {},
      {
        get(_t, prop: string) {
          seen.push(prop);
          return undefined;
        },
      }
    );
    await verifyDialerV2Auth(headers as never, deps());
    expect(seen.sort()).toEqual(['authorization', 'x-api-key']);
  });
});

describe('JWT', () => {
  it('accepts a valid token and takes the tenant from its claims', async () => {
    const result = await verifyDialerV2Auth({ authorization: 'Bearer good-jwt' }, deps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.context.source).toBe('jwt');
    expect(result.context.tenantId).toBe('tenant-a');
    expect(result.context.userId).toBe('user-1');
    expect(result.context.roles).toEqual(['ADMIN']);
  });

  it('rejects a bad signature', async () => {
    const result = await verifyDialerV2Auth({ authorization: 'Bearer forged' }, deps());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toBe(AuthFailure.INVALID_JWT);
  });

  it('rejects an empty bearer token', async () => {
    const result = await verifyDialerV2Auth({ authorization: 'Bearer   ' }, deps());
    expect(result.ok).toBe(false);
  });

  it('rejects a validly signed token with no tenant claim', async () => {
    // Never backfilled from a header — a token without a tenant is unusable.
    const result = await verifyDialerV2Auth(
      { authorization: 'Bearer good-jwt', 'x-demo-tenant-id': 'tenant-b' } as never,
      deps({ verifyJwt: () => ({ userId: 'u1', roles: ['ADMIN'] }) })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toBe(AuthFailure.MALFORMED_CLAIMS);
  });

  it('rejects a non-object payload', async () => {
    const result = await verifyDialerV2Auth(
      { authorization: 'Bearer good-jwt' },
      deps({ verifyJwt: () => 'a-string' })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toBe(AuthFailure.MALFORMED_CLAIMS);
  });

  it('does not fall through to the API key when the JWT is bad', async () => {
    // Falling through would let a bad JWT plus a good key silently succeed with
    // a different identity than the caller presented.
    const lookupApiKey = vi.fn(() => Promise.resolve(null));
    const result = await verifyDialerV2Auth(
      { authorization: 'Bearer forged', 'x-api-key': 'good-key' },
      deps({ lookupApiKey })
    );
    expect(result.ok).toBe(false);
    expect(lookupApiKey).not.toHaveBeenCalled();
  });
});

describe('API key', () => {
  it('accepts an active key', async () => {
    const result = await verifyDialerV2Auth({ 'x-api-key': 'good-key' }, deps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.context.source).toBe('api_key');
    expect(result.context.tenantId).toBe('tenant-a');
  });

  it('rejects an unknown key', async () => {
    const result = await verifyDialerV2Auth({ 'x-api-key': 'nope' }, deps());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toBe(AuthFailure.INVALID_API_KEY);
  });

  const base: ApiKeyRecord = {
    id: 'k1',
    tenantId: 'tenant-a',
    status: 'ACTIVE',
    expiresAt: null,
    scopes: [DIALER_V2_READ_SCOPE],
    tenantStatus: 'ACTIVE',
  };

  it.each([
    ['revoked', { status: 'REVOKED' }, AuthFailure.INVALID_API_KEY],
    ['expired', { expiresAt: new Date('2020-01-01') }, AuthFailure.INVALID_API_KEY],
    ['suspended tenant', { tenantStatus: 'SUSPENDED' }, AuthFailure.TENANT_INACTIVE],
  ])('rejects a %s key', async (_n, override, failure) => {
    const result = await verifyDialerV2Auth(
      { 'x-api-key': 'good-key' },
      deps({ lookupApiKey: () => Promise.resolve({ ...base, ...override }) })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toBe(failure);
  });

  it('treats a lookup failure as a rejection, never as a pass', async () => {
    const result = await verifyDialerV2Auth(
      { 'x-api-key': 'good-key' },
      deps({ lookupApiKey: () => Promise.reject(new Error('db down')) })
    );
    expect(result.ok).toBe(false);
  });
});

describe('authorization', () => {
  it('permits supervisor roles', () => {
    for (const role of ['OWNER', 'ADMIN', 'ANALYST']) {
      expect(isAuthorizedForDialerV2({ source: 'jwt', tenantId: 't', roles: [role] })).toBe(true);
    }
  });

  it('refuses insufficient roles', () => {
    for (const role of ['AGENT', 'READONLY', 'PUBLISHER', 'BUYER']) {
      expect(isAuthorizedForDialerV2({ source: 'jwt', tenantId: 't', roles: [role] })).toBe(false);
    }
    expect(isAuthorizedForDialerV2({ source: 'jwt', tenantId: 't', roles: [] })).toBe(false);
  });

  it('requires an explicit scope on an API key, with no wildcard', () => {
    expect(
      isAuthorizedForDialerV2({
        source: 'api_key',
        tenantId: 't',
        roles: [],
        scopes: [DIALER_V2_READ_SCOPE],
      })
    ).toBe(true);

    // An existing integration key must not silently gain dialer visibility.
    for (const scopes of [[], ['*'], ['admin'], ['calls:read']]) {
      expect(isAuthorizedForDialerV2({ source: 'api_key', tenantId: 't', roles: [], scopes })).toBe(
        false
      );
    }
  });

  it('does not let API-key roles substitute for scopes', () => {
    expect(
      isAuthorizedForDialerV2({ source: 'api_key', tenantId: 't', roles: ['ADMIN'], scopes: [] })
    ).toBe(false);
  });
});

describe('cross-tenant isolation', () => {
  it('always returns the tenant from the credential, never from a header', async () => {
    const result = await verifyDialerV2Auth(
      {
        authorization: 'Bearer good-jwt',
        'x-demo-tenant-id': 'tenant-b',
        'x-tenant-id': 'tenant-b',
      } as never,
      deps()
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.context.tenantId).toBe('tenant-a');
  });
});
