/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any -- this suite deliberately reads dynamically typed response bodies */
import Fastify, { FastifyInstance } from 'fastify';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { grantPlatformAdmin } from '../lib/platform-admin.js';
import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * The response shape the web client actually receives, from the real endpoint.
 *
 * ── The bug this exists to have caught ───────────────────────────────────────
 *
 * `GET /api/v1/platform/tenants` answers `{ data: tenants }`. The agency
 * switcher read the body as though it were the array itself, got an object,
 * called `.map` on it, and threw during render. The switcher sits in the
 * dashboard layout, so React unmounted the entire application: every platform
 * admin saw "Application error: a client-side exception has occurred" on a
 * blank page and could not reach any agency.
 *
 * ── Why nothing caught it ────────────────────────────────────────────────────
 *
 * Phase 2 built the switcher and Phase 4 reviewed these screens. Neither
 * exercised the switcher's primary action against a real response, and the API
 * test that does hit this route asserted with a helper that walks the body
 * RECURSIVELY collecting any `id` key at any depth. `{ data: [{id}] }`,
 * `{ tenants: [{id}] }` and a bare `[{id}]` all satisfy it identically, so it
 * could not fail on an envelope change however wrong the client was.
 *
 * A shape-blind assertion is not a contract. There was no web-side test of this
 * endpoint at all, and the assertion that existed was structurally incapable of
 * failing.
 *
 * ── What this suite does instead ─────────────────────────────────────────────
 *
 * It boots the real Fastify routes on a real port and drives THE REAL WEB
 * CLIENT — `apps/web/src/lib/api.ts`, the same module the browser runs —
 * against them over real HTTP. It then asserts what each consumer's accessor
 * actually yields: not "the id is somewhere in the body", but "`payload(...)`
 * on this response is an array of tenants".
 *
 * A route that changes its envelope, or a caller that reads the wrong key,
 * fails here rather than in production.
 */

const gate = databaseGate();
announceSkip('the API response contract, through the real web client', gate);

const TEST_JWT_SECRET = 'contract-suite-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

describe('contract suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `contract suite cannot run: ${gate.reason}`).toBe(true);
  });
});

