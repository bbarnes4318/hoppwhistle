/**
 * Not ringing a softphone that is not there.
 *
 * ── The two failures this sits between ───────────────────────────────────────
 *
 * Routing gated an agent on their live call count and nothing else, and the
 * comment in `routing.ts` explains why: the availability flag is written by the
 * browser, goes stale when a tab closes or a laptop sleeps, and excluding
 * agents on it silenced people who were sitting there ready.
 *
 * The cost of ignoring it is recorded in `routes/agent-phone.ts`: an agent on a
 * network that blocked 7443 fetched credentials fine, never opened the
 * WebSocket, never sent a REGISTER, "and every call to them died with
 * USER_NOT_REGISTERED while the dashboard still showed them available". Those
 * calls reached nobody AND were not offered to an agent who could have taken
 * them.
 *
 * FreeSWITCH's registration table answers the question both of those got wrong.
 *
 * ── The property that must not break ─────────────────────────────────────────
 *
 * The gate fires only on a POSITIVE "FreeSWITCH does not have this extension".
 * When the registrar cannot be read at all the service returns null and nothing
 * is filtered — because excluding every agent on the strength of an ESL blip is
 * an outage, not a safety feature. Half these tests are that direction.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  campaignBuyer: { findMany: vi.fn() },
  campaignAgent: { findMany: vi.fn() },
  user: { findMany: vi.fn() },
  phoneNumber: { findMany: vi.fn() },
  call: { count: vi.fn() },
  agentSipCredential: { findMany: vi.fn() },
}));

vi.mock('../../lib/prisma.js', () => ({ getPrismaClient: () => prisma }));

vi.mock('../../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../lib/geo.js', () => ({
  extractAreaCode: vi.fn(() => null),
  getStateFromAreaCode: vi.fn(() => null),
  isCallerStateAccepted: vi.fn(() => true),
}));

vi.mock('../buyer-live-status-service.js', () => ({
  liveStatusService: { getTargetsLiveStatus: vi.fn(() => Promise.resolve(new Map())) },
}));

vi.mock('../redis.js', () => ({
  getRedisClient: () => ({ get: vi.fn(() => Promise.resolve(null)) }),
}));

const getRegisteredExtensions = vi.hoisted(() => vi.fn<[], Promise<Set<string> | null>>());
vi.mock('../telephony/sip-registrations.js', () => ({
  getRegisteredExtensions: () => getRegisteredExtensions(),
}));

import { RoutingService } from '../routing.js';

function assignment(extension: string) {
  return {
    buyerId: `buyer-${extension}`,
    buyerEndpointId: `endpoint-${extension}`,
    destinationNumber: extension,
    priority: 0,
    weight: 100,
    buyer: { id: `buyer-${extension}`, name: `Agent ${extension}`, status: 'ACTIVE' },
    buyerEndpoint: {
      id: `endpoint-${extension}`,
      name: `Agent ${extension}`,
      status: 'ACTIVE',
      maxConcurrency: 10,
      acceptedStates: [],
      weight: 100,
    },
  };
}

async function eligibleExtensions(options: {
  extensions: string[];
  registered: Set<string> | null;
}): Promise<string[]> {
  prisma.campaignBuyer.findMany.mockResolvedValue(options.extensions.map(assignment));
  prisma.campaignAgent.findMany.mockResolvedValue([]);
  prisma.user.findMany.mockResolvedValue(
    options.extensions.map((extension, index) => ({
      id: `u-${index}`,
      metadata: { licensedStates: ['TN'] },
    }))
  );
  prisma.agentSipCredential.findMany.mockResolvedValue(
    options.extensions.map((extension, index) => ({ userId: `u-${index}`, extension }))
  );
  prisma.phoneNumber.findMany.mockResolvedValue([]);
  prisma.call.count.mockResolvedValue(0);
  getRegisteredExtensions.mockResolvedValue(options.registered);

  const eligible = await new RoutingService().getEligibleEndpoints('tenant-1', 'campaign-1', {
    callerId: '+14235551212',
    callerState: 'TN',
  });
  return eligible.map(ep => ep.destination).sort();
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('an agent whose softphone is not registered', () => {
  it('is not rung', async () => {
    const eligible = await eligibleExtensions({
      extensions: ['1000', '1042'],
      registered: new Set(['1000']),
    });

    // 1042 fetched credentials and never sent a REGISTER. A call sent there
    // dies with USER_NOT_REGISTERED and is not offered to 1000, who could have
    // taken it.
    expect(eligible).toEqual(['1000']);
  });

  it('leaves the call to the agent who IS registered', async () => {
    const eligible = await eligibleExtensions({
      extensions: ['1000', '1042', '1099'],
      registered: new Set(['1042']),
    });

    expect(eligible).toEqual(['1042']);
  });
});

describe('when the registrar cannot be read', () => {
  it('filters nothing', async () => {
    const eligible = await eligibleExtensions({
      extensions: ['1000', '1042'],
      registered: null,
    });

    /*
     * The direction that matters more. `null` is "cannot tell", and treating
     * it as "nobody is registered" would take the whole agency off the queue
     * for the duration of an ESL blip.
     */
    expect(eligible).toEqual(['1000', '1042']);
  });

  it('filters nothing when the lookup itself throws', async () => {
    getRegisteredExtensions.mockRejectedValue(new Error('unexpected'));

    prisma.campaignBuyer.findMany.mockResolvedValue([assignment('1000')]);
    prisma.campaignAgent.findMany.mockResolvedValue([]);
    prisma.user.findMany.mockResolvedValue([{ id: 'u-0', metadata: { licensedStates: ['TN'] } }]);
    prisma.agentSipCredential.findMany.mockResolvedValue([{ userId: 'u-0', extension: '1000' }]);
    prisma.phoneNumber.findMany.mockResolvedValue([]);
    prisma.call.count.mockResolvedValue(0);

    const eligible = await new RoutingService().getEligibleEndpoints('tenant-1', 'campaign-1', {
      callerId: '+14235551212',
      callerState: 'TN',
    });

    // The service is written not to throw, but routing must not depend on that
    // promise being kept.
    expect(eligible.map(ep => ep.destination)).toEqual(['1000']);
  });
});

