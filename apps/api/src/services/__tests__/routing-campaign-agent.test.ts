/**
 * An agent the AGENCY assigned, actually ringing.
 *
 * ── The gap this closes ──────────────────────────────────────────────────────
 *
 * The only way an agent could be rung was for somebody to build them a
 * `BuyerEndpoint` and attach it to the campaign — a screen an agency principal
 * cannot reach, since `lib/staff-only-routes.ts` holds `/buyers` and
 * `/campaigns`. So on a product whose premise is that an agency adds its own
 * agents, every agent needed NetEnroll staff to wire up by hand, and
 * `CampaignAgent` sat in the schema documented as "the dialer's hot read" with
 * nothing reading or writing it.
 *
 * ── The properties asserted here ─────────────────────────────────────────────
 *
 *   1. An assignment produces a destination — the agent's SIP extension.
 *   2. It is held to EVERY existing gate. An agent reached this way is not on a
 *      privileged path: licence, concurrency and account status all still
 *      apply, and the assertions below are the proof, not the claim.
 *   3. An agent with no usable softphone is not a destination. Ringing an
 *      extension that cannot register is a call into nothing, and the caller
 *      hears silence rather than being sent to somebody who can answer.
 *   4. A failure reading the assignments does not take the campaign's other
 *      destinations with it.
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
  liveStatusService: { getTargetsLiveStatus: vi.fn(async () => new Map()) },
}));

vi.mock('../redis.js', () => ({
  getRedisClient: () => ({ get: vi.fn(async () => null) }),
}));

import { RoutingService } from '../routing.js';

/** A `campaign_agents` row as the query returns it, joined to the agent. */
function assignedAgent(options: {
  userId: string;
  extension: string;
  status?: string;
  credentialStatus?: string;
  /** Null models a RESERVATION: claimed extension, no secret, cannot register. */
  passwordEncrypted?: string | null;
  priority?: number | null;
}) {
  return {
    userId: options.userId,
    priority: options.priority ?? null,
    user: {
      id: options.userId,
      status: options.status ?? 'ACTIVE',
      firstName: 'Dana',
      lastName: 'Reed',
      email: `${options.userId}@agency.test`,
      sipCredential: {
        extension: options.extension,
        status: options.credentialStatus ?? 'ACTIVE',
        passwordEncrypted:
          options.passwordEncrypted === undefined ? 'enc:v1:x:y:z' : options.passwordEncrypted,
      },
    },
  };
}

/** An active user row carrying a licence, as the gate reads it. */
function userRow(id: string, licensedStates?: string[]) {
  return {
    id,
    metadata: licensedStates === undefined ? {} : { licensedStates },
  };
}

interface Scenario {
  assignments: ReturnType<typeof assignedAgent>[];
  users: ReturnType<typeof userRow>[];
  credentials: Array<{ userId: string; extension: string }>;
  callerState?: string | null;
  activeCalls?: number;
  assignmentError?: Error;
}

async function eligibleDestinations(scenario: Scenario): Promise<string[]> {
  // No buyer endpoints at all: everything routed here came from an assignment.
  prisma.campaignBuyer.findMany.mockResolvedValue([]);
  prisma.user.findMany.mockResolvedValue(scenario.users);
  prisma.phoneNumber.findMany.mockResolvedValue([]);
  prisma.call.count.mockResolvedValue(scenario.activeCalls ?? 0);
  prisma.agentSipCredential.findMany.mockResolvedValue(scenario.credentials);

  if (scenario.assignmentError) {
    prisma.campaignAgent.findMany.mockRejectedValue(scenario.assignmentError);
  } else {
    prisma.campaignAgent.findMany.mockResolvedValue(scenario.assignments);
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

/* ── The thing that did not work at all ────────────────────────────────────── */

describe('an agency-assigned agent', () => {
  it('becomes a destination, at their own SIP extension', async () => {
    const destinations = await eligibleDestinations({
      assignments: [assignedAgent({ userId: 'u-1', extension: '1042' })],
      users: [userRow('u-1', ['TN'])],
      credentials: [{ userId: 'u-1', extension: '1042' }],
      callerState: 'TN',
    });

    // Before this, an agency could assign all day and the row was read by
    // nothing: the call had nowhere to go.
    expect(destinations).toEqual(['1042']);
  });

  it('carries the agent identity, not a buyer', async () => {
    prisma.campaignBuyer.findMany.mockResolvedValue([]);
    prisma.user.findMany.mockResolvedValue([userRow('u-1', ['TN'])]);
    prisma.phoneNumber.findMany.mockResolvedValue([]);
    prisma.call.count.mockResolvedValue(0);
    prisma.agentSipCredential.findMany.mockResolvedValue([{ userId: 'u-1', extension: '1042' }]);
    prisma.campaignAgent.findMany.mockResolvedValue([
      assignedAgent({ userId: 'u-1', extension: '1042' }),
    ]);

    const eligible = await new RoutingService().getEligibleEndpoints('tenant-1', 'campaign-1', {
      callerId: '+14235551212',
      callerState: 'TN',
    });

    // `buyerId` carries the routed party through the pipeline, and the gates
    // resolve the agent from it. A buyer id here would gate the wrong party.
    expect(eligible[0].buyerId).toBe('u-1');
    expect(eligible[0].endpointId).toBeNull();
    expect(eligible[0].buyerName).toBe('Dana Reed');
  });

  it('scopes the read to the campaign and the agency', async () => {
    await eligibleDestinations({
      assignments: [],
      users: [],
      credentials: [],
    });

    // An unscoped read would put one agency's agents on another's campaign.
    expect(prisma.campaignAgent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'tenant-1', campaignId: 'campaign-1', status: 'ACTIVE' },
      })
    );
  });
});

