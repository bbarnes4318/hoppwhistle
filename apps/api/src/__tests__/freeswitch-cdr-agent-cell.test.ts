/**
 * The FreeSWITCH CDR for a call answered on an agent's own cell.
 *
 *   1. It is credited to that agent (`answeredByUserId`), matched by the
 *      bridged leg's dialed number against the campaign's cell-forwarding
 *      agents, so it counts on the leaderboard and agent stats.
 *   2. A `buyerId` that is not a buyer -- routing puts the AGENT's user id
 *      there when an agent was the routed party -- is dropped rather than
 *      written, where it would violate `calls_buyerId_fkey` and lose the row.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  didRoute: { findUnique: vi.fn(), updateMany: vi.fn() },
  buyer: { findUnique: vi.fn() },
  campaignAgent: { findMany: vi.fn() },
  call: {
    create: vi.fn<[args: { data: Record<string, unknown> }], Promise<Record<string, unknown>>>(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  phoneNumber: { updateMany: vi.fn() },
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
vi.mock('../services/redis.js', () => ({ getRedisClient: () => ({ expire: vi.fn() }) }));
vi.mock('../services/billing-service.js', () => ({
  billingService: { calculateCallBilling: vi.fn() },
}));
vi.mock('../services/buyer-billing-service.js', () => ({
  buyerBillingService: { processCallBilling: vi.fn() },
}));
vi.mock('../services/event-bus.js', () => ({ eventBus: { publish: vi.fn() } }));

import { registerDidRouteRoutes } from '../routes/did-routes.js';

const AGENT_ID = '4b0e1c2a-1111-4222-8333-944455556666';

function cdr(overrides: Record<string, unknown> = {}) {
  return {
    callId: 'fs-uuid-1',
    routeId: 'route-1',
    tenantId: 'agency-a',
    callerNumber: '+14235551212',
    did: '+18885550123',
    destination: '1043,+18655551234',
    buyerId: AGENT_ID,
    campaignId: 'c-1',
    duration: 95,
    connectedDuration: 80,
    hangupCause: 'NORMAL_CLEARING',
    startedAt: '2026-09-24T15:00:00Z',
    answeredAt: '2026-09-24T15:00:15Z',
    endedAt: '2026-09-24T15:01:35Z',
    bridgeChannelName: 'sofia/gateway/fractel1/18655551234',
    ...overrides,
  };
}

let app: FastifyInstance;

beforeEach(async () => {
  vi.clearAllMocks();
  prisma.didRoute.findUnique.mockResolvedValue({
    phoneNumberId: null,
    buyerId: null,
    campaignId: 'c-1',
    publisherId: null,
    tenantId: 'agency-a',
    label: null,
  });
  prisma.buyer.findUnique.mockResolvedValue(null);
  prisma.campaignAgent.findMany.mockResolvedValue([
    { userId: AGENT_ID, user: { metadata: { cellForwardNumber: '+18655551234' } } },
    { userId: 'u-softphone', user: { metadata: {} } },
  ]);
  prisma.call.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({
      id: 'call-1',
      ...data,
    })
  );
  prisma.call.findUnique.mockResolvedValue(null);

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

describe('POST /api/v1/freeswitch/cdr for an agent cell leg', () => {
  it('credits the call to the agent whose cell answered', async () => {
    const response = await post(cdr());

    expect(response.statusCode).toBe(201);
    expect(createdCall().answeredByUserId).toBe(AGENT_ID);
    expect(createdCall().metadata).toMatchObject({
      answeredByAgentId: AGENT_ID,
      answeredVia: 'agent_cell',
    });
    expect(prisma.campaignAgent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'agency-a', campaignId: 'c-1', status: 'ACTIVE' },
      })
    );
  });

  it("does not write an agent's id as the buyer", async () => {
    await post(cdr());
    expect(createdCall().buyerId).toBeNull();
  });

  it('keeps a real buyer id', async () => {
    prisma.buyer.findUnique.mockResolvedValue({ name: 'Acme Insurance' });
    await post(
      cdr({ buyerId: 'buyer-1', bridgeChannelName: 'sofia/gateway/fractel1/18005550000' })
    );

    expect(createdCall().buyerId).toBe('buyer-1');
    expect(createdCall().buyerName).toBe('Acme Insurance');
    expect(createdCall().answeredByUserId).toBeNull();
  });

  it('attributes nothing when a softphone answered', async () => {
    await post(cdr({ bridgeChannelName: 'sofia/internal/sip:1043@10.0.0.5:5060' }));
    expect(createdCall().answeredByUserId).toBeNull();
    expect(prisma.campaignAgent.findMany).not.toHaveBeenCalled();
  });

  it('attributes nothing to an unanswered call', async () => {
    await post(cdr({ answeredAt: '', hangupCause: 'NO_ANSWER' }));
    expect(createdCall().answeredByUserId).toBeNull();
  });

  it('attributes nothing when two agents share the cell', async () => {
    prisma.campaignAgent.findMany.mockResolvedValue([
      { userId: AGENT_ID, user: { metadata: { cellForwardNumber: '+18655551234' } } },
      { userId: 'u-2', user: { metadata: { cellForwardNumber: '865-555-1234' } } },
    ]);
    await post(cdr());
    expect(createdCall().answeredByUserId).toBeNull();
  });

  it('still records the call when the lookup fails', async () => {
    prisma.campaignAgent.findMany.mockRejectedValue(new Error('db down'));
    const response = await post(cdr());
    expect(response.statusCode).toBe(201);
    expect(createdCall().answeredByUserId).toBeNull();
  });
});
