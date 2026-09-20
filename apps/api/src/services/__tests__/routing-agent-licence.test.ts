import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The licence gate in `getEligibleEndpoints`.
 *
 * Until this existed, `metadata.licensedStates` decided which CRM leads an
 * agent could open and decided NOTHING about calls -- so the same agent the CRM
 * refused a Tennessee lead would be rung by a Tennessee caller and would sell
 * to them on the phone. These cases are the gate that closed that, and the two
 * deliberate holes in it.
 *
 * The existing routing suites mock `getEligibleEndpoints` wholesale, which is
 * right for what they test (how a route string is assembled) and useless here:
 * the gate lives INSIDE that method. So this mocks the data layer underneath it
 * and runs the real filter.
 */

/*
 * `vi.hoisted`, because `vi.mock` is hoisted above every `const` in this file
 * and `routing.ts` constructs a module-level RoutingService on import -- so the
 * mock factory runs before a plain `const prisma = {...}` exists and throws
 * "Cannot access 'prisma' before initialization".
 */
const prisma = vi.hoisted(() => ({
  campaignBuyer: { findMany: vi.fn() },
  user: { findMany: vi.fn() },
  phoneNumber: { findMany: vi.fn() },
  call: { count: vi.fn() },
  /*
   * These suites model the LEGACY mapping, where an agent's extension lives in
   * `users.metadata.extension`. Routing now prefers `agent_sip_credentials` and
   * falls back to metadata for an agent who has no credential row, so every
   * agent here is an agent without one -- which is what an empty result means.
   */
  agentSipCredential: { findMany: vi.fn() },
}));

vi.mock('../../lib/prisma.js', () => ({ getPrismaClient: () => prisma }));

vi.mock('../../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// The geo layer is exercised by its own suite. Here the caller's state is an
// input to the gate, so it is injected directly via `callData.callerState`.
vi.mock('../../lib/geo.js', () => ({
  extractAreaCode: vi.fn(() => null),
  getStateFromAreaCode: vi.fn(() => null),
  isCallerStateAccepted: vi.fn(() => true),
}));

vi.mock('../buyer-live-status-service.js', () => ({
  liveStatusService: { getTargetsLiveStatus: vi.fn(async () => new Map()) },
}));

vi.mock('../redis.js', () => ({
  getRedisClient: () => ({ get: vi.fn(async () => null) }),
}));

import { RoutingService } from '../routing.js';

/**
 * One campaign assignment pointing at an agent's softphone extension.
 *
 * Shaped as the query returns it: the destination and the weight are columns on
 * the CampaignBuyer row, and only the concurrency and accepted-states
 * configuration comes from the joined endpoint.
 */
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

/** An active user with a softphone extension and, optionally, a licence. */
function agent(id: string, extension: string, licensedStates?: string[]) {
  return {
    id,
    metadata: licensedStates === undefined ? { extension } : { extension, licensedStates },
  };
}

async function eligibleExtensions(
  users: ReturnType<typeof agent>[],
  extensions: string[],
  callerState: string | null
): Promise<string[]> {
  prisma.campaignBuyer.findMany.mockResolvedValue(extensions.map(assignment));
  prisma.user.findMany.mockResolvedValue(users);
  prisma.phoneNumber.findMany.mockResolvedValue([]);
  prisma.agentSipCredential.findMany.mockResolvedValue([]);
  prisma.call.count.mockResolvedValue(0);

  const service = new RoutingService();
  const eligible = await service.getEligibleEndpoints('tenant-1', 'campaign-1', {
    callerId: '+14235551212',
    callerState,
  });
  return eligible.map(ep => ep.destination).sort();
}

describe('routing excludes an agent from a state they are not licensed in', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rings the licensed agent and not the unlicensed one', async () => {
    const eligible = await eligibleExtensions(
      [agent('u-tn', '1000', ['TN']), agent('u-fl', '1001', ['FL'])],
      ['1000', '1001'],
      'TN'
    );

    expect(eligible).toEqual(['1000']);
  });

  it('rings an agent licensed in several states for any of them', async () => {
    const both = [agent('u-multi', '1000', ['TN', 'GA', 'FL'])];

    expect(await eligibleExtensions(both, ['1000'], 'GA')).toEqual(['1000']);
    expect(await eligibleExtensions(both, ['1000'], 'FL')).toEqual(['1000']);
    expect(await eligibleExtensions(both, ['1000'], 'TX')).toEqual([]);
  });

  it('reads a stored licence through the same normaliser the CRM uses', async () => {
    // Lower case and padded: a row written by hand, or by an older client.
    const sloppy = [agent('u-tn', '1000', [' tn ', 'ga'] as string[])];

    expect(await eligibleExtensions(sloppy, ['1000'], 'TN')).toEqual(['1000']);
    expect(await eligibleExtensions(sloppy, ['1000'], 'GA')).toEqual(['1000']);
    expect(await eligibleExtensions(sloppy, ['1000'], 'TX')).toEqual([]);
  });
});

/**
 * The two holes, both deliberate, both load-bearing.
 *
 * Getting either of these wrong does not produce a compliance failure -- it
 * produces silence on the phones, which is why each has a case of its own.
 */
describe('the licence gate fails open where it has no fact to act on', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /*
   * THE ONE THAT WOULD TAKE THE FLOOR DOWN. There is no licence data to
   * back-fill from (docs/AGENT_LICENSED_STATES_ROLLOUT.md), so every agent
   * starts unconfigured. Deny-by-default here would exclude every agent from
   * every state-identified call on the first deploy.
   */
  it('does not filter an agent with no licence recorded', async () => {
    const noKey = await eligibleExtensions([agent('u-none', '1000')], ['1000'], 'TN');
    expect(noKey).toEqual(['1000']);

    const emptyList = await eligibleExtensions([agent('u-empty', '1000', [])], ['1000'], 'TN');
    expect(emptyList).toEqual(['1000']);
  });

  it('still holds a configured agent to their licence while others are unconfigured', async () => {
    const eligible = await eligibleExtensions(
      [agent('u-none', '1000'), agent('u-fl', '1001', ['FL'])],
      ['1000', '1001'],
      'TN'
    );

    // The unconfigured agent is not filtered; the one who told us FL is.
    expect(eligible).toEqual(['1000']);
  });

  /*
   * A withheld ANI, or an area code that resolves to nothing. Excluding
   * licensed agents from those calls would drop traffic on a fact nobody
   * established.
   */
  it('passes every licence when the call has no resolved state', async () => {
    const eligible = await eligibleExtensions(
      [agent('u-tn', '1000', ['TN']), agent('u-fl', '1001', ['FL'])],
      ['1000', '1001'],
      null
    );

    expect(eligible).toEqual(['1000', '1001']);
  });

  /*
   * An endpoint that resolves to no user at all -- an external buyer, a cell
   * phone. A licence is a fact about a person; there is no person here.
   */
  it('does not filter a destination that is not an agent', async () => {
    prisma.campaignBuyer.findMany.mockResolvedValue([assignment('+18005551212')]);
    prisma.user.findMany.mockResolvedValue([agent('u-tn', '1000', ['TN'])]);
    prisma.phoneNumber.findMany.mockResolvedValue([]);
    prisma.agentSipCredential.findMany.mockResolvedValue([]);
    prisma.call.count.mockResolvedValue(0);

    const service = new RoutingService();
    const eligible = await service.getEligibleEndpoints('tenant-1', 'campaign-1', {
      callerId: '+14235551212',
      callerState: 'TX',
    });

    expect(eligible.map(ep => ep.destination)).toEqual(['+18005551212']);
  });
});
