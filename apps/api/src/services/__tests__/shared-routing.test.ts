/**
 * One DID, several agencies: round robin across every member's agents --
 * whole campaigns, and agents added on their own.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, redis } = vi.hoisted(() => ({
  prisma: {
    sharedRoutingGroup: { findUnique: vi.fn() },
    sharedRoutingGroupMember: { findMany: vi.fn() },
    user: { findUnique: vi.fn() },
  },
  redis: { eval: vi.fn(), zadd: vi.fn(), expire: vi.fn() },
}));

vi.mock('../../lib/prisma.js', () => ({ getPrismaClient: () => prisma }));
vi.mock('../../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../redis.js', () => ({ getRedisClient: () => redis }));
vi.mock('../billing/delivery-gate.js', () => ({
  isDeliveryAllowed: vi.fn(() => Promise.resolve({ allowed: true })),
}));

import type { EligibleEndpoint } from '../routing.js';
import {
  orderByLeastRecent,
  resolveSharedAnswerer,
  rotate,
  selectSharedRoundRobin,
} from '../shared-routing.js';

function agent(userId: string, destination: string, extra: Partial<EligibleEndpoint> = {}) {
  return {
    buyerId: userId,
    buyerName: userId,
    endpointId: null,
    destination,
    priority: 0,
    weight: 100,
    acceptedStates: [],
    isNational: true,
    agentUserId: userId,
    ...extra,
  } satisfies EligibleEndpoint;
}

function buyer(destination: string): EligibleEndpoint {
  return {
    buyerId: 'buyer-1',
    buyerName: 'Buyer',
    endpointId: 'ep-1',
    destination,
    priority: 0,
    weight: 100,
    acceptedStates: [],
    isNational: true,
  };
}

const GROUP = {
  id: 'group-1',
  status: 'ACTIVE',
  members: [
    {
      tenantId: 'agency-a',
      campaignId: 'camp-a',
      campaign: { status: 'ACTIVE', tenantId: 'agency-a', metadata: { agentRingSeconds: 15 } },
    },
    {
      tenantId: 'agency-b',
      campaignId: 'camp-b',
      campaign: { status: 'ACTIVE', tenantId: 'agency-b', metadata: {} },
    },
  ],
};

/** Agency A: agents a1 (softphone) and a2 (cell). Agency B: agent b1. */
const ELIGIBLE: Record<string, EligibleEndpoint[]> = {
  'camp-a': [
    agent('a1', '1001'),
    agent('a2', '4235550100', { agentCell: true }),
    buyer('8005550100'),
  ],
  'camp-b': [agent('b1', '1002')],
};

const getEligibleEndpoints = vi.fn((_tenantId: string, campaignId: string) =>
  Promise.resolve(ELIGIBLE[campaignId] ?? [])
);
const allowAll = () => Promise.resolve({ allowed: true });
const identityRotate = vi.fn((_groupId: string, ids: string[]) => Promise.resolve(ids));

beforeEach(() => {
  vi.clearAllMocks();
  prisma.sharedRoutingGroup.findUnique.mockResolvedValue(GROUP);
});

describe('orderByLeastRecent', () => {
  it('puts never-offered agents first, then least recently offered', () => {
    const scores = new Map([
      ['a1', 300],
      ['b1', 100],
    ]);
    expect(orderByLeastRecent(['a1', 'a2', 'b1'], scores)).toEqual(['a2', 'b1', 'a1']);
  });

  it('keeps the given order between ties', () => {
    expect(orderByLeastRecent(['a1', 'a2', 'b1'], new Map())).toEqual(['a1', 'a2', 'b1']);
  });
});

describe('rotate without Redis', () => {
  it('rotates through every agent in turn, call after call', async () => {
    redis.eval.mockRejectedValue(new Error('down'));
    const firsts: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const order = await rotate('group-local', ['a1', 'a2', 'b1']);
      firsts.push(order[0]);
      // Distinct timestamps between calls.
      await new Promise(resolve => setTimeout(resolve, 2));
    }
    expect(firsts).toEqual(['a1', 'a2', 'b1', 'a1', 'a2', 'b1']);
  });
});

