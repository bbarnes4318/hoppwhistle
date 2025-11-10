import type {
  Provider,
  ProvisionedNumber,
  PurchaseNumberRequest,
  ListNumbersOptions,
  AssignNumberRequest,
  AuditResult,
  NumberFeatures,
} from './types.js';
import { LocalAdapter } from './adapters/local-adapter.js';
import { SignalWireAdapter } from './adapters/signalwire-adapter.js';
import { TelnyxAdapter } from './adapters/telnyx-adapter.js';
import { BandwidthAdapter } from './adapters/bandwidth-adapter.js';
import type { ProvisioningAdapter } from './types.js';
import { getPrismaClient } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { auditLog, auditCreate, auditUpdate } from '../audit.js';

/**
 * Provisioning Service
 * 
 * Unified service for managing phone number provisioning across multiple providers.
 * Handles adapter selection, database synchronization, and audit logging.
 */
export class ProvisioningService {
  private adapters: Map<Provider, ProvisioningAdapter>;

  constructor() {
    this.adapters = new Map();
    
    // Initialize adapters
    this.adapters.set('local', new LocalAdapter());
    
    // Only initialize configured adapters
    try {
      const signalwire = new SignalWireAdapter();
      if (signalwire.isConfigured()) {
        this.adapters.set('signalwire', signalwire);
      }
    } catch (error) {
      logger.warn('SignalWire adapter not configured, skipping');
    }

    // Placeholder adapters (not configured yet)
    this.adapters.set('telnyx', new TelnyxAdapter());
    this.adapters.set('bandwidth', new BandwidthAdapter());
  }

