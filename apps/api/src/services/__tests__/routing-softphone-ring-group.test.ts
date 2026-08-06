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

import { RoutingService, type EligibleEndpoint } from '../routing.js';

function endpoint(
  destination: string,
  priority = 0,
  buyerId = `buyer-${destination}`,
  weight = 100
): EligibleEndpoint {
  return {
    buyerId,
    buyerName: buyerId,
    endpointId: `endpoint-${destination}`,
    destination,
    priority,
    weight,
    acceptedStates: [],
    isNational: true,
  };
}

describe('RoutingService campaign ring groups', () => {
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

  it('rings internal Hopwhistle extensions and one weighted cell buyer together', async () => {
    vi.spyOn(service, 'getEligibleEndpoints').mockResolvedValue([
      endpoint('1000', 0, 'agent-a'),
      endpoint('1001', 0, 'agent-b'),
      endpoint('+14235550100', 0, 'cell-a', 80),
      endpoint('+14235550101', 0, 'cell-b', 20),
    ]);
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const result = await service.selectBestBuyer('tenant-1', 'campaign-1');

    expect(result?.endpoint).toBe('1000,1001,+14235550100');
  });

  it('keeps mixed lower priorities as sequential failover steps', async () => {
    vi.spyOn(service, 'getEligibleEndpoints').mockResolvedValue([
      endpoint('1000', 0, 'agent-a'),
      endpoint('+14235550100', 0, 'cell-a'),
      endpoint('1001', 1, 'agent-b'),
      endpoint('+14235550101', 1, 'cell-b'),
    ]);
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const result = await service.selectBestBuyer('tenant-1', 'campaign-1');

    expect(result?.endpoint).toBe('1000,+14235550100|1001,+14235550101');
  });

  describe('ringAllExternalBuyers', () => {
    // The flag lives on campaign.metadata. Routing reads it only when a step
    // holds more than one external destination.
    const withCampaignMeta = (metadata: unknown) => {
      (service as unknown as { prisma: unknown }).prisma = {
        campaign: { findFirst: () => Promise.resolve({ metadata }) },
      };
    };

    it('rings only one external buyer by default, so weighted distribution is unchanged', async () => {
      withCampaignMeta({});
      vi.spyOn(service, 'getEligibleEndpoints').mockResolvedValue([
        endpoint('+14235550100', 0, 'cell-a'),
        endpoint('+14235550101', 0, 'cell-b'),
      ]);
      vi.spyOn(Math, 'random').mockReturnValue(0);

      const result = await service.selectBestBuyer('tenant-1', 'campaign-1');

      expect(result?.endpoint).toBe('+14235550100');
    });

    it('rings every external buyer in the step when the campaign opts in', async () => {
      withCampaignMeta({ ringAllExternalBuyers: true });
      vi.spyOn(service, 'getEligibleEndpoints').mockResolvedValue([
        endpoint('+14235550100', 0, 'cell-a'),
        endpoint('+14235550101', 0, 'cell-b'),
      ]);

      const result = await service.selectBestBuyer('tenant-1', 'campaign-1');

      expect(result?.endpoint).toBe('+14235550100,+14235550101');
    });

    it('rings agents and every external buyer together when opted in', async () => {
      withCampaignMeta({ ringAllExternalBuyers: true });
      vi.spyOn(service, 'getEligibleEndpoints').mockResolvedValue([
        endpoint('1000', 0, 'agent-a'),
        endpoint('+14235550100', 0, 'cell-a'),
        endpoint('+14235550101', 0, 'cell-b'),
      ]);

      const result = await service.selectBestBuyer('tenant-1', 'campaign-1');

      expect(result?.endpoint).toBe('1000,+14235550100,+14235550101');
    });

    it('keeps lower priorities as sequential steps when opted in', async () => {
      withCampaignMeta({ ringAllExternalBuyers: true });
      vi.spyOn(service, 'getEligibleEndpoints').mockResolvedValue([
        endpoint('+14235550100', 0, 'cell-a'),
        endpoint('+14235550101', 0, 'cell-b'),
        endpoint('+14235550102', 1, 'cell-c'),
      ]);

      const result = await service.selectBestBuyer('tenant-1', 'campaign-1');

      expect(result?.endpoint).toBe('+14235550100,+14235550101|+14235550102');
    });

    it('falls back to the weighted pick when the campaign lookup fails', async () => {
      // A database blip must not silently start ringing every buyer.
      (service as unknown as { prisma: unknown }).prisma = {
        campaign: { findFirst: () => Promise.reject(new Error('db down')) },
      };
      vi.spyOn(service, 'getEligibleEndpoints').mockResolvedValue([
        endpoint('+14235550100', 0, 'cell-a'),
        endpoint('+14235550101', 0, 'cell-b'),
      ]);
      vi.spyOn(Math, 'random').mockReturnValue(0);

      const result = await service.selectBestBuyer('tenant-1', 'campaign-1');

      expect(result?.endpoint).toBe('+14235550100');
    });
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
