import { logger } from '../../../lib/logger.js';
import { getPrismaClient } from '../../../lib/prisma.js';
import type {
  ProvisioningAdapter,
  ProvisionedNumber,
  PurchaseNumberRequest,
  ListNumbersOptions,
  NumberFeatures,
  NumberStatus,
  Provider,
} from '../types.js';

/**
 * Local Inventory Adapter
 *
 * Manages numbers from local database/CSV for development and staging.
 * Simulates provisioning operations without hitting external APIs.
 */
export class LocalAdapter implements ProvisioningAdapter {
  readonly provider = 'local' as const;

  isConfigured(): boolean {
    // Local adapter is always available
    return true;
  }

  async listNumbers(options?: ListNumbersOptions): Promise<ProvisionedNumber[]> {
    const prisma = getPrismaClient();

    const where: any = {
      provider: 'local',
    };

    if (options?.status) {
      // Map provisioning status to Prisma status
      const statusMap: Record<string, string> = {
        available: 'ACTIVE',
        assigned: 'ACTIVE',
        released: 'INACTIVE',
        pending: 'ACTIVE',
        failed: 'SUSPENDED',
      };
      where.status = statusMap[options.status] || 'ACTIVE';
    }

    if (options?.areaCode) {
      where.number = {
        startsWith: `+1${options.areaCode}`,
      };
    }

    const numbers = await prisma.phoneNumber.findMany({
      where,
      take: options?.limit || 100,
      skip: options?.offset || 0,
      orderBy: {
        createdAt: 'desc',
      },
    });

    return numbers.map(n => this.mapToProvisionedNumber(n));
  }

  async purchaseNumber(request: PurchaseNumberRequest): Promise<ProvisionedNumber> {
    // In local mode, we generate a mock number or use a test number
    // For real implementation, you'd read from a CSV or test number pool
    const mockNumber = this.generateMockNumber(request.areaCode);

    // Check if number already exists (but don't create it - provisioning service will)
    const prisma = getPrismaClient();
    const existing = await prisma.phoneNumber.findFirst({
      where: {
        number: mockNumber,
        provider: 'local',
      },
    });

    if (existing) {
      throw new Error(`Number ${mockNumber} already exists in local inventory`);
    }

    logger.info({ msg: 'Provisioned local number', number: mockNumber });

    // Return provisioned number data - provisioning service will save to DB
    return {
      id: `local-${mockNumber}`, // Temporary ID, will be replaced by DB ID
      number: mockNumber,
      provider: 'local',
      status: 'assigned',
      features: request.features || { voice: true },
      providerId: `local-${mockNumber}`,
      purchasedAt: new Date(),
      metadata: {
        areaCode: request.areaCode,
        features: request.features,
      },
    };
  }

  async releaseNumber(providerId: string): Promise<void> {
    const prisma = getPrismaClient();

    const number = await prisma.phoneNumber.findUnique({
      where: { id: providerId },
    });

    if (!number) {
      throw new Error(`Number not found: ${providerId}`);
    }

    // In local mode, we just mark it as released
    await prisma.phoneNumber.update({
      where: { id: providerId },
      data: {
        status: 'INACTIVE',
        releasedAt: new Date(),
      },
    });

    logger.info({ msg: 'Released local number', number: number.number });
  }

  async getNumber(providerId: string): Promise<ProvisionedNumber | null> {
    const prisma = getPrismaClient();

    const number = await prisma.phoneNumber.findUnique({
      where: { id: providerId },
    });

    if (!number) {
      return null;
    }

    return this.mapToProvisionedNumber(number);
  }

  async configureNumber(providerId: string, features: NumberFeatures): Promise<void> {
    const prisma = getPrismaClient();

    await prisma.phoneNumber.update({
      where: { id: providerId },
      data: {
        capabilities: features,
      },
    });

    logger.info({ msg: 'Configured local number', providerId, features });
  }

  /**
   * Generate a mock phone number for testing
   */
  private generateMockNumber(areaCode?: string): string {
    const ac = areaCode || '555';
    const exchange = Math.floor(Math.random() * 800) + 200; // 200-999
    const number = Math.floor(Math.random() * 10000)
      .toString()
      .padStart(4, '0');
    return `+1${ac}${exchange}${number}`;
  }

  /**
   * Map Prisma PhoneNumber to ProvisionedNumber
   */
  private mapToProvisionedNumber(dbNumber: any): ProvisionedNumber {
    const metadata = (dbNumber.metadata || {}) as Record<string, unknown>;

    return {
      id: dbNumber.id,
      number: dbNumber.number,
      provider: (dbNumber.provider as Provider) || 'local',
      status: this.mapStatus(dbNumber.status),
      features: dbNumber.capabilities as NumberFeatures,
      providerId: dbNumber.id,
      purchasedAt: dbNumber.purchasedAt || undefined,
      releasedAt: dbNumber.releasedAt || undefined,
      metadata,
    };
  }

  /**
   * Map Prisma PhoneNumberStatus to NumberStatus
   */
  private mapStatus(status: string): NumberStatus {
    switch (status) {
      case 'ACTIVE':
        return 'assigned';
      case 'INACTIVE':
        return 'released';
      case 'SUSPENDED':
        return 'failed';
      default:
        return 'available';
    }
  }
}
