/**
 * The agent's own on/off switch, and routing obeying it.
 *
 * ── What was wrong ───────────────────────────────────────────────────────────
 *
 * An agent had no working way to stop calls reaching them. There were two
 * controls that looked like they did it and neither did:
 *
 *   * the Available/Away dropdown in the call-centre header, bound to a React
 *     `useState` and never sent anywhere; and
 *   * `AgentStatusSelector`, which does reach the server -- but writes the
 *     Redis presence key that `routing.ts` deliberately ignores, and which the
 *     softphone overwrites with an unconditional 'available' on every SIP
 *     reconnect, silently undoing the agent's choice.
 *
 * So an agent at lunch kept being rung, and the call went to somebody who could
 * not take it instead of to somebody who could.
 *
 * ── The two properties that must not break ───────────────────────────────────
 *
 *   1. OFF MEANS OFF. An agent who turned their phone off is not rung, even
 *      though they are on shift, registered and under their concurrency limit
 *      -- every other gate passes them, which is the whole point.
 *
 *   2. AVAILABLE IS THE DEFAULT, AND A GAP READS AS AVAILABLE. The flag is
 *      collected as a set of the UNAVAILABLE, so a row that fails to load reads
 *      as on-queue. Inverting it would turn any gap in the read into an agent
 *      silently taken off the queue -- the failure mode every gate in this file
 *      is written to avoid.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  campaignBuyer: { findMany: vi.fn() },
  campaignAgent: { findMany: vi.fn() },
  user: { findMany: vi.fn() },
  phoneNumber: { findMany: vi.fn() },
  call: { count: vi.fn() },
  agentSipCredential: { findMany: vi.fn() },
  agentSchedule: { findMany: vi.fn() },
  agencyProfile: { findUnique: vi.fn() },
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
  liveStatusService: { getTargetsLiveStatus: vi.fn(async () => new Map()) },
}));

/*
 * The Redis presence key, pinned to 'offline' throughout. Every agent in this
 * suite looks OFFLINE to the old flag, and the ones who have not turned
 * themselves off are still rung -- which is the property that made ignoring
 * that flag correct in the first place, and which this new gate must not undo.
 */
vi.mock('../redis.js', () => ({
  getRedisClient: () => ({
    get: vi.fn(async () => JSON.stringify({ status: 'offline' })),
  }),
}));

vi.mock('../telephony/sip-registrations.js', () => ({
  getRegisteredExtensions: vi.fn(async () => null),
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

interface Agent {
  userId: string;
  extension: string;
  /** Omitted models a row written before the column existed. */
  availableForCalls?: boolean;
  licensedStates?: string[];
}

async function eligibleExtensions(agents: Agent[], activeCalls = 0): Promise<string[]> {
  prisma.campaignBuyer.findMany.mockResolvedValue(agents.map(a => assignment(a.extension)));
  prisma.campaignAgent.findMany.mockResolvedValue([]);
  prisma.user.findMany.mockResolvedValue(
    agents.map(a => ({
      id: a.userId,
      metadata: { licensedStates: a.licensedStates ?? ['TN'] },
      availableForCalls: a.availableForCalls,
    }))
  );
  prisma.agentSipCredential.findMany.mockResolvedValue(
    agents.map(a => ({ userId: a.userId, extension: a.extension }))
  );
  prisma.phoneNumber.findMany.mockResolvedValue([]);
  prisma.call.count.mockResolvedValue(activeCalls);
  prisma.agentSchedule.findMany.mockResolvedValue([]);
  prisma.agencyProfile.findUnique.mockResolvedValue({ deliveryTimeZone: 'America/New_York' });

  const eligible = await new RoutingService().getEligibleEndpoints('tenant-1', 'campaign-1', {
    callerId: '+14235551212',
    callerState: 'TN',
  });
  return eligible.map(ep => ep.destination).sort();
}

beforeEach(() => {
  vi.clearAllMocks();
});

/* ── Off means off ─────────────────────────────────────────────────────────── */

describe('an agent who has turned their phone off', () => {
  it('is not rung', async () => {
    const eligible = await eligibleExtensions([
      { userId: 'u-1', extension: '1000', availableForCalls: false },
    ]);

    // On shift, registered, under their limit -- every other gate passes them.
    // This one is the agent's own word, and it is the point of the feature.
    expect(eligible).toEqual([]);
  });

  it('leaves the call to a colleague who is on', async () => {
    const eligible = await eligibleExtensions([
      { userId: 'u-off', extension: '1000', availableForCalls: false },
      { userId: 'u-on', extension: '1001', availableForCalls: true },
    ]);

    // The call goes to somebody who can take it, instead of to somebody who
    // cannot -- which is what happened before, twice over.
    expect(eligible).toEqual(['1001']);
  });
});

/* ── Available is the default, and a gap reads as available ────────────────── */

describe('an agent who has not turned anything off', () => {
  it('is rung', async () => {
    const eligible = await eligibleExtensions([
      { userId: 'u-1', extension: '1000', availableForCalls: true },
    ]);
    expect(eligible).toEqual(['1000']);
  });

  it('is rung when the flag is absent entirely', async () => {
    /*
     * A row written before the column existed, or one this read did not return.
     * The gate collects the UNAVAILABLE, so a gap reads as on-queue: inverting
     * it would turn any hole in this query into an agent silently taken off
     * the queue.
     */
    const eligible = await eligibleExtensions([{ userId: 'u-1', extension: '1000' }]);
    expect(eligible).toEqual(['1000']);
  });

  it('is rung even though the Redis presence key says offline', async () => {
    /*
     * The regression guard for the behaviour that made ignoring the old flag
     * correct. Every agent in this suite looks 'offline' to the Redis key --
     * a closed tab, a stale write, a reconnect that has not landed -- and an
     * agent who has not TOLD us they are off must still be rung.
     */
    const eligible = await eligibleExtensions([
      { userId: 'u-1', extension: '1000', availableForCalls: true },
    ]);
    expect(eligible).toEqual(['1000']);
  });
});

/* ── Composition ───────────────────────────────────────────────────────────── */

describe('the switch does not replace the other gates', () => {
  it('still excludes an available agent who is unlicensed for the caller', async () => {
    const eligible = await eligibleExtensions([
      { userId: 'u-1', extension: '1000', availableForCalls: true, licensedStates: ['FL'] },
    ]);

    // Being on the queue is not a licence.
    expect(eligible).toEqual([]);
  });

  it('still excludes an available agent at their concurrency limit', async () => {
    const eligible = await eligibleExtensions(
      [{ userId: 'u-1', extension: '1000', availableForCalls: true }],
      1
    );
    expect(eligible).toEqual([]);
  });

  it('excludes an agent who is off even when everything else passes', async () => {
    const eligible = await eligibleExtensions([
      { userId: 'u-1', extension: '1000', availableForCalls: false, licensedStates: ['TN'] },
    ]);
    expect(eligible).toEqual([]);
  });
});