describe('selectSharedRoundRobin', () => {
  it('pools agents from every member agency and rings them one at a time', async () => {
    const plan = await selectSharedRoundRobin(
      'group-1',
      { callerId: '+14235551212' },
      {
        getEligibleEndpoints,
        rotate: identityRotate,
        deliveryAllowed: allowAll,
      }
    );

    expect(identityRotate).toHaveBeenCalledWith('group-1', ['a1', 'a2', 'b1']);
    expect(plan?.order).toEqual(['a1', 'a2', 'b1']);
    // One leg per step: strict round robin, never ring-all.
    expect(plan?.endpoint).toBe('1001|4235550100|1002');
    expect(plan?.agentCellKeys).toEqual(['4235550100']);
  });

  it('tags each leg with its agent and its own campaign ring time', async () => {
    const plan = await selectSharedRoundRobin(
      'group-1',
      {},
      {
        getEligibleEndpoints,
        rotate: identityRotate,
        deliveryAllowed: allowAll,
      }
    );
    const steps = plan!.dialString.split('|');
    expect(steps[0]).toContain('x_leg_party=agent:a1');
    expect(steps[0]).toContain('leg_timeout=15');
    expect(steps[2]).toContain('x_leg_party=agent:b1');
    expect(steps[2]).toContain('leg_timeout=20');
  });

  it('follows the rotation order it is given', async () => {
    const plan = await selectSharedRoundRobin(
      'group-1',
      {},
      {
        getEligibleEndpoints,
        rotate: () => Promise.resolve(['b1', 'a1', 'a2']),
        deliveryAllowed: allowAll,
      }
    );
    expect(plan?.endpoint).toBe('1002|1001|4235550100');
  });

  it('never offers a buyer endpoint on a member campaign', async () => {
    const plan = await selectSharedRoundRobin(
      'group-1',
      {},
      {
        getEligibleEndpoints,
        rotate: identityRotate,
        deliveryAllowed: allowAll,
      }
    );
    expect(plan?.endpoint).not.toContain('8005550100');
  });

  it('passes the caller to every member so each agency gates by licensed state', async () => {
    await selectSharedRoundRobin(
      'group-1',
      { callerId: '+14235551212' },
      {
        getEligibleEndpoints,
        rotate: identityRotate,
        deliveryAllowed: allowAll,
      }
    );
    expect(getEligibleEndpoints).toHaveBeenCalledWith('agency-a', 'camp-a', {
      callerId: '+14235551212',
    });
    expect(getEligibleEndpoints).toHaveBeenCalledWith('agency-b', 'camp-b', {
      callerId: '+14235551212',
    });
  });

  it('skips an agency whose delivery is held, and keeps the others', async () => {
    const plan = await selectSharedRoundRobin(
      'group-1',
      {},
      {
        getEligibleEndpoints,
        rotate: identityRotate,
        deliveryAllowed: tenantId => Promise.resolve({ allowed: tenantId !== 'agency-a' }),
      }
    );
    expect(plan?.order).toEqual(['b1']);
  });

  it('skips a member that fails, and keeps the others', async () => {
    const plan = await selectSharedRoundRobin(
      'group-1',
      {},
      {
        getEligibleEndpoints: (_tenantId, campaignId) =>
          campaignId === 'camp-a'
            ? Promise.reject(new Error('boom'))
            : Promise.resolve(ELIGIBLE[campaignId]),
        rotate: identityRotate,
        deliveryAllowed: allowAll,
      }
    );
    expect(plan?.order).toEqual(['b1']);
  });

  it('returns null when no agent anywhere can take the call', async () => {
    const plan = await selectSharedRoundRobin(
      'group-1',
      {},
      {
        getEligibleEndpoints: () => Promise.resolve([]),
        rotate: identityRotate,
        deliveryAllowed: allowAll,
      }
    );
    expect(plan).toBeNull();
  });

  it('returns null for a paused group', async () => {
    prisma.sharedRoutingGroup.findUnique.mockResolvedValue({ ...GROUP, status: 'PAUSED' });
    const plan = await selectSharedRoundRobin('group-1', {}, { getEligibleEndpoints });
    expect(plan).toBeNull();
    expect(getEligibleEndpoints).not.toHaveBeenCalled();
  });

  it('ignores a member whose campaign has moved to another tenant', async () => {
    prisma.sharedRoutingGroup.findUnique.mockResolvedValue({
      ...GROUP,
      members: [
        { ...GROUP.members[0], campaign: { ...GROUP.members[0].campaign, tenantId: 'agency-z' } },
        GROUP.members[1],
      ],
    });
    const plan = await selectSharedRoundRobin(
      'group-1',
      {},
      {
        getEligibleEndpoints,
        rotate: identityRotate,
        deliveryAllowed: allowAll,
      }
    );
    expect(plan?.order).toEqual(['b1']);
  });
});

