/**
 * `getEligibleEndpoints` with an explicit agent list: an agent added to a
 * shared routing group on their own.
 *
 * They are not on the campaign, so the campaign's agent list is not read and
 * no buyer is routed to -- but every agent gate (licence, softphone, ...) runs
 * on them exactly as on a campaign agent. This mocks the data layer and runs
 * the real filter, like routing-campaign-agent.test.ts.
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

import { RoutingService } from '../routing.js';

const SEAN = {
  id: 'sean',
  status: 'ACTIVE',
  firstName: 'Sean',
  lastName: 'Grove',
  email: 'sean@agency.test',
  metadata: { licensedStates: ['TN'] },
  sipCredential: { extension: '1042', status: 'ACTIVE', passwordEncrypted: 'enc:v1:x:y:z' },
};

async function destinations(callerState: string | null): Promise<string[]> {
  prisma.campaignBuyer.findMany.mockResolvedValue([]);
  // First read: the agent list itself. After that: the gates' user reads.
  prisma.user.findMany
    .mockResolvedValueOnce([SEAN])
    .mockResolvedValue([{ id: 'sean', metadata: SEAN.metadata }]);
  prisma.phoneNumber.findMany.mockResolvedValue([]);
  prisma.call.count.mockResolvedValue(0);
  prisma.agentSipCredential.findMany.mockResolvedValue([{ userId: 'sean', extension: '1042' }]);

  const eligible = await new RoutingService().getEligibleEndpoints(
    'agency-c',
    null,
    { callerId: '+14235551212', callerState },
    { onlyAgentUserIds: ['sean'] }
  );
  return eligible.map(ep => ep.destination);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getEligibleEndpoints with onlyAgentUserIds', () => {
  it('rings the agent at their softphone without reading any campaign agent list', async () => {
    expect(await destinations('TN')).toEqual(['1042']);
    expect(prisma.campaignAgent.findMany).not.toHaveBeenCalled();
  });

  it('reads the agent within their own agency only', async () => {
    await destinations('TN');
    expect(prisma.user.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { id: { in: ['sean'] }, tenantId: 'agency-c' },
      })
    );
  });

  it('routes to no buyer', async () => {
    await destinations('TN');
    expect(prisma.campaignBuyer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ campaignId: { in: [] } }) as unknown,
      })
    );
  });

  it('still applies the licence gate: not rung for a state they are not licensed in', async () => {
    expect(await destinations('FL')).toEqual([]);
  });

  it('refuses to run with neither a campaign nor an agent list', async () => {
    await expect(new RoutingService().getEligibleEndpoints('agency-c', null, {})).rejects.toThrow();
  });
});
