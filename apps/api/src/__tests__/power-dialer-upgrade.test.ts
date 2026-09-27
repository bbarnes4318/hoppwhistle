/**
 * The Power Dialer upgrade, enforced on the server.
 *
 * The call-center console's routes and the CRM / lead-list routes are the
 * POWER_DIALER upgrade: a tenant without it is answered 403 UPGRADE_REQUIRED,
 * a tenant with it is served, and a platform admin is served either way. The
 * real route plugins are registered on a bare Fastify instance with Prisma
 * mocked, so this asserts the hook as it is wired, not a copy of it.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const UPGRADES: Record<string, string[]> = {
  'tenant-with': ['POWER_DIALER'],
  'tenant-without': ['VOICE_STUDIO'],
};

const mockPrisma = {
  tenant: {
    findUnique: vi.fn(({ where }: { where: { id: string } }) =>
      Promise.resolve({ metadata: { upgrades: UPGRADES[where.id] ?? [] } })
    ),
  },
  leadList: { findMany: vi.fn(() => Promise.resolve([])) },
  insuranceLead: { findMany: vi.fn(() => Promise.resolve([])) },
  lead: { findMany: vi.fn(() => Promise.resolve([])) },
  prospectIntake: { findMany: vi.fn(() => Promise.resolve([])) },
  call: { findMany: vi.fn(() => Promise.resolve([])) },
};

vi.mock('../lib/prisma.js', () => ({ getPrismaClient: () => mockPrisma }));
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  createServiceLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { requireUpgrade, UPGRADE_REQUIRED } from '../lib/tenant-upgrades.js';
import { registerCallCenterRoutes } from '../routes/call-center.js';
import { registerInsuranceLeadRoutes } from '../routes/insurance-leads.js';

const DIALER_ROUTE = '/api/v1/call-center/customer-lookup?phone=5550199988';
const LEAD_ROUTE = '/api/v1/lead-lists';

type Principal = { tenantId: string; isPlatformAdmin?: boolean };

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  // The principal, as the global /api/v1 authentication would have built it.
  app.addHook('onRequest', (request, _reply, done) => {
    const raw = request.headers['x-test-principal'];
    if (typeof raw === 'string') {
      (request as { user?: unknown }).user = JSON.parse(raw) as Principal;
    }
    done();
  });
  await app.register(registerCallCenterRoutes);
  await app.register(registerInsuranceLeadRoutes);
  await app.ready();
  return app;
}

describe('POWER_DIALER on the dialer and lead routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  const get = (url: string, principal: Principal) =>
    app.inject({
      method: 'GET',
      url,
      headers: { 'x-test-principal': JSON.stringify(principal) },
    });

  it.each([DIALER_ROUTE, LEAD_ROUTE])(
    'answers a tenant without the upgrade 403 UPGRADE_REQUIRED on %s',
    async url => {
      const res = await get(url, { tenantId: 'tenant-without' });
      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.body) as { error: { code: string; upgrade: string } };
      expect(body.error.code).toBe(UPGRADE_REQUIRED);
      expect(body.error.upgrade).toBe('POWER_DIALER');
      // Refused before the handler read anything of the tenant's.
      expect(mockPrisma.leadList.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.insuranceLead.findMany).not.toHaveBeenCalled();
    }
  );

  it.each([DIALER_ROUTE, LEAD_ROUTE])('serves a tenant with the upgrade on %s', async url => {
    const res = await get(url, { tenantId: 'tenant-with' });
    expect(res.statusCode).toBe(200);
  });

  it.each([DIALER_ROUTE, LEAD_ROUTE])(
    'serves a platform admin acting in a tenant without it on %s',
    async url => {
      const res = await get(url, { tenantId: 'tenant-without', isPlatformAdmin: true });
      expect(res.statusCode).toBe(200);
      // Staff are exempt without the tenant's upgrades being read at all.
      expect(mockPrisma.tenant.findUnique).not.toHaveBeenCalled();
    }
  );

  it('leaves an unauthenticated caller to the refusal the handler already gives', async () => {
    const res = await app.inject({ method: 'GET', url: LEAD_ROUTE });
    expect(res.statusCode).not.toBe(200);
    expect(res.body).not.toContain(UPGRADE_REQUIRED);
  });
});

describe('requireUpgrade', () => {
  it('honours skip, for routes that are not a screen of the upgrade', async () => {
    vi.clearAllMocks();
    const guard = requireUpgrade('POWER_DIALER', { skip: () => true });
    const reply = { code: vi.fn(), send: vi.fn() };
    const request = { user: { tenantId: 'tenant-without' } };
    await guard(request as never, reply as never);
    expect(reply.code).not.toHaveBeenCalled();
    expect(mockPrisma.tenant.findUnique).not.toHaveBeenCalled();
  });
});