describe('selectSharedRoundRobin with an agent added on their own', () => {
  const SEAN = {
    tenantId: 'agency-c',
    campaignId: null,
    userId: 'sean',
    campaign: null,
    user: { tenantId: 'agency-c' },
  };
  const eligible = vi.fn(
    (
      _tenantId: string,
      campaignId: string | null,
      _callData: unknown,
      options?: { onlyAgentUserIds?: string[] }
    ) => {
      if (options?.onlyAgentUserIds) {
        return Promise.resolve(
          options.onlyAgentUserIds.includes('sean') ? [agent('sean', '1003')] : []
        );
      }
      return Promise.resolve(ELIGIBLE[campaignId ?? ''] ?? []);
    }
  );

  it('puts the agent in the rotation with the campaigns, without a campaign of their own', async () => {
    prisma.sharedRoutingGroup.findUnique.mockResolvedValue({
      ...GROUP,
      members: [...GROUP.members, SEAN],
    });

    const plan = await selectSharedRoundRobin(
      'group-1',
      { callerId: '+14235551212' },
      { getEligibleEndpoints: eligible, rotate: identityRotate, deliveryAllowed: allowAll }
    );

    expect(plan?.order).toEqual(['a1', 'a2', 'b1', 'sean']);
    // Asked for exactly that agent, in their own agency, with the caller --
    // so the licence and every other agent gate applies to them too.
    expect(eligible).toHaveBeenCalledWith(
      'agency-c',
      null,
      { callerId: '+14235551212' },
      { onlyAgentUserIds: ['sean'] }
    );
  });

  it("is left out when routing finds them ineligible (e.g. not licensed in the caller's state)", async () => {
    prisma.sharedRoutingGroup.findUnique.mockResolvedValue({ ...GROUP, members: [SEAN] });
    const plan = await selectSharedRoundRobin(
      'group-1',
      {},
      {
        getEligibleEndpoints: () => Promise.resolve([]),
        rotate: identityRotate,
        deliveryAllowed: allowAll,
      }
    );
    expect(plan).toBeNull();
  });

  it("is skipped when their agency's delivery is held", async () => {
    prisma.sharedRoutingGroup.findUnique.mockResolvedValue({ ...GROUP, members: [SEAN] });
    const plan = await selectSharedRoundRobin(
      'group-1',
      {},
      {
        getEligibleEndpoints: eligible,
        rotate: identityRotate,
        deliveryAllowed: () => Promise.resolve({ allowed: false }),
      }
    );
    expect(plan).toBeNull();
  });

  it('is skipped when they have moved to another agency', async () => {
    prisma.sharedRoutingGroup.findUnique.mockResolvedValue({
      ...GROUP,
      members: [{ ...SEAN, user: { tenantId: 'agency-z' } }],
    });
    const plan = await selectSharedRoundRobin(
      'group-1',
      {},
      { getEligibleEndpoints: eligible, rotate: identityRotate, deliveryAllowed: allowAll }
    );
    expect(plan).toBeNull();
  });

  it('rings an agent once when they are both on a member campaign and added on their own', async () => {
    prisma.sharedRoutingGroup.findUnique.mockResolvedValue({
      ...GROUP,
      members: [
        ...GROUP.members,
        { ...SEAN, tenantId: 'agency-b', userId: 'b1', user: { tenantId: 'agency-b' } },
      ],
    });
    const plan = await selectSharedRoundRobin(
      'group-1',
      {},
      {
        getEligibleEndpoints: (tenantId, campaignId, _data, options) =>
          options?.onlyAgentUserIds
            ? Promise.resolve([agent('b1', '1002')])
            : Promise.resolve(ELIGIBLE[campaignId ?? ''] ?? []),
        rotate: identityRotate,
        deliveryAllowed: allowAll,
      }
    );
    expect(plan?.order).toEqual(['a1', 'a2', 'b1']);
  });
});

