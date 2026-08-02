import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthFailure, type VerifiedAuthContext } from '../../lib/dialer-v2-auth.js';
import { DialerV2ShadowClient } from '../../services/dialer-v2-shadow-client.js';
import { registerDialerV2ShadowRoutes } from '../dialer-v2-shadow.js';

/**
 * Routes are exercised through a real Fastify instance, with the SAME global
 * demo-tenant hook the production server installs. That is the point: it proves
 * the demo header reaches the route and is still refused.
 */
function buildApp(options: {
  verify?: (
    req: unknown
  ) => Promise<{ ok: true; context: VerifiedAuthContext } | { ok: false; failure: AuthFailure }>;
  decisions?: unknown[];
  /** Overrides what the upstream dialer returns, for session and logout. */
  fetchResponse?: Record<string, unknown>;
}): FastifyInstance {
  const app = Fastify();

  // Reproduction of apps/api/src/index.ts:106-117.
  app.addHook('onRequest', (request, _reply, done) => {
    const demoTenantId =
      (request.headers['x-demo-tenant-id'] as string | undefined) ||
      (request.query as { demoTenantId?: string } | undefined)?.demoTenantId;
    if (demoTenantId) {
      (request as { user?: unknown }).user = {
        tenantId: demoTenantId,
        roles: ['ADMIN', 'OWNER'],
      };
    }
    done();
  });

  const fetchImpl = vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve(
          options.fetchResponse ?? {
            decisions: options.decisions ?? [],
            agents: [],
            corrections: [],
          }
        ),
    } as unknown as Response)
  ) as unknown as typeof fetch;

  const client = new DialerV2ShadowClient({
    baseUrl: 'http://dialer-v2:9092',
    fetchImpl,
    internalToken: 'test-internal-token-value',
  });

  void registerDialerV2ShadowRoutes(app, {
    client,
    verify:
      options.verify ?? (() => Promise.resolve({ ok: false, failure: AuthFailure.NO_CREDENTIALS })),
  });

  (app as FastifyInstance & { __fetch: typeof fetchImpl }).__fetch = fetchImpl;
  return app;
}

interface Envelope {
  data?: unknown;
  meta?: {
    tenantId?: string;
    authSource?: string;
    shadowMode?: boolean;
    originated?: boolean;
    note?: string;
  };
  error?: { code?: string; message?: string };
}

/** JSON.parse returns `any`; narrow it once here rather than at every call site. */
function body<T = Envelope>(raw: string): T {
  return JSON.parse(raw) as T;
}

const supervisor: VerifiedAuthContext = {
  source: 'jwt',
  tenantId: 'tenant-a',
  userId: 'user-1',
  roles: ['ADMIN'],
};

let app: FastifyInstance | null = null;
afterEach(async () => {
  if (app) await app.close();
  app = null;
});

const ROUTES = [
  '/api/v1/dialer-v2/shadow/status',
  '/api/v1/dialer-v2/shadow/decisions',
  '/api/v1/dialer-v2/agents/state',
  '/api/v1/dialer-v2/reconciliation/corrections',
];

describe('browser-controlled tenant impersonation is refused', () => {
  it('returns 401 for x-demo-tenant-id on every route', async () => {
    app = buildApp({});
    for (const url of ROUTES) {
      const res = await app.inject({
        method: 'GET',
        url,
        headers: { 'x-demo-tenant-id': 'tenant-victim' },
      });
      expect(res.statusCode, url).toBe(401);
      expect(res.body).not.toContain('tenant-victim');
    }
  });

  it('returns 401 for ?demoTenantId=', async () => {
    app = buildApp({});
    for (const url of ROUTES) {
      const res = await app.inject({ method: 'GET', url: `${url}?demoTenantId=tenant-victim` });
      expect(res.statusCode, url).toBe(401);
    }
  });

  it('returns 401 when the global hook has already populated request.user', async () => {
    app = buildApp({});
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/dialer-v2/shadow/decisions',
      headers: { 'x-demo-tenant-id': 'tenant-victim' },
    });
    expect(res.statusCode).toBe(401);
    expect(body(res.body)).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
  });

  it('returns 401 with no credentials at all', async () => {
    app = buildApp({});
    const res = await app.inject({ method: 'GET', url: '/api/v1/dialer-v2/shadow/status' });
    expect(res.statusCode).toBe(401);
  });
});