  /**
   * Get adapter for a provider
   */
  private getAdapter(provider: Provider): ProvisioningAdapter {
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      throw new Error(`Provider ${provider} not supported`);
    }
    if (!adapter.isConfigured()) {
      throw new Error(`Provider ${provider} is not configured`);
    }
    return adapter;
  }

  /**
   * List numbers from a provider
   */
  async listNumbers(provider: Provider, options?: ListNumbersOptions): Promise<ProvisionedNumber[]> {
    const adapter = this.getAdapter(provider);
    return adapter.listNumbers(options);
  }

  /**
   * Purchase a number from a provider
   */
  async purchaseNumber(
    provider: Provider,
    request: PurchaseNumberRequest,
    context: {
      userId?: string;
      tenantId: string;
      ipAddress?: string;
      requestId?: string;
    }
  ): Promise<ProvisionedNumber> {
    const adapter = this.getAdapter(provider);
    const provisioned = await adapter.purchaseNumber(request);

    // Sync to database
    const prisma = getPrismaClient();
    const dbNumber = await prisma.phoneNumber.create({
      data: {
        tenantId: context.tenantId,
        number: provisioned.number,
        provider: provider,
        status: 'ACTIVE',
        capabilities: provisioned.features,
        purchasedAt: provisioned.purchasedAt || new Date(),
        metadata: {
          providerId: provisioned.providerId,
          ...provisioned.metadata,
        },
      },
    });

    // Audit log
    await auditCreate(
      context.tenantId,
      'PhoneNumber',
      dbNumber.id,
      {
        number: provisioned.number,
        provider,
        providerId: provisioned.providerId,
        features: provisioned.features,
      },
      context
    );

    logger.info({
      msg: 'Purchased number',
      provider,
      number: provisioned.number,
      tenantId: context.tenantId,
    });

    return {
      ...provisioned,
      id: dbNumber.id,
    };
  }

  /**
   * Release a number back to the provider
   */
  async releaseNumber(
    numberId: string,
    context: {
      userId?: string;
      tenantId: string;
      ipAddress?: string;
      requestId?: string;
    }
  ): Promise<void> {
    const prisma = getPrismaClient();
    const dbNumber = await prisma.phoneNumber.findUnique({
      where: { id: numberId },
    });

    if (!dbNumber) {
      throw new Error(`Number not found: ${numberId}`);
    }

    if (dbNumber.tenantId !== context.tenantId) {
      throw new Error('Number does not belong to tenant');
    }

    const metadata = (dbNumber.metadata || {}) as Record<string, unknown>;
    const provider = (dbNumber.provider as Provider) || 'local';
    const providerId = (metadata.providerId as string) || numberId;

    // Release from provider
    const adapter = this.getAdapter(provider);
    await adapter.releaseNumber(providerId);

    // Update database
    await prisma.phoneNumber.update({
      where: { id: numberId },
      data: {
        status: 'INACTIVE',
        releasedAt: new Date(),
      },
    });

    // Audit log
    await auditUpdate(
      context.tenantId,
      'PhoneNumber',
      numberId,
      { status: dbNumber.status },
      { status: 'INACTIVE', releasedAt: new Date().toISOString() },
      context
    );

    logger.info({
      msg: 'Released number',
      provider,
      number: dbNumber.number,
      tenantId: context.tenantId,
    });
  }

  /**
   * Assign a number to a campaign
   */
  async assignNumberToCampaign(
    request: AssignNumberRequest,
    context: {
      userId?: string;
      tenantId: string;
      ipAddress?: string;
      requestId?: string;
      overrideToken?: string;
    }
  ): Promise<ProvisionedNumber> {
    const prisma = getPrismaClient();

    // Check phone number quota
    const { quotaService } = await import('../quota-service.js');
    const quotaCheck = await quotaService.checkPhoneNumberQuota(
      request.tenantId,
      context.overrideToken
    );

    if (!quotaCheck.allowed) {
      throw new Error(quotaCheck.reason || 'Phone number quota exceeded');
    }

    // Find the number
    const dbNumber = await prisma.phoneNumber.findFirst({
      where: {
        number: request.number,
        tenantId: request.tenantId,
      },
    });

    if (!dbNumber) {
      throw new Error(`Number ${request.number} not found for tenant`);
    }

    if (dbNumber.status !== 'ACTIVE') {
      throw new Error(`Number ${request.number} is not active`);
    }

    // Update assignment
    const before = { campaignId: dbNumber.campaignId };
    const after = { campaignId: request.campaignId };

    await prisma.phoneNumber.update({
      where: { id: dbNumber.id },
      data: {
        campaignId: request.campaignId,
        metadata: {
          ...((dbNumber.metadata || {}) as Record<string, unknown>),
          assignedAt: new Date().toISOString(),
        },
      },
    });

    // Audit log
    await auditUpdate(
      request.tenantId,
      'PhoneNumber',
      dbNumber.id,
      before,
      after,
      context
    );

    logger.info({
      msg: 'Assigned number to campaign',
      number: request.number,
      campaignId: request.campaignId,
      tenantId: request.tenantId,
    });

    const metadata = (dbNumber.metadata || {}) as Record<string, unknown>;
    return {
      id: dbNumber.id,
      number: dbNumber.number,
      provider: (metadata.provider as Provider) || 'local',
      status: 'assigned',
      features: dbNumber.capabilities as NumberFeatures,
      providerId: metadata.providerId as string,
      metadata: {
        ...metadata,
        campaignId: request.campaignId,
      },
    };
  }

  /**
   * Audit inventory - compare local DB with provider inventory
   */
  async auditInventory(
    provider: Provider,
    tenantId?: string
  ): Promise<AuditResult> {
    const prisma = getPrismaClient();
    const adapter = this.getAdapter(provider);

    // Get local numbers
    const localWhere: any = {
      provider: provider,
    };

    if (tenantId) {
      localWhere.tenantId = tenantId;
    }

    const localDbNumbers = await prisma.phoneNumber.findMany({
      where: localWhere,
    });

    // Get provider numbers
    const providerNumbers = await adapter.listNumbers();

    // Create maps for comparison
    const localMap = new Map(
      localDbNumbers.map(n => {
        const metadata = (n.metadata || {}) as Record<string, unknown>;
        const providerId = (metadata.providerId as string) || n.id;
        return [providerId || n.id, n];
      })
    );

    const providerMap = new Map(
      providerNumbers.map(n => [n.providerId || n.id, n])
    );

    // Find discrepancies
    const missingInProvider: ProvisionedNumber[] = [];
    const missingInLocal: ProvisionedNumber[] = [];
    const statusMismatch: Array<{ local: ProvisionedNumber; provider: ProvisionedNumber }> = [];

    // Check local numbers
    for (const [providerId, localNumber] of Array.from(localMap.entries())) {
      const providerNumber = providerMap.get(providerId);
      const dbNumber = localNumber as any;
      
      if (!providerNumber) {
        const metadata = (dbNumber.metadata || {}) as Record<string, unknown>;
        missingInProvider.push({
          id: dbNumber.id,
          number: dbNumber.number,
          provider: (dbNumber.provider as Provider) || provider,
          status: dbNumber.status === 'ACTIVE' ? 'assigned' : 'released',
          providerId: providerId,
          metadata: metadata,
        });
      }
    }

    // Check provider numbers
    for (const [providerId, providerNumber] of Array.from(providerMap.entries())) {
      const localNumber = localMap.get(providerId);
      
      if (!localNumber) {
        missingInLocal.push(providerNumber);
      } else {
        // Check status mismatch
        const dbNumber = localNumber as any;
        const localStatus = dbNumber.status === 'ACTIVE' ? 'assigned' : 'released';
        if (localStatus !== providerNumber.status) {
          const metadata = (dbNumber.metadata || {}) as Record<string, unknown>;
          statusMismatch.push({
            local: {
              id: dbNumber.id,
              number: dbNumber.number,
              provider: (dbNumber.provider as Provider) || provider,
              status: localStatus,
              providerId: providerId,
              metadata: metadata,
            },
            provider: providerNumber,
          });
        }
      }
    }

    return {
      localNumbers: localDbNumbers.map(n => {
        const metadata = (n.metadata || {}) as Record<string, unknown>;
        return {
          id: n.id,
          number: n.number,
          provider: (n.provider as Provider) || provider,
          status: n.status === 'ACTIVE' ? 'assigned' : 'released',
          providerId: (metadata.providerId as string) || n.id,
          purchasedAt: n.purchasedAt || undefined,
          releasedAt: n.releasedAt || undefined,
          metadata: metadata,
        };
      }),
      providerNumbers,
      discrepancies: {
        missingInProvider,
        missingInLocal,
        statusMismatch,
      },
    };
  }

  /**
   * Get available providers
   */
  getAvailableProviders(): Provider[] {
    return Array.from(this.adapters.entries())
      .filter(([_, adapter]) => adapter.isConfigured())
      .map(([provider]) => provider);
  }
}

export const provisioningService = new ProvisioningService();

