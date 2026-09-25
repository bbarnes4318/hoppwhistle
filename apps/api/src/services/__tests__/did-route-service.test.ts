/**
 * A campaign number's route is the campaign, not two hardcoded extensions.
 *
 * `syncDidRouteForNumber` used to write destination '1005,1001' (label
 * "Chantal & Khallel") onto every number assigned to a campaign. The Numbers
 * page showed that as where the number rang, and the FreeSWITCH lookup rang it
 * whenever campaign routing threw.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPrisma = {
  phoneNumber: { findUnique: vi.fn() },
  didRoute: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  user: { findMany: vi.fn(), update: vi.fn() },
};

vi.mock('../../lib/prisma.js', () => ({ getPrismaClient: () => mockPrisma }));
vi.mock('../../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { didRouteService } from '../did-route-service.js';

const CAMPAIGN_NUMBER = {
  id: 'pn-1',
  number: '+18652757300',
  status: 'ACTIVE',
  campaignId: 'camp-1',
  userId: null,
  user: null,
};

describe('syncDidRouteForNumber for a campaign number', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.phoneNumber.findUnique.mockResolvedValue(CAMPAIGN_NUMBER);
  });

  it('creates the route as campaign-routed, with no extensions', async () => {
    mockPrisma.didRoute.findFirst.mockResolvedValue(null);

    await didRouteService.syncDidRouteForNumber('pn-1', 'tenant-1');

    expect(mockPrisma.didRoute.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        did: '+18652757300',
        campaignId: 'camp-1',
        destination: 'Campaign',
        label: 'Auto-routed Campaign',
      }) as unknown,
    });
  });

  it('rewrites an existing 1005,1001 route to the campaign', async () => {
    mockPrisma.didRoute.findFirst.mockResolvedValue({
      id: 'route-1',
      destination: '1005,1001',
      label: 'Auto-routed Campaign (Chantal & Khallel)',
    });

    await didRouteService.syncDidRouteForNumber('pn-1', 'tenant-1');

    expect(mockPrisma.didRoute.update).toHaveBeenCalledWith({
      where: { id: 'route-1' },
      data: expect.objectContaining({
        campaignId: 'camp-1',
        destination: 'Campaign',
        label: 'Auto-routed Campaign',
      }) as unknown,
    });
  });
});