describe('verified credentials', () => {
  it('accepts a verified JWT supervisor', async () => {
    app = buildApp({ verify: () => Promise.resolve({ ok: true, context: supervisor }) });
    const res = await app.inject({ method: 'GET', url: '/api/v1/dialer-v2/shadow/status' });
    expect(res.statusCode).toBe(200);
    expect(body(res.body).meta).toMatchObject({ tenantId: 'tenant-a', authSource: 'jwt' });
  });

  it('accepts a verified API key', async () => {
    app = buildApp({
      verify: () =>
        Promise.resolve({
          ok: true,
          context: {
            source: 'api_key',
            tenantId: 'tenant-a',
            roles: [],
            scopes: ['dialer-v2:read'],
          },
        }),
    });
    const res = await app.inject({ method: 'GET', url: '/api/v1/dialer-v2/shadow/decisions' });
    expect(res.statusCode).toBe(200);
    expect(body(res.body).meta?.authSource).toBe('api_key');
  });

  it('returns 403 for a verified user with an insufficient role', async () => {
    app = buildApp({
      verify: () =>
        Promise.resolve({
          ok: true,
          context: { source: 'jwt', tenantId: 'tenant-a', userId: 'u', roles: ['AGENT'] },
        }),
    });
    const res = await app.inject({ method: 'GET', url: '/api/v1/dialer-v2/shadow/status' });
    expect(res.statusCode).toBe(403);
    expect(body(res.body).error?.code).toBe('FORBIDDEN');
  });
});

describe('tenant scope cannot be widened', () => {
  it('uses the verified tenant, not one supplied in the query', async () => {
    app = buildApp({ verify: () => Promise.resolve({ ok: true, context: supervisor }) });
    await app.inject({
      method: 'GET',
      url: '/api/v1/dialer-v2/shadow/decisions?tenantId=tenant-b&campaignId=c1',
    });

    const fetchImpl = (app as FastifyInstance & { __fetch: ReturnType<typeof vi.fn> }).__fetch;
    const requested = String(fetchImpl.mock.calls[0][0]);
    expect(requested).toContain('tenantId=tenant-a');
    expect(requested).not.toContain('tenant-b');
  });

  it('treats campaignId strictly as a filter within the verified tenant', async () => {
    app = buildApp({ verify: () => Promise.resolve({ ok: true, context: supervisor }) });
    await app.inject({
      method: 'GET',
      // An injection attempt in campaignId must not reach tenantId.
      url:
        '/api/v1/dialer-v2/shadow/decisions?campaignId=' +
        encodeURIComponent('c1&tenantId=tenant-b'),
    });

    const fetchImpl = (app as FastifyInstance & { __fetch: ReturnType<typeof vi.fn> }).__fetch;
    const requested = String(fetchImpl.mock.calls[0][0]);
    expect(requested).toContain('tenantId=tenant-a');
    expect(requested).toContain('campaignId=c1%26tenantId%3Dtenant-b');
  });

  it('never returns data for a tenant other than the verified one', async () => {
    app = buildApp({
      verify: () => Promise.resolve({ ok: true, context: supervisor }),
      decisions: [{ campaignId: 'c1', originated: false }],
    });
    const res = await app.inject({ method: 'GET', url: '/api/v1/dialer-v2/shadow/decisions' });
    expect(body(res.body).meta?.tenantId).toBe('tenant-a');
  });
});

describe('shadow framing', () => {
  it('states on every response that no call was placed', async () => {
    app = buildApp({ verify: () => Promise.resolve({ ok: true, context: supervisor }) });
    const res = await app.inject({ method: 'GET', url: '/api/v1/dialer-v2/shadow/decisions' });
    const meta = body(res.body).meta!;
    expect(meta.shadowMode).toBe(true);
    expect(meta.originated).toBe(false);
    expect(meta.note).toContain('No call was placed');
  });
});

const AGENT_JWT = {
  ok: true as const,
  context: { source: 'jwt' as const, tenantId: 'tenant-a', userId: 'u1', roles: ['AGENT'] },
};

/** Cookies plus the matching CSRF header, as a real browser would send them. */
function withSession(token = 'session-token-abc', csrf = 'csrf-abc') {
  return {
    cookies: {
      hw_dialer_session: token,
      hw_dialer_session_ref: 'hash-abc',
      hw_dialer_csrf: csrf,
    },
    headers: { 'x-dialer-csrf': csrf },
  };
}

