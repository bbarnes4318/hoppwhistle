/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any -- assertions over a mocked Prisma call's arguments */
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
    phoneNumber: { updateMany: vi.fn(), findFirst: vi.fn() },
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
  // The real parser: the point here is which gateway the CDR names.
  gatewayFromChannelName: vi.fn((name?: string | null) =>
    name ? (/^sofia\/gateway\/([^/]+)\//.exec(name)?.[1] ?? null) : null
  ),
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
import { recordGatewayOutcome } from '../services/carrier-routing.js';

/**
 * An inbound call to a Vonage DID, through the same CDR path as every other
 * carrier's.
 *
 * A Vonage number forwards by SIP into FreeSWITCH's public context and is
 * routed by inbound_route.lua exactly like a FracTEL or BulkVS DID — there is
 * no Vonage-specific inbound stack. What this pins is that its CDR is a normal
 * CDR (recording, duration, answer time, hangup cause, tenant, campaign,
 * agent) and that it records both carriers involved: Vonage as the one that
 * delivered the call, and the gateway that actually carried the forward leg.
 */

const TENANT = 'agency-a';
const AGENT = '4b0e1c2a-1111-4222-8333-944455556666';

function cdr(overrides: Record<string, unknown> = {}) {
  return {
    callId: '6f1c2d3e-aaaa-4bbb-8ccc-123456789abc',
    routeId: 'route-1',
    tenantId: TENANT,
    callerNumber: '+14235551212',
    did: '+14155550100',
    destination: '1043',
    campaignId: 'c-1',
    duration: 95,
    connectedDuration: 80,
    hangupCause: 'NORMAL_CLEARING',
    startedAt: '2026-09-24T15:00:00Z',
    answeredAt: '2026-09-24T15:00:15Z',
    endedAt: '2026-09-24T15:01:35Z',
    recordingPath: '/recordings/6f1c2d3e.wav',
    bridgeChannelName: 'sofia/gateway/vonage/18005550100',
    answeredParty: `agent:${AGENT}`,
    answeredNumber: '1043',
    answeredTarget: '',
    ...overrides,
  };
}

let app: FastifyInstance;

beforeEach(async () => {
  vi.clearAllMocks();
  prisma.didRoute.findUnique.mockResolvedValue({
    phoneNumberId: 'pn-vonage',
    buyerId: null,
    campaignId: 'c-1',
    publisherId: null,
    tenantId: TENANT,
    label: 'Vonage DID',
  });
  prisma.phoneNumber.findFirst.mockImplementation(
    ({ where }: { where: { id: string; tenantId: string } }) =>
      Promise.resolve(
        where.id === 'pn-vonage' && where.tenantId === TENANT ? { provider: 'vonage' } : null
      )
  );
  prisma.user.findFirst.mockResolvedValue({ id: AGENT });
  prisma.buyer.findFirst.mockResolvedValue(null);
  prisma.buyerEndpoint.findFirst.mockResolvedValue(null);
  prisma.buyerEndpoint.findMany.mockResolvedValue([]);
  prisma.campaignAgent.findMany.mockResolvedValue([]);
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

const post = (body: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/api/v1/freeswitch/cdr', payload: body });
const createdCall = (): Record<string, any> => prisma.call.create.mock.calls[0][0].data;

describe('CDR for an inbound call to a Vonage DID', () => {
  it('is an ordinary inbound CDR: tenant, campaign, agent, timing, cause and recording', async () => {
    const response = await post(cdr());
    expect(response.statusCode).toBe(201);
    expect(createdCall()).toMatchObject({
      tenantId: TENANT,
      direction: 'INBOUND',
      status: 'COMPLETED',
      did: '+14155550100',
      callerId: '+14235551212',
      campaignId: 'c-1',
      fromNumberId: 'pn-vonage',
      duration: 95,
      connectedDuration: 80,
      recordingStatus: 'PENDING',
      answeredByUserId: AGENT,
      terminationCause: 'NORMAL_CLEARING',
    });
    expect(createdCall().answeredAt).toEqual(new Date('2026-09-24T15:00:15Z'));
  });

  it('records Vonage as the delivering carrier and the gateway that connected the forward leg', async () => {
    await post(cdr());
    expect(createdCall().metadata.carrier).toEqual({
      inboundProvider: 'vonage',
      gateway: 'vonage',
    });
    expect(recordGatewayOutcome).toHaveBeenCalledWith(
      'vonage',
      { ok: true, cause: 'NORMAL_CLEARING' },
      TENANT
    );
  });

  it('names no connecting gateway when nobody answered', async () => {
    await post(
      cdr({
        answeredAt: undefined,
        answeredParty: '',
        hangupCause: 'NO_ANSWER',
        recordingPath: undefined,
      })
    );
    expect(createdCall().status).toBe('NO_ANSWER');
    expect(createdCall().metadata.carrier).toEqual({ inboundProvider: 'vonage', gateway: null });
  });

  it("never reads the provider of another tenant's number", async () => {
    prisma.didRoute.findUnique.mockResolvedValue({
      phoneNumberId: 'pn-vonage',
      buyerId: null,
      campaignId: 'c-1',
      publisherId: null,
      tenantId: 'agency-b',
      label: null,
    });
    await post(cdr({ tenantId: 'agency-b' }));
    expect(createdCall().metadata?.carrier?.inboundProvider ?? null).toBeNull();
  });
});
