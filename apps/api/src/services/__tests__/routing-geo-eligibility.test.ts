/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock, redisGet, loggerInfo } = vi.hoisted(() => ({
  prismaMock: {
    campaignBuyer: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    phoneNumber: { findMany: vi.fn() },
    campaign: { findFirst: vi.fn() },
    call: { count: vi.fn() },
  },
  redisGet: vi.fn(),
  loggerInfo: vi.fn(),
}));

vi.mock('../../lib/prisma.js', () => ({
  getPrismaClient: () => prismaMock,
}));

vi.mock('../../lib/logger.js', () => ({
  logger: { info: loggerInfo, warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../redis.js', () => ({
  getRedisClient: () => ({ get: redisGet }),
}));

vi.mock('../buyer-live-status-service.js', () => ({
  liveStatusService: { getTargetsLiveStatus: vi.fn(() => Promise.resolve(new Map())) },
}));

import { callerStateUnresolvedTotal } from '../../lib/metrics.js';
import { RoutingService } from '../routing.js';

const TENANT = 'tenant-1';
const CAMPAIGN = 'campaign-1';

function buyerRow(
  destinationNumber: string,
  acceptedStates: string[],
  opts: Partial<any> = {}
) {
  const buyerId = opts.buyerId || `buyer-${destinationNumber}`;
  return {
    buyerId,
    buyerEndpointId: `ep-${destinationNumber}`,
    destinationNumber,
    priority: opts.priority ?? 0,
    weight: opts.weight ?? 100,
    buyer: { id: buyerId, name: 'B', status: 'ACTIVE' },
    buyerEndpoint: {
      id: `ep-${destinationNumber}`,
      name: 'ep',
      status: 'ACTIVE',
      maxConcurrency: 10,
      acceptedStates,
      weight: opts.weight ?? 100,
    },
  };
}

describe('RoutingService geo-eligibility (real geo.ts, not mocked)', () => {
  let service: RoutingService;

  beforeEach(() => {
    vi.clearAllMocks();
    callerStateUnresolvedTotal.reset();
    service = new RoutingService();
    redisGet.mockResolvedValue(null);
    prismaMock.user.findMany.mockResolvedValue([]);
    prismaMock.phoneNumber.findMany.mockResolvedValue([]);
    prismaMock.campaign.findFirst.mockResolvedValue({ metadata: {} });
    prismaMock.call.count.mockResolvedValue(0);
  });

  it('emits the unresolved-state counter, tagged with the ring-tree ingress path', async () => {
    prismaMock.campaignBuyer.findMany.mockResolvedValue([buyerRow('+18005550100', [])]);

    await service.getEligibleEndpoints(TENANT, CAMPAIGN, {});
    const afterUnresolved = await callerStateUnresolvedTotal.get();
    expect(afterUnresolved.values).toContainEqual(
      expect.objectContaining({ labels: { ingress_path: 'ring_tree' }, value: 1 })
    );

    // A resolved caller state must not increment it further.
    await service.getEligibleEndpoints(TENANT, CAMPAIGN, { callerState: 'CA' });
    const afterResolved = await callerStateUnresolvedTotal.get();
    expect(afterResolved.values).toContainEqual(
      expect.objectContaining({ labels: { ingress_path: 'ring_tree' }, value: 1 })
    );
  });

  it('excludes a state-restricted buyer when the caller state cannot be resolved', async () => {
    prismaMock.campaignBuyer.findMany.mockResolvedValue([buyerRow('+18005550100', ['TX', 'OK'])]);

    const endpoints = await service.getEligibleEndpoints(TENANT, CAMPAIGN, {});

    expect(endpoints).toHaveLength(0);
  });

  it('still routes to a National buyer (empty acceptedStates) when the caller state is unresolved', async () => {
    prismaMock.campaignBuyer.findMany.mockResolvedValue([buyerRow('+18005550100', [])]);

    const endpoints = await service.getEligibleEndpoints(TENANT, CAMPAIGN, {});

    expect(endpoints).toHaveLength(1);
    expect(endpoints[0].destination).toBe('+18005550100');
  });

  it('logs a distinct exclusion reason for unresolved state vs. an ordinary geo mismatch', async () => {
    prismaMock.campaignBuyer.findMany.mockResolvedValue([
      buyerRow('+18005550100', ['TX', 'OK'], { buyerId: 'buyer-unresolved' }),
    ]);

    await service.getEligibleEndpoints(TENANT, CAMPAIGN, {});

    const unresolvedLog = loggerInfo.mock.calls.find(
      ([entry]) => entry.buyerId === 'buyer-unresolved'
    );
    expect(unresolvedLog?.[0]).toMatchObject({
      msg: 'Geo-routing: Endpoint EXCLUDED (caller state unresolved)',
      exclusionReason: 'STATE_UNRESOLVED',
    });

    // Now the ordinary-mismatch case must read differently.
    loggerInfo.mockClear();
    prismaMock.campaignBuyer.findMany.mockResolvedValue([
      buyerRow('+18005550200', ['TX', 'OK'], { buyerId: 'buyer-mismatch' }),
    ]);
    await service.getEligibleEndpoints(TENANT, CAMPAIGN, { callerState: 'CA' });

    const mismatchLog = loggerInfo.mock.calls.find(
      ([entry]) => entry.buyerId === 'buyer-mismatch'
    );
    expect(mismatchLog?.[0]).toMatchObject({
      msg: 'Geo-routing: Endpoint EXCLUDED (state not accepted)',
      exclusionReason: 'STATE_NOT_ACCEPTED',
    });
  });

  it('resolves state in priority order: supplied state, then ZIP, then area code', () => {
    expect(
      service.resolveCallerStateWithSource({
        callerState: 'TX',
        callerZipCode: '90210',
        callerId: '+12125551234',
      })
    ).toEqual({ state: 'TX', source: 'CALLER_SUPPLIED' });

    // ZIP (CA) wins over the disagreeing NY area code when no state is supplied.
    expect(
      service.resolveCallerStateWithSource({
        callerZipCode: '90210',
        callerId: '+12125551234',
      })
    ).toEqual({ state: 'CA', source: 'ZIP' });

    expect(service.resolveCallerStateWithSource({ callerId: '+18655551212' })).toEqual({
      state: 'TN',
      source: 'AREA_CODE',
    });

    expect(service.resolveCallerStateWithSource({})).toEqual({
      state: null,
      source: 'UNRESOLVED',
    });
  });

  it('returns the winning resolution source from selectBestBuyer', async () => {
    prismaMock.campaignBuyer.findMany.mockResolvedValue([buyerRow('+18005550100', [])]);

    const result = await service.selectBestBuyer(TENANT, CAMPAIGN, { callerZipCode: '90210' });

    expect(result?.callerState).toBe('CA');
    expect(result?.callerStateSource).toBe('ZIP');
  });
});