describe.skipIf(!gate.available)('the API response contract, through the real web client', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;
  let baseUrl: string;

  let operatorId: string;
  let operatorToken: string;
  let agency: { id: string; name: string; ownerId: string };

  /**
   * The real `apiClient` singleton from apps/web.
   *
   * Imported once, after the globals it reads at module load are in place: it
   * takes its base URL from `window.location.origin` and its bearer token from
   * `localStorage`, and only consults either when it believes it is running in
   * a browser. Stubbing those is what lets the browser's own client run here.
   */
  let apiClient: typeof import('../../../web/src/lib/api')['apiClient'];
  let payload: typeof import('../../../web/src/lib/api')['payload'];

  const store = new Map<string, string>();

  async function buildApp(): Promise<FastifyInstance> {
    const instance = Fastify();
    await instance.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    await instance.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
    registerApiV1Auth(instance);

    const { registerPlatformRoutes } = await import('../routes/platform.js');
    await instance.register(registerPlatformRoutes);
    const { registerDeliveryBillingRoutes } = await import('../routes/delivery-billing.js');
    await instance.register(registerDeliveryBillingRoutes);
    const { registerQuotaRoutes } = await import('../routes/quotas.js');
    await instance.register(registerQuotaRoutes);

    await instance.listen({ port: 0, host: '127.0.0.1' });
    return instance;
  }

  beforeAll(async () => {
    if (!gate.available) return;
    prisma = getPrismaClient();

    app = await buildApp();
    const address = app.server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${address.port}`;

    /*
     * Everything the browser client reaches for, before it is imported. It
     * reads `window.location.origin` for its base URL and `localStorage` for
     * the token, and skips localStorage entirely when `window` is undefined --
     * so without a window stub every request here would go out unauthenticated
     * and the suite would assert on 401 bodies.
     */
    const localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    };
    const globals = globalThis as unknown as Record<string, unknown>;
    globals.localStorage = localStorage;
    globals.document = { cookie: '' };
    globals.window = {
      localStorage,
      location: { origin: baseUrl, pathname: '/dashboard', href: '/dashboard' },
    };
    process.env.NEXT_PUBLIC_API_URL = baseUrl;

    const web = await import('../../../web/src/lib/api');
    apiClient = web.apiClient;
    payload = web.payload;
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    for (const table of [
      'platform_acting_tenants',
      'platform_admins',
      'audit_logs',
      'agency_billing_profiles',
      'user_roles',
      'users',
      'roles',
      'tenants',
    ]) {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`).catch(() => {});
    }

    const ownerRole = await prisma.role.create({
      data: { name: 'OWNER', description: 'OWNER role', permissions: ['admin:*'] },
    });
    const slug = `contract-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tenant = await prisma.tenant.create({
      data: { name: 'Ridgeline Insurance', slug, status: 'ACTIVE' },
    });
    const owner = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: `principal@${slug}.local`,
        status: 'ACTIVE',
        roles: { create: { roleId: ownerRole.id } },
      },
    });
    agency = { id: tenant.id, name: tenant.name, ownerId: owner.id };

    const operator = await prisma.user.create({
      data: { email: `operator-${slug}@netenroll.test`, status: 'ACTIVE', tenantId: null },
    });
    operatorId = operator.id;
    await grantPlatformAdmin(operatorId, { note: 'contract suite fixture' });

    operatorToken = app.jwt.sign({
      userId: operatorId,
      tenantId: null,
      email: 'operator@netenroll.test',
    });
    store.set('token', operatorToken);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 1. The crash itself
  // ══════════════════════════════════════════════════════════════════════════
  describe('the agency switcher', () => {
    it('gets an array it can map over from the real endpoint', async () => {
      /*
       * THE regression test. Not "the tenants are somewhere in the body" --
       * that is what the old assertion checked and it passed throughout. This
       * asserts the exact operation the switcher performs on the exact value
       * the real client hands it.
       */
      const response = await apiClient.get<{ data: Array<{ id: string; name: string }> }>(
        '/api/v1/platform/tenants'
      );

      expect(response.error, JSON.stringify(response.error)).toBeUndefined();

      const tenants = payload(response);
      expect(Array.isArray(tenants), `payload() gave ${typeof tenants}, not an array`).toBe(true);

      // The switcher's primary action, run for real. This threw
      // "s.tenants.map is not a function" in production.
      const names = (tenants ?? []).map(tenant => tenant.name);
      expect(names).toContain('Ridgeline Insurance');
    });

    it('reads the same value the hook reads, by the same accessor', async () => {
      /*
       * The hook is not imported here -- it is a React hook and needs a
       * renderer. What is shared is the accessor: the hook calls `payload()` on
       * exactly this response, so pinning `payload()` here pins the hook's read.
       */
      const response = await apiClient.get<{ data: unknown }>('/api/v1/platform/tenants');
      const viaPayload = payload(response);
      const viaRawBody = response.data;

      // The distinction that caused the crash: the body is NOT the payload.
      expect(viaRawBody).not.toBe(viaPayload);
      expect(Array.isArray(viaRawBody)).toBe(false);
      expect(Array.isArray(viaPayload)).toBe(true);
    });

    it('leaves the list empty rather than throwing when the body is not an envelope', async () => {
      // `payload()` is the guard as well as the accessor: an unexpected shape
      // must produce "nothing to show", never an exception in a layout.
      expect(payload({ data: undefined } as any)).toBeUndefined();
      expect(payload({ data: null } as any)).toBeUndefined();
      expect(payload({ data: [1, 2, 3] } as any)).toBeUndefined();
      expect(payload({ error: { code: 'X', message: 'y' } } as any)).toBeUndefined();
      expect(payload({ data: { data: [1] } } as any)).toEqual([1]);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 2. Every platform route answers the same way
  // ══════════════════════════════════════════════════════════════════════════
  describe('the envelope is consistent', () => {
    /**
     * Every GET on the platform and delivery surface, with what a caller needs
     * to find inside the envelope.
     *
     * `/platform/context`, `POST` and `DELETE /platform/acting-tenant` used to
     * answer with a bare object while everything around them was enveloped.
     * That inconsistency inside one file is what made "which key do I read"
     * a question at all.
     */
    const ENVELOPED_GETS: Array<{ path: string; expect: (data: any) => void }> = [
      {
        path: '/api/v1/platform/context',
        expect: data => {
          expect(data.isPlatformAdmin).toBe(true);
          expect(data).toHaveProperty('actingTenant');
        },
      },
      {
        path: '/api/v1/platform/tenants',
        expect: data => expect(Array.isArray(data)).toBe(true),
      },
      {
        path: '/api/v1/platform/delivery/overview',
        expect: data => {
          expect(Array.isArray(data.agencies)).toBe(true);
          expect(typeof data.calendarDay).toBe('string');
        },
      },
      {
        /*
         * Phase 5 widened this from "one day's settlements, as an array" to a
         * filtered listing over a range, so the payload is an object carrying
         * the rows AND the filter state -- which agency, if any, and whether
         * non-production tenants are in it.
         *
         * The filter state is part of the payload rather than something the
         * page remembers, because the acting tenant can narrow the answer
         * server-side: a table that showed one agency's rows while its own
         * control said "every agency" would be a table nobody could trust.
         */
        path: '/api/v1/platform/delivery/settlements',
        expect: data => {
          expect(Array.isArray(data.settlements)).toBe(true);
          expect(data).toHaveProperty('agencyId');
          expect(typeof data.includingNonProduction).toBe('boolean');
        },
      },
    ];

    for (const route of ENVELOPED_GETS) {
      it(`${route.path} answers { data: ... } and the payload is what a caller expects`, async () => {
        const response = await apiClient.get<{ data: any }>(route.path);
        expect(response.error, `${route.path}: ${JSON.stringify(response.error)}`).toBeUndefined();

        // The body is the envelope...
        expect(Object.keys(response.data as object)).toEqual(['data']);
        // ...and the payload inside it is the shape the page renders.
        const data = payload(response as any);
        expect(data, `${route.path} produced no payload`).toBeDefined();
        route.expect(data);
      });
    }

    it('answers the same way when entering and leaving an agency', async () => {
      const entered = await apiClient.post<{ data: any }>('/api/v1/platform/acting-tenant', {
        tenantId: agency.id,
      });
      expect(entered.error).toBeUndefined();
      expect(Object.keys(entered.data as object)).toEqual(['data']);
      expect(payload(entered as any).actingTenant.id).toBe(agency.id);
      expect(payload(entered as any).appliesFrom).toBe('next-request');

      const left = await apiClient.delete<{ data: any }>('/api/v1/platform/acting-tenant');
      expect(left.error).toBeUndefined();
      expect(Object.keys(left.data as object)).toEqual(['data']);
      expect(payload(left as any).actingTenant).toBeNull();
      expect(payload(left as any).leftTenantId).toBe(agency.id);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 3. The agency-scoped views the portal renders
  // ══════════════════════════════════════════════════════════════════════════
  describe('the agency-scoped views', () => {
    beforeEach(() => {
      // Sign in as the agency principal rather than the operator.
      store.set(
        'token',
        app.jwt.sign({ userId: agency.ownerId, tenantId: agency.id, email: 'p@t.local' })
      );
    });

    const PATHS = [
      '/api/v1/delivery/today',
      '/api/v1/delivery/agents',
      '/api/v1/delivery/me',
      '/api/v1/delivery/settlements',
      '/api/v1/delivery/ledger',
      '/api/v1/delivery/mandate',
      /*
       * The settings page reads this one through `payload()`. It replaced three
       * requests naming a hardcoded placeholder tenant, so the envelope is the
       * whole contract: read as a bare body it would be `undefined` on every
       * field and the page would render "no limits set" for an agency that has
       * them -- the silent version of the bug it was built to fix.
       */
      '/api/v1/quota/summary',
    ];

    for (const path of PATHS) {
      it(`${path} answers { data: ... }`, async () => {
        const response = await apiClient.get<{ data: any }>(path);
        expect(response.error, `${path}: ${JSON.stringify(response.error)}`).toBeUndefined();
        expect(Object.keys(response.data as object)).toEqual(['data']);
        expect(payload(response as any)).toBeDefined();
      });
    }

    it('gives the delivery panel fields it can render, not undefined', async () => {
      /*
       * Read as a bare body, `today` was `undefined` on every field. The page
       * did not crash -- `enrolled` was falsy, so it rendered "Billing is not
       * enabled for this agency" for every agency, whatever its real state.
       * A silent version of the same bug, on the panel a principal reads their
       * charges from.
       */
      const response = await apiClient.get<{ data: any }>('/api/v1/delivery/today');
      const today = payload(response as any);

      expect(typeof today.enrolled).toBe('boolean');
      expect(typeof today.callsAnswered).toBe('number');
      expect(typeof today.callsInProgress).toBe('number');
      expect(today).toHaveProperty('todayClosingPct');
      expect(today).toHaveProperty('windowClosingPct');
    });

    it('gives the per-agent table an array and the agency reference figure', async () => {
      const response = await apiClient.get<{ data: any }>('/api/v1/delivery/agents');
      const breakdown = payload(response as any);

      expect(Array.isArray(breakdown.agents)).toBe(true);
      expect(breakdown).toHaveProperty('agencyClosingPct');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 4. The refusal path still works through this client
  // ══════════════════════════════════════════════════════════════════════════
  describe('refusals', () => {
    it('reports an agency principal being refused a platform route as an error, not a payload', async () => {
      store.set(
        'token',
        app.jwt.sign({ userId: agency.ownerId, tenantId: agency.id, email: 'p@t.local' })
      );

      const response = await apiClient.get<{ data: unknown }>('/api/v1/platform/tenants');

      expect(response.error?.code).toBeDefined();
      expect(response.data).toBeUndefined();
      // And `payload()` on a refusal is "nothing to render", not a throw: this
      // is the path a component takes when a call fails.
      expect(payload(response as any)).toBeUndefined();
    });
  });
});
