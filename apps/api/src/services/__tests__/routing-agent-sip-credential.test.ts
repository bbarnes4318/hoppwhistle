/**
 * Which source routing believes for an agent's SIP extension.
 *
 * ── Why there are two sources at all ─────────────────────────────────────────
 *
 * An agent's extension used to live in `users.metadata.extension`, allocated
 * from a per-AGENCY scan of the range 1000..1019 against a FreeSWITCH directory
 * that has no tenant dimension. Every agency past the first was therefore
 * handed extensions another agency already held. `agent_sip_credentials` fixes
 * that with an index that is unique across the platform, and the migration
 * claimed each agent's existing extension WHERE IT WAS STILL FREE -- oldest
 * user wins, everyone else is reallocated on their next credential fetch.
 *
 * So for a while the two disagree, and the disagreement is not noise: it is
 * exactly the set of agents whose `metadata.extension` still names a number
 * that now belongs to somebody in ANOTHER AGENCY. Believing metadata there
 * routes this agency's call to that agency's agent -- the original defect,
 * surviving the fix that was supposed to close it.
 *
 * Hence the two rules asserted below: a credential always beats metadata, and
 * metadata may never claim an extension a credential has already mapped.
 *
 * ── And the fallback has to keep working ─────────────────────────────────────
 *
 * An agent who has not opened the softphone since this shipped has no
 * credential row. They still have to be reachable, so metadata still resolves
 * for them -- and a failure reading the credential table degrades to that same
 * path rather than taking the licence gate down with it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  campaignBuyer: { findMany: vi.fn() },
  user: { findMany: vi.fn() },
  phoneNumber: { findMany: vi.fn() },
  call: { count: vi.fn() },
  agentSipCredential: { findMany: vi.fn() },
  campaignAgent: { findMany: vi.fn() },
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

import { RoutingService } from '../routing.js';

/** One campaign assignment pointing at a softphone extension. */
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

interface Scenario {
  users: Array<{ id: string; metadata: Record<string, unknown> }>;
  credentials: Array<{ userId: string; extension: string }>;
  destinations: string[];
  callerState?: string | null;
  credentialError?: Error;
}

async function eligibleExtensions(scenario: Scenario): Promise<string[]> {
  prisma.campaignBuyer.findMany.mockResolvedValue(scenario.destinations.map(assignment));
  prisma.user.findMany.mockResolvedValue(scenario.users);
  prisma.phoneNumber.findMany.mockResolvedValue([]);
  prisma.call.count.mockResolvedValue(0);
  // These suites reach agents through a campaign BUYER destination. Agents
  // assigned through `campaign_agents` are a separate source, covered by
  // routing-campaign-agent.test.ts.
  prisma.campaignAgent.findMany.mockResolvedValue([]);

  if (scenario.credentialError) {
    prisma.agentSipCredential.findMany.mockRejectedValue(scenario.credentialError);
  } else {
    prisma.agentSipCredential.findMany.mockResolvedValue(scenario.credentials);
  }

  const service = new RoutingService();
  const eligible = await service.getEligibleEndpoints('tenant-1', 'campaign-1', {
    callerId: '+14235551212',
    callerState: scenario.callerState ?? null,
  });
  return eligible.map(ep => ep.destination).sort();
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('a credential beats metadata', () => {
  it('holds the credential holder to their licence, not the stale metadata owner', async () => {
    /*
     * The collision the migration leaves behind. `u-old` kept 1000 as a
     * credential and is licensed in TN. `u-stale` is a DIFFERENT agent whose
     * metadata still says 1000 -- the number it was allocated before the index
     * went global -- and who is licensed only in FL.
     *
     * The call is from TN. Believing metadata maps 1000 to `u-stale`, whose FL
     * licence excludes them, and the licensed agent's phone never rings. The
     * credential is the truth, so 1000 is `u-old` and the call connects.
     */
    const eligible = await eligibleExtensions({
      users: [
        { id: 'u-old', metadata: { extension: '1000', licensedStates: ['TN'] } },
        { id: 'u-stale', metadata: { extension: '1000', licensedStates: ['FL'] } },
      ],
      credentials: [{ userId: 'u-old', extension: '1000' }],
      destinations: ['1000'],
      callerState: 'TN',
    });

    expect(eligible).toEqual(['1000']);
  });

  it('excludes the credential holder when THEIR licence does not cover the caller', async () => {
    // The mirror image, so the assertion above cannot pass by the gate simply
    // being off: same shape, licences swapped, and the call must not connect.
    const eligible = await eligibleExtensions({
      users: [
        { id: 'u-old', metadata: { extension: '1000', licensedStates: ['FL'] } },
        { id: 'u-stale', metadata: { extension: '1000', licensedStates: ['TN'] } },
      ],
      credentials: [{ userId: 'u-old', extension: '1000' }],
      destinations: ['1000'],
      callerState: 'TN',
    });

    expect(eligible).toEqual([]);
  });

  it('ignores an agents stale metadata extension in favour of their issued one', async () => {
    /*
     * One agent, reallocated. Their credential says 1001; their metadata still
     * says 1000, which now belongs to another agency. A campaign assignment
     * naming 1001 must resolve to them and be held to their licence.
     */
    const eligible = await eligibleExtensions({
      users: [{ id: 'u-moved', metadata: { extension: '1000', licensedStates: ['FL'] } }],
      credentials: [{ userId: 'u-moved', extension: '1001' }],
      destinations: ['1001'],
      callerState: 'TN',
    });

    expect(eligible).toEqual([]);
  });
});

describe('metadata still resolves an agent who has no credential', () => {
  it('rings an unprovisioned agent', async () => {
    // Nobody has opened the softphone since this shipped. They must still work.
    const eligible = await eligibleExtensions({
      users: [{ id: 'u-legacy', metadata: { extension: '1005', licensedStates: ['TN'] } }],
      credentials: [],
      destinations: ['1005'],
      callerState: 'TN',
    });

    expect(eligible).toEqual(['1005']);
  });

  it('keeps the licence gate working when the credential table cannot be read', async () => {
    /*
     * Code deployed ahead of the migration: `agent_sip_credentials` does not
     * exist. The read is in its own try/catch precisely so this degrades to the
     * metadata path instead of throwing into the enclosing handler, which fails
     * OPEN and would skip the licence gate for every call on the platform.
     *
     * An unlicensed agent must still not be rung.
     */
    const eligible = await eligibleExtensions({
      users: [{ id: 'u-legacy', metadata: { extension: '1005', licensedStates: ['FL'] } }],
      credentials: [],
      destinations: ['1005'],
      callerState: 'TN',
      credentialError: new Error('relation "agent_sip_credentials" does not exist'),
    });

    expect(eligible).toEqual([]);
  });
});