describe('agent heartbeat', () => {
  it('rejects an unauthenticated heartbeat', async () => {
    app = buildApp({});
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/dialer-v2/agents/heartbeat',
      ...withSession(),
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a demo-header heartbeat', async () => {
    app = buildApp({});
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/dialer-v2/agents/heartbeat',
      cookies: withSession().cookies,
      headers: { ...withSession().headers, 'x-demo-tenant-id': 'tenant-victim' },
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects an API key, which carries no user identity', async () => {
    app = buildApp({
      verify: () =>
        Promise.resolve({
          ok: true,
          context: {
            source: 'api_key',
            tenantId: 'tenant-a',
            roles: [],
            scopes: ['dialer-v2:read'],
          },
        }),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/dialer-v2/agents/heartbeat',
      ...withSession(),
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects a heartbeat with no session cookie', async () => {
    // The token is not accepted from the body at all — there is nowhere in the
    // payload for it to go.
    app = buildApp({ verify: () => Promise.resolve(AGENT_JWT) });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/dialer-v2/agents/heartbeat',
      payload: { sessionToken: 'smuggled-in-the-body' },
    });
    expect(res.statusCode).toBe(401);
    expect(body(res.body).error?.code).toBe('NO_SESSION_COOKIE');
  });

  it('rejects a heartbeat with a cookie but no CSRF header', async () => {
    // A cookie is sent by the browser automatically, so any origin that can
    // make the browser issue a request would otherwise authenticate as the
    // agent.
    app = buildApp({ verify: () => Promise.resolve(AGENT_JWT) });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/dialer-v2/agents/heartbeat',
      cookies: withSession().cookies,
      payload: {},
    });
    expect(res.statusCode).toBe(401);
    expect(body(res.body).error?.code).toBe('CSRF_HEADER_MISSING');
  });

  it('rejects a CSRF header that does not match the cookie', async () => {
    app = buildApp({ verify: () => Promise.resolve(AGENT_JWT) });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/dialer-v2/agents/heartbeat',
      cookies: withSession().cookies,
      headers: { 'x-dialer-csrf': 'a-different-token-entirely' },
      payload: {},
    });
    expect(res.statusCode).toBe(401);
    expect(body(res.body).error?.code).toBe('CSRF_MISMATCH');
  });

  it('forwards the cookie token upstream, never a body value', async () => {
    app = buildApp({ verify: () => Promise.resolve(AGENT_JWT) });
    await app.inject({
      method: 'POST',
      url: '/api/v1/dialer-v2/agents/heartbeat',
      ...withSession('the-real-token'),
      payload: { sessionToken: 'a-forged-token' },
    });

    const fetchImpl = (app as FastifyInstance & { __fetch: ReturnType<typeof vi.fn> }).__fetch;
    const sent = body<{ sessionToken: string }>(
      String((fetchImpl.mock.calls[0][1] as RequestInit).body)
    );
    expect(sent.sessionToken).toBe('the-real-token');
  });

  it('ignores a tenantId or agentId supplied in the body', async () => {
    app = buildApp({ verify: () => Promise.resolve(AGENT_JWT) });
    await app.inject({
      method: 'POST',
      url: '/api/v1/dialer-v2/agents/heartbeat',
      ...withSession(),
      payload: { tenantId: 'tenant-b', agentId: 'someone-else' },
    });

    const fetchImpl = (app as FastifyInstance & { __fetch: ReturnType<typeof vi.fn> }).__fetch;
    const sent = body<{ tenantId: string; agentId: string }>(
      String((fetchImpl.mock.calls[0][1] as RequestInit).body)
    );
    expect(sent.tenantId).toBe('tenant-a');
    expect(sent.agentId).toBe('u1');
  });

  it('sends the internal service token upstream', async () => {
    app = buildApp({ verify: () => Promise.resolve(AGENT_JWT) });
    await app.inject({
      method: 'POST',
      url: '/api/v1/dialer-v2/agents/heartbeat',
      ...withSession(),
      payload: {},
    });

    const fetchImpl = (app as FastifyInstance & { __fetch: ReturnType<typeof vi.fn> }).__fetch;
    const headers = (fetchImpl.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['x-dialer-v2-internal-token']).toBe('test-internal-token-value');
  });
});

