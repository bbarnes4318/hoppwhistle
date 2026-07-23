/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock, redisGet } = vi.hoisted(() => ({
  prismaMock: {
    campaignBuyer: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    phoneNumber: { findMany: vi.fn() },
    campaign: { findFirst: vi.fn() },
    call: { count: vi.fn() },
  },
  redisGet: vi.fn(),
}));

vi.mock('../../lib/prisma.js', () => ({
  getPrismaClient: () => prismaMock,
}));

vi.mock('../../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../redis.js', () => ({
  getRedisClient: () => ({ get: redisGet }),
}));

vi.mock('../buyer-live-status-service.js', () => ({
  liveStatusService: { getTargetsLiveStatus: vi.fn(() => Promise.resolve(new Map())) },
}));

import { RoutingService } from '../routing.js';

const TENANT = 'tenant-1';
const CAMPAIGN = 'campaign-1';

function buyerRow(destinationNumber: string, opts: Partial<any> = {}) {
  return {
    buyerId: opts.buyerId || `buyer-${destinationNumber}`,
    buyerEndpointId: null,
    destinationNumber,
    priority: opts.priority ?? 0,
    weight: opts.weight ?? 100,
    buyer: { id: opts.buyerId || `buyer-${destinationNumber}`, name: 'B', status: 'ACTIVE' },
    buyerEndpoint: null,
  };
}

describe('RoutingService agent-DID → extension translation', () => {
  let service: RoutingService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new RoutingService();
    redisGet.mockResolvedValue(null);
    prismaMock.user.findMany.mockResolvedValue([{ id: 'user-a', metadata: { extension: '1003' } }]);
    prismaMock.phoneNumber.findMany.mockResolvedValue([
      { number: '+18656000039', userId: 'user-a' },
    ]);
    prismaMock.campaign.findFirst.mockResolvedValue({ metadata: {} });
    prismaMock.call.count.mockResolvedValue(0);
  });

  it('translates a campaign destination that is an agent-assigned DID to the softphone extension', async () => {
    prismaMock.campaignBuyer.findMany.mockResolvedValue([buyerRow('+18656000039')]);

    const endpoints = await service.getEligibleEndpoints(TENANT, CAMPAIGN, {});
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0].destination).toBe('1003');
    expect(endpoints[0].externalFallbackDestination).toBe('+18656000039');
  });

  it('matches DIDs regardless of formatting (last-10-digit normalization)', async () => {
    prismaMock.campaignBuyer.findMany.mockResolvedValue([buyerRow('18656000039')]);

    const endpoints = await service.getEligibleEndpoints(TENANT, CAMPAIGN, {});
    expect(endpoints[0].destination).toBe('1003');
  });

  it('leaves external buyer numbers that are not agent DIDs untouched', async () => {
    prismaMock.campaignBuyer.findMany.mockResolvedValue([buyerRow('+12058869796')]);

    const endpoints = await service.getEligibleEndpoints(TENANT, CAMPAIGN, {});
    expect(endpoints[0].destination).toBe('+12058869796');
    expect(endpoints[0].externalFallbackDestination).toBeUndefined();
  });

  it('leaves an agent DID external when the user has no extension provisioned', async () => {
    prismaMock.user.findMany.mockResolvedValue([{ id: 'user-a', metadata: {} }]);
    prismaMock.campaignBuyer.findMany.mockResolvedValue([buyerRow('+18656000039')]);

    const endpoints = await service.getEligibleEndpoints(TENANT, CAMPAIGN, {});
    expect(endpoints[0].destination).toBe('+18656000039');
  });

  it('scopes agent-DID lookups to the tenant', async () => {
    prismaMock.campaignBuyer.findMany.mockResolvedValue([buyerRow('+18656000039')]);
    await service.getEligibleEndpoints(TENANT, CAMPAIGN, {});
    expect(prismaMock.phoneNumber.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: TENANT }),
      })
    );
  });

  it('does not add an external fallback step by default (fail closed)', async () => {
    prismaMock.campaignBuyer.findMany.mockResolvedValue([buyerRow('+18656000039')]);

    const result = await service.selectBestBuyer(TENANT, CAMPAIGN, {});
    expect(result?.endpoint).toBe('1003');
  });

  it('adds the agent DID as a final failover step only when campaign metadata enables it', async () => {
    prismaMock.campaign.findFirst.mockResolvedValue({
      metadata: { allowAgentDidExternalFallback: true },
    });
    prismaMock.campaignBuyer.findMany.mockResolvedValue([buyerRow('+18656000039')]);

    const result = await service.selectBestBuyer(TENANT, CAMPAIGN, {});
    expect(result?.endpoint).toBe('1003|+18656000039');
  });

  it('excludes an agent at their concurrency limit (Redis currentCallId floor)', async () => {
    redisGet.mockResolvedValue(JSON.stringify({ status: 'busy', currentCallId: 'c1' }));
    prismaMock.campaignBuyer.findMany.mockResolvedValue([buyerRow('+18656000039')]);

    const endpoints = await service.getEligibleEndpoints(TENANT, CAMPAIGN, {});
    expect(endpoints).toHaveLength(0);
  });

  it('excludes an agent whose live call count reaches their limit', async () => {
    prismaMock.call.count.mockResolvedValue(1); // default limit is 1
    prismaMock.campaignBuyer.findMany.mockResolvedValue([buyerRow('+18656000039')]);

    const endpoints = await service.getEligibleEndpoints(TENANT, CAMPAIGN, {});
    expect(endpoints).toHaveLength(0);
  });

  it('does NOT exclude an agent for a stale offline/DND status with no live call', async () => {
    redisGet.mockResolvedValue(JSON.stringify({ status: 'offline', currentCallId: null }));
    prismaMock.campaignBuyer.findMany.mockResolvedValue([buyerRow('+18656000039')]);

    const endpoints = await service.getEligibleEndpoints(TENANT, CAMPAIGN, {});
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0].destination).toBe('1003');
  });

  it('respects a per-agent maxConcurrentCalls above the default', async () => {
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'user-a', metadata: { extension: '1003', maxConcurrentCalls: 2 } },
    ]);
    prismaMock.call.count.mockResolvedValue(1); // below limit of 2
    prismaMock.campaignBuyer.findMany.mockResolvedValue([buyerRow('+18656000039')]);

    const endpoints = await service.getEligibleEndpoints(TENANT, CAMPAIGN, {});
    expect(endpoints).toHaveLength(1);
  });
});
