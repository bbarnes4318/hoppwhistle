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
        Promise.resolve({ decisions: options.decisions ?? [], agents: [], corrections: [] }),
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

describe('agent heartbeat', () => {
  it('rejects an unauthenticated heartbeat', async () => {
    app = buildApp({});
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/dialer-v2/agents/heartbeat',
      payload: { sessionId: 's1' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a demo-header heartbeat', async () => {
    app = buildApp({});
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/dialer-v2/agents/heartbeat',
      headers: { 'x-demo-tenant-id': 'tenant-victim' },
      payload: { sessionId: 's1' },
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
      payload: { sessionId: 's1' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('requires a session id', async () => {
    app = buildApp({
      verify: () =>
        Promise.resolve({
          ok: true,
          context: { source: 'jwt', tenantId: 'tenant-a', userId: 'u1', roles: ['AGENT'] },
        }),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/dialer-v2/agents/heartbeat',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('ignores a tenantId or agentId supplied in the body', async () => {
    app = buildApp({
      verify: () =>
        Promise.resolve({
          ok: true,
          context: { source: 'jwt', tenantId: 'tenant-a', userId: 'u1', roles: ['AGENT'] },
        }),
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/dialer-v2/agents/heartbeat',
      payload: { sessionId: 's1', tenantId: 'tenant-b', agentId: 'someone-else' },
    });

    const fetchImpl = (app as FastifyInstance & { __fetch: ReturnType<typeof vi.fn> }).__fetch;
    const sent = body<{ tenantId: string; agentId: string }>(
      String((fetchImpl.mock.calls[0][1] as RequestInit).body)
    );
    expect(sent.tenantId).toBe('tenant-a');
    expect(sent.agentId).toBe('u1');
  });

  it('sends the internal service token upstream', async () => {
    app = buildApp({
      verify: () =>
        Promise.resolve({
          ok: true,
          context: { source: 'jwt', tenantId: 'tenant-a', userId: 'u1', roles: ['AGENT'] },
        }),
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/dialer-v2/agents/heartbeat',
      payload: { sessionId: 's1' },
    });

    const fetchImpl = (app as FastifyInstance & { __fetch: ReturnType<typeof vi.fn> }).__fetch;
    const headers = (fetchImpl.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['x-dialer-v2-internal-token']).toBe('test-internal-token-value');
  });
});
