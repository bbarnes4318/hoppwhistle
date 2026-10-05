/**
 * A DID shared across agencies.
 *
 *   - The lookup routes it through the group's round-robin plan, gated per
 *     member agency rather than by the DID owner's delivery gate.
 *   - The CDR records the call under the agency whose agent ANSWERED it:
 *     that agency's tenant and its campaign in the group. A call nobody
 *     answered stays with the DID's owner.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, redis, shared, deliveryGate } = vi.hoisted(() => ({
  prisma: {
    didRoute: { findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
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
    phoneNumber: { updateMany: vi.fn(), findFirst: vi.fn() },
  },
  redis: { expire: vi.fn(), incr: vi.fn(), get: vi.fn() },
  shared: {
    selectSharedRoundRobin: vi.fn(),
    resolveSharedAnswerer: vi.fn(),
    markAnswered: vi.fn(),
  },
  deliveryGate: { isDeliveryAllowed: vi.fn() },
}));

vi.mock('../lib/prisma.js', () => ({ getPrismaClient: () => prisma }));
vi.mock('../lib/internal-auth.js', () => ({ requireInternalKey: async () => {} }));
vi.mock('../services/number-pool-service.js', () => ({
  numberPoolService: { getRouteInfo: vi.fn(() => Promise.resolve(null)) },
}));
vi.mock('../services/carrier-routing.js', () => ({
  getInboundCarrierChain: vi.fn(() => Promise.resolve({ gatewaysCsv: '', bridgeTemplate: '' })),
  gatewayFromChannelName: vi.fn(() => null),
  recordGatewayOutcome: vi.fn(),
}));
vi.mock('../services/billing/delivery-gate.js', () => deliveryGate);
vi.mock('../services/blocked-call.js', () => ({ recordBlockedCall: vi.fn() }));
vi.mock('../services/tcpa-validation-service.js', () => ({
  tcpaValidationService: {
    validateNumber: vi.fn(() => Promise.resolve({ isLitigator: false })),
  },
}));
vi.mock('../services/redis.js', () => ({ getRedisClient: () => redis }));
vi.mock('../services/billing-service.js', () => ({
  billingService: { calculateCallBilling: vi.fn() },
}));
vi.mock('../services/buyer-billing-service.js', () => ({
  buyerBillingService: { processCallBilling: vi.fn() },
}));
vi.mock('../services/event-bus.js', () => ({ eventBus: { publish: vi.fn() } }));
vi.mock('../services/applications/agent-entry.js', () => ({ recordAgentApplication: vi.fn() }));
vi.mock('../services/shared-routing.js', () => shared);

import { registerDidRouteRoutes } from '../routes/did-routes.js';

const OWNER = 'agency-owner';
const AGENCY_B = 'agency-b';
const GROUP = 'group-1';
const AGENT_B = '4b0e1c2a-1111-4222-8333-944455556666';
const AGENT_OUTSIDER = '5c1f2d3b-1111-4222-8333-944455556666';

const AGENTS: Record<string, { tenantId: string }> = {
  [AGENT_B]: { tenantId: AGENCY_B },
  [AGENT_OUTSIDER]: { tenantId: 'agency-z' },
};

let app: FastifyInstance;

beforeEach(async () => {
  vi.clearAllMocks();
  prisma.didRoute.findFirst.mockResolvedValue({
    id: 'route-1',
    did: '+18885550123',
    destination: 'Shared',
    buyerId: null,
    campaignId: null,
    publisherId: null,
    recordingEnabled: true,
    label: 'Shared: FL/GA split',
    tenantId: OWNER,
    sharedRoutingGroupId: GROUP,
  });
  prisma.didRoute.findUnique.mockResolvedValue({
    phoneNumberId: 'pn-owner',
    buyerId: null,
    campaignId: null,
    publisherId: 'pub-owner',
    tenantId: OWNER,
    label: 'Shared: FL/GA split',
    sharedRoutingGroupId: GROUP,
  });
  prisma.user.findFirst.mockImplementation(
    ({ where }: { where: { id: string; tenantId: string } }) =>
      Promise.resolve(AGENTS[where.id]?.tenantId === where.tenantId ? { id: where.id } : null)
  );
  prisma.call.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: 'call-1', ...data })
  );
  prisma.call.findUnique.mockResolvedValue(null);
  prisma.pendingCallDisposition.findUnique.mockResolvedValue(null);
  shared.resolveSharedAnswerer.mockImplementation((_group: string, userId: string) =>
    Promise.resolve(
      AGENTS[userId]?.tenantId === AGENCY_B ? { tenantId: AGENCY_B, campaignId: 'camp-b' } : null
    )
  );
  deliveryGate.isDeliveryAllowed.mockResolvedValue({ allowed: false, reason: 'HELD' });

  app = Fastify();
  await registerDidRouteRoutes(app);
  await app.ready();
});

function cdr(overrides: Record<string, unknown> = {}) {
  return {
    callId: '6f1c2d3e-aaaa-4bbb-8ccc-123456789abc',
    routeId: 'route-1',
    tenantId: OWNER,
    callerNumber: '+14235551212',
    did: '+18885550123',
    destination: '1001|1002',
    duration: 95,
    connectedDuration: 80,
    hangupCause: 'NORMAL_CLEARING',
    startedAt: '2026-09-24T15:00:00Z',
    answeredAt: '2026-09-24T15:00:15Z',
    endedAt: '2026-09-24T15:01:35Z',
    answeredParty: `agent:${AGENT_B}`,
    answeredNumber: '1002',
    ...overrides,
  };
}

function createdCall(): Record<string, unknown> {
  return prisma.call.create.mock.calls[0][0].data;
}

describe('GET /api/v1/freeswitch/lookup on a shared DID', () => {
  it('rings the round-robin plan, not the DID owner gate', async () => {
    shared.selectSharedRoundRobin.mockResolvedValue({
      endpoint: '1002|1001',
      dialString: '[x_leg_party=agent:b]1002|[x_leg_party=agent:a]1001',
      agentCellKeys: [],
      order: ['b', 'a'],
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/freeswitch/lookup?did=%2B18885550123&caller=%2B14235551212',
    });
    const body = response.json<{ reject?: boolean; dialString?: string }>();

    expect(body.reject).toBeUndefined();
    expect(body.dialString).toBe('[x_leg_party=agent:b]1002|[x_leg_party=agent:a]1001');
    expect(shared.selectSharedRoundRobin).toHaveBeenCalledWith(GROUP, {
      callerId: '+14235551212',
    });
    // Gated per member inside shared routing; the owner's gate is not asked.
    expect(deliveryGate.isDeliveryAllowed).not.toHaveBeenCalled();
  });

  it('answers no eligible destination when no agent anywhere can take it', async () => {
    shared.selectSharedRoundRobin.mockResolvedValue(null);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/freeswitch/lookup?did=%2B18885550123&caller=%2B14235551212',
    });

    expect(response.json()).toMatchObject({ destination: '', noEligibleDestination: true });
  });
});

describe('POST /api/v1/freeswitch/cdr on a shared DID', () => {
  it("records the call under the answering agent's agency and campaign", async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/freeswitch/cdr',
      payload: cdr(),
    });

    expect(response.statusCode).toBe(201);
    expect(createdCall()).toMatchObject({
      tenantId: AGENCY_B,
      campaignId: 'camp-b',
      answeredByUserId: AGENT_B,
      // The owner's DID row and publisher are not the answering agency's.
      fromNumberId: null,
      publisherId: null,
    });
    expect(createdCall().metadata).toMatchObject({
      sharedRoute: {
        groupId: GROUP,
        ownerTenantId: OWNER,
        ownerPublisherId: 'pub-owner',
        answeredTenantId: AGENCY_B,
      },
    });
    expect(shared.markAnswered).toHaveBeenCalledWith(GROUP, AGENT_B);
  });

  it("keeps the route's counters on the DID owner's route", async () => {
    await app.inject({ method: 'POST', url: '/api/v1/freeswitch/cdr', payload: cdr() });
    expect(prisma.didRoute.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'route-1', tenantId: OWNER } })
    );
  });

  it('keeps an unanswered call with the DID owner', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/freeswitch/cdr',
      payload: cdr({ answeredAt: undefined, answeredParty: '', hangupCause: 'NO_USER_RESPONSE' }),
    });

    expect(createdCall()).toMatchObject({ tenantId: OWNER, answeredByUserId: null });
    expect(shared.resolveSharedAnswerer).not.toHaveBeenCalled();
  });

  it('keeps a call answered by someone outside the member agencies with the owner, uncredited', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/freeswitch/cdr',
      payload: cdr({ answeredParty: `agent:${AGENT_OUTSIDER}` }),
    });

    expect(createdCall()).toMatchObject({ tenantId: OWNER, answeredByUserId: null });
    expect(shared.markAnswered).not.toHaveBeenCalled();
  });
});
