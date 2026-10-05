/**
 * One DID, several agencies: round robin across every member campaign's agents.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, redis } = vi.hoisted(() => ({
  prisma: {
    sharedRoutingGroup: { findUnique: vi.fn() },
    sharedRoutingGroupMember: { findFirst: vi.fn() },
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

describe('resolveSharedAnswerer', () => {
  it("names the answering agent's own agency and its campaign in the group", async () => {
    prisma.user.findUnique.mockResolvedValue({ tenantId: 'agency-b' });
    prisma.sharedRoutingGroupMember.findFirst.mockResolvedValue({
      tenantId: 'agency-b',
      campaignId: 'camp-b',
    });

    await expect(resolveSharedAnswerer('group-1', 'b1')).resolves.toEqual({
      tenantId: 'agency-b',
      campaignId: 'camp-b',
    });
    expect(prisma.sharedRoutingGroupMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { groupId: 'group-1', tenantId: 'agency-b' } })
    );
  });

  it('is null for an agent whose agency is not in the group', async () => {
    prisma.user.findUnique.mockResolvedValue({ tenantId: 'agency-z' });
    prisma.sharedRoutingGroupMember.findFirst.mockResolvedValue(null);
    await expect(resolveSharedAnswerer('group-1', 'z1')).resolves.toBeNull();
  });
});
