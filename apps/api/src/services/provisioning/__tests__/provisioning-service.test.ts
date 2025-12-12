import { PhoneNumber, Tenant } from '@prisma/client';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock dependencies first
const { mockPrisma } = vi.hoisted(() => {
  return {
    mockPrisma: {
      phoneNumber: {
        create: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      tenant: {
        findUnique: vi.fn(),
      },
    },
  };
});

vi.mock('../../../lib/prisma.js', () => ({
  getPrismaClient: () => mockPrisma,
}));

vi.mock('../../audit.js', () => ({
  auditCreate: vi.fn(),
  auditUpdate: vi.fn(),
  auditLog: vi.fn(),
}));

vi.mock('../../../lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../adapters/telnyx-adapter.js');
vi.mock('../adapters/bandwidth-adapter.js');
vi.mock('../adapters/signalwire-adapter.js');
vi.mock('../adapters/local-adapter.js');

// Imports after mocks
// Imports after mocks

import { getPrismaClient } from '../../../lib/prisma.js';
import { BandwidthAdapter } from '../adapters/bandwidth-adapter.js';
import { LocalAdapter } from '../adapters/local-adapter.js';
import { SignalWireAdapter } from '../adapters/signalwire-adapter.js';
import { TelnyxAdapter } from '../adapters/telnyx-adapter.js';
import { ProvisioningService } from '../provisioning-service.js';

describe('ProvisioningService', () => {
  let service: ProvisioningService;
  const mockPrisma = getPrismaClient();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();

    // Setup default mock implementations
    vi.mocked(TelnyxAdapter).mockImplementation(
      () =>
        ({
          isConfigured: () => true,
          purchaseNumber: vi.fn().mockResolvedValue({
            number: '+15551112222',
            provider: 'telnyx',
            providerId: 't-1',
            features: {},
          }),
          listNumbers: vi.fn(),
          releaseNumber: vi.fn(),
          getNumber: vi.fn(),
          configureNumber: vi.fn(),
          provider: 'telnyx',
        }) as unknown as TelnyxAdapter
    );

    vi.mocked(BandwidthAdapter).mockImplementation(
      () =>
        ({
          isConfigured: () => true,
          purchaseNumber: vi.fn().mockResolvedValue({
            number: '+15553334444',
            provider: 'bandwidth',
            providerId: 'b-1',
            features: {},
          }),
          listNumbers: vi.fn(),
          releaseNumber: vi.fn(),
          getNumber: vi.fn(),
          configureNumber: vi.fn(),
          provider: 'bandwidth',
        }) as unknown as BandwidthAdapter
    );

    vi.mocked(SignalWireAdapter).mockImplementation(
      () =>
        ({
          isConfigured: () => true,
          purchaseNumber: vi.fn().mockResolvedValue({
            number: '+15556667777',
            provider: 'signalwire',
            providerId: 's-1',
            features: {},
          }),
          listNumbers: vi.fn(),
          releaseNumber: vi.fn(),
          getNumber: vi.fn(),
          configureNumber: vi.fn(),
          provider: 'signalwire',
        }) as unknown as SignalWireAdapter
    );

    vi.mocked(LocalAdapter).mockImplementation(
      () =>
        ({
          isConfigured: () => true,
          purchaseNumber: vi.fn().mockResolvedValue({
            number: '+15550000000',
            provider: 'local',
            providerId: 'l-1',
            features: {},
          }),
          listNumbers: vi.fn(),
          releaseNumber: vi.fn(),
          getNumber: vi.fn(),
          configureNumber: vi.fn(),
          provider: 'local',
        }) as unknown as LocalAdapter
    );

    service = new ProvisioningService();
  });

  it('should initialize with configured adapters', () => {
    expect(service.getAvailableProviders()).toContain('telnyx');
    expect(service.getAvailableProviders()).toContain('bandwidth');
    expect(service.getAvailableProviders()).toContain('signalwire');
    expect(service.getAvailableProviders()).toContain('local');
  });

  describe('purchaseNumber', () => {
    it('should use specified provider', async () => {
      // eslint-disable-next-line @typescript-eslint/unbound-method
      vi.mocked(mockPrisma.phoneNumber.create).mockResolvedValue({
        id: 'db-1',
      } as unknown as PhoneNumber);

      const result = await service.purchaseNumber(
        'telnyx',
        { areaCode: '555' },
        { tenantId: 'tenant-1' }
      );

      expect(result.provider).toBe('telnyx');
      // eslint-disable-next-line @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment
      expect(vi.mocked(mockPrisma.phoneNumber.create)).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          data: expect.objectContaining({
            provider: 'telnyx',
            number: '+15551112222',
          }),
        })
      );
    });

    it('should use tenant default provider if configured', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      // eslint-disable-next-line @typescript-eslint/unbound-method
      vi.mocked(mockPrisma.tenant.findUnique).mockResolvedValue({
        metadata: { defaultProvider: 'bandwidth' },
      } as unknown as Tenant);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      vi.mocked(mockPrisma.phoneNumber.create).mockResolvedValue({
        id: 'db-2',
      } as unknown as PhoneNumber);

      const result = await service.purchaseNumber(
        undefined,
        { areaCode: '555' },
        { tenantId: 'tenant-1' }
      );

      expect(result.provider).toBe('bandwidth');
    });

    it('should fallback to default priority list if no preference (SignalWire first)', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      // eslint-disable-next-line @typescript-eslint/unbound-method
      vi.mocked(mockPrisma.tenant.findUnique).mockResolvedValue(null);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      vi.mocked(mockPrisma.phoneNumber.create).mockResolvedValue({
        id: 'db-3',
      } as unknown as PhoneNumber);

      const result = await service.purchaseNumber(
        undefined,
        { areaCode: '555' },
        { tenantId: 'tenant-1' }
      );

      expect(result.provider).toBe('signalwire');
    });

    it('should skip unconfigured adapters in priority list', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      // Mock SignalWire as unconfigured
      vi.mocked(SignalWireAdapter).mockImplementationOnce(
        () =>
          ({
            isConfigured: () => false,
          }) as unknown as SignalWireAdapter
      );

      // Re-init service to pick up mock change
      service = new ProvisioningService();

      // eslint-disable-next-line @typescript-eslint/unbound-method
      vi.mocked(mockPrisma.tenant.findUnique).mockResolvedValue(null);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      vi.mocked(mockPrisma.phoneNumber.create).mockResolvedValue({
        id: 'db-4',
      } as unknown as PhoneNumber);

      const result = await service.purchaseNumber(
        undefined,
        { areaCode: '555' },
        { tenantId: 'tenant-1' }
      );

      // Should fall back to Telnyx (next in list)
      expect(result.provider).toBe('telnyx');
    });

    it('should default to local in development', async () => {
      vi.stubEnv('NODE_ENV', 'development');
      // eslint-disable-next-line @typescript-eslint/unbound-method
      vi.mocked(mockPrisma.phoneNumber.create).mockResolvedValue({
        id: 'db-5',
      } as unknown as PhoneNumber);

      const result = await service.purchaseNumber(
        undefined,
        { areaCode: '555' },
        { tenantId: 'tenant-1' }
      );

      expect(result.provider).toBe('local');
    });
  });
});