describe('the session token never reaches page JavaScript', () => {
  function issuingApp() {
    return buildApp({
      verify: () => Promise.resolve(AGENT_JWT),
      fetchResponse: {
        sessionToken: 'super-secret-bearer-token',
        sessionTokenHash: 'digest-of-it',
        issuedAtMs: 1_800_000_000_000,
        expiresAtMs: 1_800_000_600_000,
      },
    });
  }

  const csrfOf = (raw: string) => body<{ data?: { csrfToken?: string } }>(raw).data?.csrfToken;

  it('returns no token and no hash in the response body', async () => {
    app = issuingApp();
    const res = await app.inject({ method: 'POST', url: '/api/v1/dialer-v2/agents/session' });

    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('super-secret-bearer-token');
    expect(res.body).not.toContain('digest-of-it');
    // What the page legitimately needs: when to re-authenticate, and the CSRF
    // token it must echo.
    expect(body(res.body).data).toMatchObject({ expiresAtMs: 1_800_000_600_000 });
  });

  it('sets the token as an HttpOnly, SameSite=Strict cookie on a narrow path', async () => {
    app = issuingApp();
    const res = await app.inject({ method: 'POST', url: '/api/v1/dialer-v2/agents/session' });

    const session = res.cookies.find(c => c.name === 'hw_dialer_session');
    expect(session?.value).toBe('super-secret-bearer-token');
    expect(session?.httpOnly).toBe(true);
    expect(session?.sameSite).toBe('Strict');
    // A path of / would attach the credential to every request this origin
    // makes, including static assets and unrelated APIs.
    expect(session?.path).toBe('/api/v1/dialer-v2/agents');
    expect(session?.maxAge).toBeGreaterThan(0);
  });

  it('leaves the CSRF cookie readable, because it is not a credential', async () => {
    app = issuingApp();
    const res = await app.inject({ method: 'POST', url: '/api/v1/dialer-v2/agents/session' });

    const csrf = res.cookies.find(c => c.name === 'hw_dialer_csrf');
    expect(csrf?.httpOnly).toBeFalsy();
    expect(csrf?.value).toBe(csrfOf(res.body));
  });

  it('mints a different CSRF token on each issue', async () => {
    app = issuingApp();
    const first = await app.inject({ method: 'POST', url: '/api/v1/dialer-v2/agents/session' });
    const second = await app.inject({ method: 'POST', url: '/api/v1/dialer-v2/agents/session' });

    expect(csrfOf(first.body)).not.toBe(csrfOf(second.body));
  });
});

describe('logout revokes rather than merely forgetting', () => {
  it('revokes upstream and clears every cookie', async () => {
    // A cleared cookie leaves the session valid to anyone who captured the
    // token. The point of a server-side session is that the server can end it.
    app = buildApp({
      verify: () => Promise.resolve(AGENT_JWT),
      fetchResponse: { revoked: true },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/dialer-v2/agents/logout',
      ...withSession(),
    });

    expect(body(res.body).data).toMatchObject({ revoked: true });

    const fetchImpl = (app as FastifyInstance & { __fetch: ReturnType<typeof vi.fn> }).__fetch;
    expect(String(fetchImpl.mock.calls[0][0])).toContain('/internal/agents/session/revoke');
    const sent = body<{ sessionTokenHash: string }>(
      String((fetchImpl.mock.calls[0][1] as RequestInit).body)
    );
    // Addressed by hash: revocation never needs the token read back.
    expect(sent.sessionTokenHash).toBe('hash-abc');

    for (const name of ['hw_dialer_session', 'hw_dialer_session_ref', 'hw_dialer_csrf']) {
      expect(res.cookies.find(c => c.name === name)?.value).toBe('');
    }
  });

  it('clears the cookies even when revocation failed', async () => {
    app = buildApp({
      verify: () => Promise.resolve(AGENT_JWT),
      fetchResponse: { revoked: false },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/dialer-v2/agents/logout',
      ...withSession(),
    });

    expect(body(res.body).data).toMatchObject({ revoked: false });
    // Leaving them in place would keep presenting a credential the user has
    // asked to give up.
    expect(res.cookies.find(c => c.name === 'hw_dialer_session')?.value).toBe('');
  });

  it('refuses an unauthenticated logout', async () => {
    app = buildApp({});
    const res = await app.inject({ method: 'POST', url: '/api/v1/dialer-v2/agents/logout' });
    expect(res.statusCode).toBe(401);
  });
});