describe('the gate does not replace the ones already there', () => {
  it('still excludes a registered agent who is unlicensed for the caller', async () => {
    prisma.campaignBuyer.findMany.mockResolvedValue([assignment('1000')]);
    prisma.campaignAgent.findMany.mockResolvedValue([]);
    prisma.user.findMany.mockResolvedValue([{ id: 'u-0', metadata: { licensedStates: ['FL'] } }]);
    prisma.agentSipCredential.findMany.mockResolvedValue([{ userId: 'u-0', extension: '1000' }]);
    prisma.phoneNumber.findMany.mockResolvedValue([]);
    prisma.call.count.mockResolvedValue(0);
    getRegisteredExtensions.mockResolvedValue(new Set(['1000']));

    const eligible = await new RoutingService().getEligibleEndpoints('tenant-1', 'campaign-1', {
      callerId: '+14235551212',
      callerState: 'TN',
    });

    // Being registered is not a licence.
    expect(eligible).toEqual([]);
  });

  it('still excludes a registered agent at their concurrency limit', async () => {
    prisma.campaignBuyer.findMany.mockResolvedValue([assignment('1000')]);
    prisma.campaignAgent.findMany.mockResolvedValue([]);
    prisma.user.findMany.mockResolvedValue([{ id: 'u-0', metadata: { licensedStates: ['TN'] } }]);
    prisma.agentSipCredential.findMany.mockResolvedValue([{ userId: 'u-0', extension: '1000' }]);
    prisma.phoneNumber.findMany.mockResolvedValue([]);
    prisma.call.count.mockResolvedValue(1);
    getRegisteredExtensions.mockResolvedValue(new Set(['1000']));

    const eligible = await new RoutingService().getEligibleEndpoints('tenant-1', 'campaign-1', {
      callerId: '+14235551212',
      callerState: 'TN',
    });

    expect(eligible).toEqual([]);
  });

  it('asks the registrar once per routing decision, not once per agent', async () => {
    await eligibleExtensions({
      extensions: ['1000', '1042', '1099', '1100'],
      registered: new Set(['1000', '1042', '1099', '1100']),
    });

    // One ESL-backed lookup for four candidates. Per-candidate would be
    // latency on the one path where it is least affordable.
    expect(getRegisteredExtensions).toHaveBeenCalledTimes(1);
  });
});