describe('resolveSharedAnswerer', () => {
  it("records a campaign member's agent under their agency's campaign", async () => {
    prisma.user.findUnique.mockResolvedValue({ tenantId: 'agency-b' });
    prisma.sharedRoutingGroupMember.findMany.mockResolvedValue([
      { tenantId: 'agency-b', campaignId: 'camp-b', userId: null },
    ]);

    await expect(resolveSharedAnswerer('group-1', 'b1')).resolves.toEqual({
      tenantId: 'agency-b',
      campaignId: 'camp-b',
    });
    expect(prisma.sharedRoutingGroupMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { groupId: 'group-1', tenantId: 'agency-b' } })
    );
  });

  it('records an agent added on their own under their agency, with no campaign', async () => {
    prisma.user.findUnique.mockResolvedValue({ tenantId: 'agency-c' });
    prisma.sharedRoutingGroupMember.findMany.mockResolvedValue([
      { tenantId: 'agency-c', campaignId: null, userId: 'sean' },
    ]);
    await expect(resolveSharedAnswerer('group-1', 'sean')).resolves.toEqual({
      tenantId: 'agency-c',
      campaignId: null,
    });
  });

  it("uses the campaign given to the agent's own member over the agency's campaign member", async () => {
    prisma.user.findUnique.mockResolvedValue({ tenantId: 'agency-c' });
    prisma.sharedRoutingGroupMember.findMany.mockResolvedValue([
      { tenantId: 'agency-c', campaignId: 'camp-c', userId: null },
      { tenantId: 'agency-c', campaignId: 'camp-sean', userId: 'sean' },
    ]);
    await expect(resolveSharedAnswerer('group-1', 'sean')).resolves.toEqual({
      tenantId: 'agency-c',
      campaignId: 'camp-sean',
    });
  });

  it("falls back to the agency's campaign member for an agent added without one", async () => {
    prisma.user.findUnique.mockResolvedValue({ tenantId: 'agency-c' });
    prisma.sharedRoutingGroupMember.findMany.mockResolvedValue([
      { tenantId: 'agency-c', campaignId: 'camp-c', userId: null },
      { tenantId: 'agency-c', campaignId: null, userId: 'sean' },
    ]);
    await expect(resolveSharedAnswerer('group-1', 'sean')).resolves.toEqual({
      tenantId: 'agency-c',
      campaignId: 'camp-c',
    });
  });

  it('is null for a colleague of an individually added agent: only that agent is in the group', async () => {
    prisma.user.findUnique.mockResolvedValue({ tenantId: 'agency-c' });
    prisma.sharedRoutingGroupMember.findMany.mockResolvedValue([
      { tenantId: 'agency-c', campaignId: null, userId: 'sean' },
    ]);
    await expect(resolveSharedAnswerer('group-1', 'someone-else')).resolves.toBeNull();
  });

  it('is null for an agent whose agency is not in the group', async () => {
    prisma.user.findUnique.mockResolvedValue({ tenantId: 'agency-z' });
    prisma.sharedRoutingGroupMember.findMany.mockResolvedValue([]);
    await expect(resolveSharedAnswerer('group-1', 'z1')).resolves.toBeNull();
  });
});
