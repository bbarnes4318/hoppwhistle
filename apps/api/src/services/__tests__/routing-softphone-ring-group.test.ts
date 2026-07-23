import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/prisma.js', () => ({
  getPrismaClient: () => ({}),
}));

vi.mock('../../lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../lib/geo.js', () => ({
  extractAreaCode: vi.fn(() => null),
  getStateFromAreaCode: vi.fn(() => null),
  isCallerStateAccepted: vi.fn(() => true),
}));

import {
  RoutingService,
  type EligibleEndpoint,
} from '../routing.js';

function endpoint(
  destination: string,
  priority = 0,
  buyerId = `buyer-${destination}`
): EligibleEndpoint {
  return {
    buyerId,
    buyerName: buyerId,
    endpointId: `endpoint-${destination}`,
    destination,
    priority,
    weight: 100,
    acceptedStates: [],
    isNational: true,
  };
}

describe('RoutingService internal softphone ring groups', () => {
  let service: RoutingService;

  beforeEach(() => {
    vi.restoreAllMocks();
    service = new RoutingService();
  });

  it('rings every available softphone at the same priority in parallel', async () => {
    vi.spyOn(service, 'getEligibleEndpoints').mockResolvedValue([
      endpoint('1000'),
      endpoint('1001'),
      endpoint('1002'),
    ]);

    const result = await service.selectBestBuyer('tenant-1', 'campaign-1', {
      callerId: '+14235551212',
    });

    expect(result).not.toBeNull();
    expect(result?.endpoint).toBe('1000,1001,1002');
  });

  it('uses lower-priority softphones as sequential failover groups', async () => {
    vi.spyOn(service, 'getEligibleEndpoints').mockResolvedValue([
      endpoint('1000', 0),
      endpoint('1001', 0),
      endpoint('1002', 1),
    ]);

    const result = await service.selectBestBuyer('tenant-1', 'campaign-1');

    expect(result?.endpoint).toBe('1000,1001|1002');
  });

  it('deduplicates repeated softphone destinations', async () => {
    vi.spyOn(service, 'getEligibleEndpoints').mockResolvedValue([
      endpoint('1000', 0, 'buyer-a'),
      endpoint('1000', 0, 'buyer-b'),
      endpoint('1001', 0, 'buyer-c'),
    ]);

    const result = await service.selectBestBuyer('tenant-1', 'campaign-1');

    expect(result?.endpoint).toBe('1000,1001');
  });

  it('preserves weighted single-destination selection for external buyers', async () => {
    vi.spyOn(service, 'getEligibleEndpoints').mockResolvedValue([
      endpoint('+14235550100'),
      endpoint('+14235550101'),
    ]);
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const result = await service.selectBestBuyer('tenant-1', 'campaign-1');

    expect(result?.endpoint).toBe('+14235550100');
  });
});
