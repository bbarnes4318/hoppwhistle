/**
 * The FreeSWITCH CDR attributes a call to whoever ACTUALLY answered.
 *
 * inbound_route.lua reads `x_leg_party` off the leg that answered and sends it
 * as `answeredParty`. When the CDR carries it:
 *
 *   - `buyer:<id>` sets `buyerId` (a buyer of this tenant only) and nothing else;
 *   - `agent:<id>` sets `answeredByUserId` (an AGENT of this tenant only);
 *   - empty sets neither, and the call is NO_ANSWER;
 *   - `targetNumber` is the number the answered leg dialed;
 *   - the plan's `buyerId` in the body, and the route's, are ignored.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, redis } = vi.hoisted(() => ({
  prisma: {
    didRoute: { findUnique: vi.fn(), updateMany: vi.fn() },
    buyer: { findUnique: vi.fn(), findFirst: vi.fn() },
    buyerEndpoint: { findFirst: vi.fn(), findMany: vi.fn() },
    user: { findFirst: vi.fn() },
    campaignAgent: { findMany: vi.fn() },
    call: {
      create: vi.fn<[args: { data: Record<string, unknown> }], Promise<Record<string, unknown>>>(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    pendingCallDisposition: { findUnique: vi.fn(), delete: vi.fn() },
    phoneNumber: { updateMany: vi.fn() },
  },
  redis: { expire: vi.fn(), incr: vi.fn(), get: vi.fn() },
}));

vi.mock('../lib/prisma.js', () => ({ getPrismaClient: () => prisma }));
vi.mock('../lib/internal-auth.js', () => ({ requireInternalKey: async () => {} }));
vi.mock('../services/number-pool-service.js', () => ({
  numberPoolService: { getRouteInfo: vi.fn(() => Promise.resolve(null)) },
}));
vi.mock('../services/carrier-routing.js', () => ({
  getInboundCarrierChain: vi.fn(),
  gatewayFromChannelName: vi.fn(() => null),
  recordGatewayOutcome: vi.fn(),
}));
vi.mock('../services/billing/delivery-gate.js', () => ({ isDeliveryAllowed: vi.fn() }));
vi.mock('../services/blocked-call.js', () => ({ recordBlockedCall: vi.fn() }));
vi.mock('../services/tcpa-validation-service.js', () => ({ tcpaValidationService: {} }));
vi.mock('../services/redis.js', () => ({ getRedisClient: () => redis }));
vi.mock('../services/billing-service.js', () => ({
  billingService: { calculateCallBilling: vi.fn() },
}));
vi.mock('../services/buyer-billing-service.js', () => ({
  buyerBillingService: { processCallBilling: vi.fn() },
}));
vi.mock('../services/event-bus.js', () => ({ eventBus: { publish: vi.fn() } }));
vi.mock('../services/applications/agent-entry.js', () => ({ recordAgentApplication: vi.fn() }));

import { registerDidRouteRoutes } from '../routes/did-routes.js';

const TENANT = 'agency-a';
const BUYER = 'buyer-1';
const PLAN_BUYER = 'buyer-first-leg';
const AGENT = '4b0e1c2a-1111-4222-8333-944455556666';

const BUYERS: Record<string, { id: string; name: string; tenantId: string }> = {
  [BUYER]: { id: BUYER, name: 'Acme Insurance', tenantId: TENANT },
  [PLAN_BUYER]: { id: PLAN_BUYER, name: 'First Leg Buyer', tenantId: TENANT },
  'buyer-other-agency': { id: 'buyer-other-agency', name: 'Elsewhere', tenantId: 'agency-b' },
};

const AGENTS: Record<string, { id: string; tenantId: string; roles: string[] }> = {
  [AGENT]: { id: AGENT, tenantId: TENANT, roles: ['AGENT'] },
  'owner-1': { id: 'owner-1', tenantId: TENANT, roles: ['OWNER'] },
};

function cdr(overrides: Record<string, unknown> = {}) {
  return {
    callId: '6f1c2d3e-aaaa-4bbb-8ccc-123456789abc',
    routeId: 'route-1',
    tenantId: TENANT,
    callerNumber: '+14235551212',
    did: '+18885550123',
    destination: '+18005550100|1043',
    buyerId: PLAN_BUYER,
    campaignId: 'c-1',
    duration: 95,
    connectedDuration: 80,
    hangupCause: 'NORMAL_CLEARING',
    startedAt: '2026-09-24T15:00:00Z',
    answeredAt: '2026-09-24T15:00:15Z',
    endedAt: '2026-09-24T15:01:35Z',
    bridgeChannelName: 'sofia/gateway/fractel1/18005550100',
    answeredParty: `buyer:${BUYER}`,
    answeredNumber: '+18005550100',
    answeredTarget: 'ep-1',
    ...overrides,
  };
}

let app: FastifyInstance;

beforeEach(async () => {
  vi.clearAllMocks();
  prisma.didRoute.findUnique.mockResolvedValue({
    phoneNumberId: null,
    buyerId: PLAN_BUYER,
    campaignId: 'c-1',
    publisherId: null,
    tenantId: TENANT,
    label: 'Route label',
  });
  prisma.buyer.findFirst.mockImplementation(
    ({ where }: { where: { id: string; tenantId: string } }) => {
      const buyer = BUYERS[where.id];
      return Promise.resolve(
        buyer && buyer.tenantId === where.tenantId ? { id: buyer.id, name: buyer.name } : null
      );
    }
  );
  prisma.user.findFirst.mockImplementation(
    ({
      where,
    }: {
      where: { id: string; tenantId: string; roles: { some: { role: { name: string } } } };
    }) => {
      const user = AGENTS[where.id];
      const role = where.roles.some.role.name;
      return Promise.resolve(
        user && user.tenantId === where.tenantId && user.roles.includes(role)
          ? { id: user.id }
          : null
      );
    }
  );
  prisma.buyerEndpoint.findFirst.mockImplementation(
    ({ where }: { where: { id: string; buyerId: string } }) =>
      Promise.resolve(
        where.id === 'ep-1' && where.buyerId === BUYER
          ? {
              id: 'ep-1',
              destination: '+18005550100',
              capPeriod: 'DAY',
              timezone: 'America/New_York',
              maxCap: 10,
            }
          : null
      )
  );
  prisma.buyerEndpoint.findMany.mockResolvedValue([]);
  prisma.call.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: 'call-1', ...data })
  );
  prisma.call.findUnique.mockResolvedValue(null);
  prisma.pendingCallDisposition.findUnique.mockResolvedValue(null);
  redis.incr.mockResolvedValue(1);

  app = Fastify();
  await registerDidRouteRoutes(app);
  await app.ready();
});

async function post(body: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/api/v1/freeswitch/cdr', payload: body });
}

function createdCall(): Record<string, unknown> {
  return prisma.call.create.mock.calls[0][0].data;
}

describe('POST /api/v1/freeswitch/cdr with answeredParty', () => {
  it('buyer:X sets buyerId = X and answeredByUserId null', async () => {
    const response = await post(cdr());

    expect(response.statusCode).toBe(201);
    expect(createdCall().buyerId).toBe(BUYER);
    expect(createdCall().buyerName).toBe('Acme Insurance');
    expect(createdCall().answeredByUserId).toBeNull();
    expect(createdCall().targetId).toBe('ep-1');
  });

  it('credits the buyer that answered, not the first leg of the plan', async () => {
    await post(cdr());
    // The body and the route both name PLAN_BUYER; neither is who answered.
    expect(createdCall().buyerId).not.toBe(PLAN_BUYER);
  });

  it('writes the one number that answered as targetNumber', async () => {
    await post(cdr());
    expect(createdCall().targetNumber).toBe('+18005550100');
  });

  it('agent:Y sets answeredByUserId = Y and buyerId null', async () => {
    await post(
      cdr({ answeredParty: `agent:${AGENT}`, answeredNumber: '1043', answeredTarget: '' })
    );

    expect(createdCall().answeredByUserId).toBe(AGENT);
    expect(createdCall().buyerId).toBeNull();
    expect(createdCall().targetNumber).toBe('1043');
    expect(createdCall().metadata).toMatchObject({
      answeredByAgentId: AGENT,
      answeredVia: 'softphone',
    });
  });

  it('empty sets neither, and the call is NO_ANSWER', async () => {
    await post(
      cdr({
        answeredParty: '',
        answeredNumber: '',
        answeredTarget: '',
        answeredAt: '',
        hangupCause: 'NO_USER_RESPONSE',
      })
    );

    expect(createdCall().buyerId).toBeNull();
    expect(createdCall().answeredByUserId).toBeNull();
    expect(createdCall().status).toBe('NO_ANSWER');
    expect(createdCall().answeredAt).toBeNull();
  });

  it('records NO_USER_RESPONSE as NO_ANSWER', async () => {
    await post(cdr({ answeredParty: '', answeredAt: '', hangupCause: 'NO_USER_RESPONSE' }));
    expect(createdCall().status).toBe('NO_ANSWER');
  });

  it('ignores a buyer id from another tenant', async () => {
    const response = await post(cdr({ answeredParty: 'buyer:buyer-other-agency' }));

    expect(response.statusCode).toBe(201);
    expect(createdCall().buyerId).toBeNull();
    expect(prisma.buyer.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'buyer-other-agency', tenantId: TENANT } })
    );
  });

  it('ignores an agent id that is not an AGENT of this tenant', async () => {
    await post(cdr({ answeredParty: 'agent:owner-1', answeredNumber: '1043' }));
    expect(createdCall().answeredByUserId).toBeNull();
    expect(createdCall().buyerId).toBeNull();
  });

  it("counts the call against the answering endpoint's cap", async () => {
    await post(cdr());
    expect(redis.incr).toHaveBeenCalledWith(
      expect.stringMatching(/^routing:cap:ep-1:DAY:\d{4}-\d{2}-\d{2}$/)
    );
  });

  it('counts nothing against a cap when an agent answered', async () => {
    await post(cdr({ answeredParty: `agent:${AGENT}`, answeredNumber: '1043' }));
    expect(redis.incr).not.toHaveBeenCalled();
  });

  it('resolves the endpoint by the answered number when the leg named no target', async () => {
    prisma.buyerEndpoint.findMany.mockResolvedValue([
      {
        id: 'ep-9',
        destination: '1-800-555-0100',
        capPeriod: 'HOUR',
        timezone: null,
        maxCap: 0,
      },
    ]);
    await post(cdr({ answeredTarget: '' }));
    expect(createdCall().targetId).toBe('ep-9');
  });
});

describe('a pending softphone disposition', () => {
  it('is merged into the call the CDR creates, and no second row is made', async () => {
    prisma.pendingCallDisposition.findUnique.mockResolvedValue({
      id: 'pending-1',
      tenantId: TENANT,
      callSid: 'fs-6f1c2d3e-aaaa-4bbb-8ccc-123456789abc',
      userId: AGENT,
      disposition: 'NOT_INTERESTED',
      notes: 'Wanted a quote only',
      callSource: 'SOFTPHONE',
      followUpAt: null,
      duration: 64,
      application: null,
    });
    prisma.call.findUnique.mockResolvedValue({ answeredByUserId: AGENT });

    await post(cdr({ answeredParty: `agent:${AGENT}`, answeredNumber: '1043' }));

    expect(prisma.call.create).toHaveBeenCalledTimes(1);
    expect(prisma.pendingCallDisposition.findUnique).toHaveBeenCalledWith({
      where: {
        tenantId_callSid: {
          tenantId: TENANT,
          callSid: 'fs-6f1c2d3e-aaaa-4bbb-8ccc-123456789abc',
        },
      },
    });
    const updates = prisma.call.update.mock.calls as unknown as Array<
      [{ where: unknown; data: Record<string, unknown> }]
    >;
    const merged = updates.map(([args]) => args).find(args => args.data.disposition !== undefined);
    expect(merged?.where).toEqual({ id: 'call-1' });
    expect(merged?.data).toMatchObject({
      disposition: 'NOT_INTERESTED',
      dispositionNotes: 'Wanted a quote only',
      callSource: 'SOFTPHONE',
    });
    expect(prisma.pendingCallDisposition.delete).toHaveBeenCalledWith({
      where: { id: 'pending-1' },
    });
  });
});