/* ── Still held to every gate ──────────────────────────────────────────────── */

describe('is held to the same gates as any other destination', () => {
  it('is excluded from a state they are not licensed in', async () => {
    const destinations = await eligibleDestinations({
      assignments: [assignedAgent({ userId: 'u-1', extension: '1042' })],
      users: [userRow('u-1', ['FL'])],
      credentials: [{ userId: 'u-1', extension: '1042' }],
      callerState: 'TN',
    });

    // Assignment is not a licence. An agency putting an agent on a campaign
    // must not be able to route them work they cannot legally write.
    expect(destinations).toEqual([]);
  });

  it('is excluded when at their concurrency limit', async () => {
    const destinations = await eligibleDestinations({
      assignments: [assignedAgent({ userId: 'u-1', extension: '1042' })],
      users: [userRow('u-1', ['TN'])],
      credentials: [{ userId: 'u-1', extension: '1042' }],
      callerState: 'TN',
      activeCalls: 1,
    });

    expect(destinations).toEqual([]);
  });

  it('is excluded when the account is not ACTIVE', async () => {
    const destinations = await eligibleDestinations({
      assignments: [assignedAgent({ userId: 'u-1', extension: '1042', status: 'SUSPENDED' })],
      users: [userRow('u-1', ['TN'])],
      credentials: [{ userId: 'u-1', extension: '1042' }],
      callerState: 'TN',
    });

    // Suspending an agent has to stop their phone, not just their login.
    expect(destinations).toEqual([]);
  });
});

/* ── Nothing that cannot answer ────────────────────────────────────────────── */

describe('an agent with no usable softphone', () => {
  it('is not a destination when they have no credential', async () => {
    const destinations = await eligibleDestinations({
      assignments: [
        {
          userId: 'u-1',
          priority: null,
          user: {
            id: 'u-1',
            status: 'ACTIVE',
            firstName: 'Dana',
            lastName: 'Reed',
            email: 'u-1@agency.test',
            sipCredential: null,
          },
        },
      ],
      users: [userRow('u-1', ['TN'])],
      credentials: [],
      callerState: 'TN',
    });

    expect(destinations).toEqual([]);
  });

  it('is not a destination on a RESERVATION with no secret', async () => {
    const destinations = await eligibleDestinations({
      assignments: [assignedAgent({ userId: 'u-1', extension: '1042', passwordEncrypted: null })],
      users: [userRow('u-1', ['TN'])],
      credentials: [{ userId: 'u-1', extension: '1042' }],
      callerState: 'TN',
    });

    /*
     * A reservation is an extension the migration claimed with no password
     * behind it, so it cannot authenticate and cannot register. Ringing it is
     * a call into nothing; the roster screen shows this agent as "has not
     * opened the softphone yet", which is the same fact somebody can act on.
     */
    expect(destinations).toEqual([]);
  });

  it('is not a destination on a REVOKED credential', async () => {
    const destinations = await eligibleDestinations({
      assignments: [
        assignedAgent({ userId: 'u-1', extension: '1042', credentialStatus: 'REVOKED' }),
      ],
      users: [userRow('u-1', ['TN'])],
      credentials: [],
      callerState: 'TN',
    });

    expect(destinations).toEqual([]);
  });
});

/* ── Failing without taking the campaign down ──────────────────────────────── */

describe('when the assignments cannot be read', () => {
  it('still serves the campaigns buyer-endpoint destinations', async () => {
    prisma.campaignBuyer.findMany.mockResolvedValue([
      {
        buyerId: 'buyer-1',
        buyerEndpointId: 'endpoint-1',
        destinationNumber: '+18005551212',
        priority: 0,
        weight: 100,
        buyer: { id: 'buyer-1', name: 'Overflow', status: 'ACTIVE' },
        buyerEndpoint: {
          id: 'endpoint-1',
          name: 'Overflow',
          status: 'ACTIVE',
          maxConcurrency: 10,
          acceptedStates: [],
          weight: 100,
        },
      },
    ]);
    prisma.user.findMany.mockResolvedValue([]);
    prisma.phoneNumber.findMany.mockResolvedValue([]);
    prisma.call.count.mockResolvedValue(0);
    prisma.agentSipCredential.findMany.mockResolvedValue([]);
    prisma.campaignAgent.findMany.mockRejectedValue(
      new Error('relation "campaign_agents" does not exist')
    );

    const eligible = await new RoutingService().getEligibleEndpoints('tenant-1', 'campaign-1', {
      callerId: '+14235551212',
      callerState: 'TN',
    });

    /*
     * Losing the agency's agents is bad. Losing every destination on the
     * campaign is an outage, so the assignment read has its own try/catch —
     * including for the window where code is deployed ahead of a migration.
     */
    expect(eligible.map(ep => ep.destination)).toEqual(['+18005551212']);
  });
});
