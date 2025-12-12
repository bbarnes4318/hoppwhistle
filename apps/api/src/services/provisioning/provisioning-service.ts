import { logger } from '../../lib/logger.js';
import { getPrismaClient } from '../../lib/prisma.js';
import { auditCreate, auditUpdate } from '../audit.js';

import { BandwidthAdapter } from './adapters/bandwidth-adapter.js';
import { LocalAdapter } from './adapters/local-adapter.js';
import { SignalWireAdapter } from './adapters/signalwire-adapter.js';
import { TelnyxAdapter } from './adapters/telnyx-adapter.js';
import type {
  Provider,
  ProvisionedNumber,
  PurchaseNumberRequest,
  ListNumbersOptions,
  AssignNumberRequest,
  AuditResult,
  NumberFeatures,
  ProvisioningAdapter,
} from './types.js';

// Default priority order for provider selection
const DEFAULT_PROVIDER_ORDER: Provider[] = ['signalwire', 'telnyx', 'bandwidth'];

interface TenantMetadata {
  defaultProvider?: Provider;
  [key: string]: unknown;
}

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

    // Initialize new adapters
    try {
      const telnyx = new TelnyxAdapter();
      if (telnyx.isConfigured()) {
        this.adapters.set('telnyx', telnyx);
      }
    } catch (error) {
      logger.warn('Telnyx adapter not configured, skipping');
    }

    try {
      const bandwidth = new BandwidthAdapter();
      if (bandwidth.isConfigured()) {
        this.adapters.set('bandwidth', bandwidth);
      }
    } catch (error) {
      logger.warn('Bandwidth adapter not configured, skipping');
    }
  }

  /**
   * Get adapter for a provider
   */
  private getAdapter(provider: Provider): ProvisioningAdapter {
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      throw new Error(`Provider ${provider} not supported or not configured`);
    }
    return adapter;
  }

  /**
   * List numbers from a provider
   */
  async listNumbers(
    provider: Provider,
    options?: ListNumbersOptions
  ): Promise<ProvisionedNumber[]> {
    const adapter = this.getAdapter(provider);
    return adapter.listNumbers(options);
  }

  /**
   * Purchase a number from a provider
   */
  async purchaseNumber(
    provider: Provider | undefined | null,
    request: PurchaseNumberRequest,
    context: {
      userId?: string;
      tenantId: string;
      ipAddress?: string;
      requestId?: string;
    }
  ): Promise<ProvisionedNumber> {
    // 1. Use passed provider, or resolve based on tenant/config
    const selectedProvider = provider || (await this.getProviderForTenant(context.tenantId));
    const adapter = this.getAdapter(selectedProvider);

    // 2. Purchase from provider
    const provisioned = await adapter.purchaseNumber(request);

    // 3. Sync to database
    const prisma = getPrismaClient();
    const dbNumber = await prisma.phoneNumber.create({
      data: {
        tenantId: context.tenantId,
        number: provisioned.number,
        provider: selectedProvider,
        status: 'ACTIVE',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
        capabilities: provisioned.features as any,
        purchasedAt: provisioned.purchasedAt || new Date(),
        metadata: {
          providerId: provisioned.providerId,
          ...provisioned.metadata,
        },
      },
    });

    // 4. Audit log
    await auditCreate(
      context.tenantId,
      'PhoneNumber',
      dbNumber.id,
      {
        number: provisioned.number,
        provider: selectedProvider,
        providerId: provisioned.providerId,
        features: provisioned.features,
      },
      context
    );

    logger.info({
      msg: 'Purchased number',
      provider: selectedProvider,
      number: provisioned.number,
      tenantId: context.tenantId,
    });

    return {
      ...provisioned,
      id: dbNumber.id,
    };
  }

  /**
   * Get preferred provider for tenant
   *
   * Selection logic:
   * 1. Tenant preference (metadata.defaultProvider)
   * 2. Environment variable (DEFAULT_PROVIDER)
   * 3. Development fallback (local)
   * 4. Configured adapter order (SignalWire -> Telnyx -> Bandwidth)
   */
  async getProviderForTenant(tenantId: string): Promise<Provider> {
    const prisma = getPrismaClient();
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { metadata: true },
    });

    // 1. Check tenant preference
    if (tenant?.metadata) {
      const metadata = tenant.metadata as TenantMetadata;
      if (metadata.defaultProvider && this.adapters.has(metadata.defaultProvider)) {
        return metadata.defaultProvider;
      }
    }

    // 2. Check environment variable
    const defaultProvider = process.env.DEFAULT_PROVIDER as Provider;
    if (defaultProvider && this.adapters.has(defaultProvider)) {
      return defaultProvider;
    }

    // 3. Development fallback
    if (process.env.NODE_ENV === 'development') {
      return 'local';
    }

    // 4. Check configured adapters in priority order
    for (const provider of DEFAULT_PROVIDER_ORDER) {
      if (this.adapters.has(provider)) {
        return provider;
      }
    }

    // Fallback if nothing configured (shouldn't happen in prod if properly set up)
    return 'local';
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
    try {
      const adapter = this.getAdapter(provider);
      await adapter.releaseNumber(providerId);
    } catch (error) {
      logger.error({ msg: 'Failed to release number from provider', error, provider, providerId });
      // Continue to release in DB even if provider fails?
      // Usually yes, to avoid zombie records, but maybe flag it.
      // For now, we'll throw to let user know.
      throw error;
    }

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
    await auditUpdate(request.tenantId, 'PhoneNumber', dbNumber.id, before, after, context);

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
  async auditInventory(provider: Provider, tenantId?: string): Promise<AuditResult> {
    const prisma = getPrismaClient();
    const adapter = this.getAdapter(provider);

    // Get local numbers
    const localWhere: { provider: Provider; tenantId?: string } = {
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

    const providerMap = new Map(providerNumbers.map(n => [n.providerId || n.id, n]));

    // Find discrepancies
    const missingInProvider: ProvisionedNumber[] = [];
    const missingInLocal: ProvisionedNumber[] = [];
    const statusMismatch: Array<{ local: ProvisionedNumber; provider: ProvisionedNumber }> = [];

    // Check local numbers
    for (const [providerId, localNumber] of Array.from(localMap.entries())) {
      const providerNumber = providerMap.get(providerId);
      const dbNumber = localNumber;

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
        const dbNumber = localNumber;
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
