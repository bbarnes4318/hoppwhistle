import { getPrismaClient } from '../lib/prisma.js';

import { logger } from './logger.js';

export interface CarrierProvider {
  name: string;
  lookup(phoneNumber: string): Promise<{
    carrier: string | null;
    lata: string | null;
    ocn: string | null;
    metadata?: Record<string, unknown>;
  }>;
}

export interface CarrierResult {
  carrier: string | null;
  lata: string | null;
  ocn: string | null;
  provider: string;
  cached: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Mock carrier provider for testing
 */
export class MockCarrierProvider implements CarrierProvider {
  name = 'mock';

  async lookup(phoneNumber: string): Promise<{
    carrier: string | null;
    lata: string | null;
    ocn: string | null;
    metadata?: Record<string, unknown>;
  }> {
    // Mock implementation - returns fake carrier data based on area code
    const areaCode = phoneNumber.slice(2, 5);
    const mockData: Record<string, { carrier: string; lata: string; ocn: string }> = {
      '212': { carrier: 'Verizon', lata: '132', ocn: '1234' },
      '310': { carrier: 'AT&T', lata: '730', ocn: '5678' },
      '415': { carrier: 'T-Mobile', lata: '712', ocn: '9012' },
      '646': { carrier: 'Sprint', lata: '132', ocn: '3456' },
    };

    const data = mockData[areaCode] || {
      carrier: 'Unknown',
      lata: '000',
      ocn: '0000',
    };

    return {
      carrier: data.carrier,
      lata: data.lata,
      ocn: data.ocn,
      metadata: {
        source: 'mock',
        areaCode,
      },
    };
  }
}

/**
 * Twilio Carrier provider (placeholder)
 */
export class TwilioCarrierProvider implements CarrierProvider {
  name = 'twilio';
  private apiKey?: string;
  private apiSecret?: string;

  constructor(apiKey?: string, apiSecret?: string) {
    this.apiKey = apiKey || process.env.TWILIO_API_KEY;
    this.apiSecret = apiSecret || process.env.TWILIO_API_SECRET;
  }

  async lookup(phoneNumber: string): Promise<{
    carrier: string | null;
    lata: string | null;
    ocn: string | null;
    metadata?: Record<string, unknown>;
  }> {
    if (!this.apiKey || !this.apiSecret) {
      logger.warn('Twilio credentials not configured, using mock');
      return new MockCarrierProvider().lookup(phoneNumber);
    }

    try {
      // Placeholder - replace with actual Twilio Lookup API call
      const response = await fetch(
        `https://lookups.twilio.com/v1/PhoneNumbers/${encodeURIComponent(phoneNumber)}?Type=carrier`,
        {
          headers: {
            'Authorization': `Basic ${Buffer.from(`${this.apiKey}:${this.apiSecret}`).toString('base64')}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Twilio API error: ${response.statusText}`);
      }

      const data = await response.json();
      return {
        carrier: data.carrier?.name || null,
        lata: data.carrier?.mobile_country_code || null,
        ocn: data.carrier?.mobile_network_code || null,
        metadata: {
          source: 'twilio',
          type: data.carrier?.type,
          countryCode: data.country_code,
        },
      };
    } catch (error) {
      logger.error('Twilio carrier lookup failed:', error);
      return {
        carrier: null,
        lata: null,
        ocn: null,
        metadata: {
          error: error instanceof Error ? error.message : 'Lookup failed',
        },
      };
    }
  }
}

export class CarrierService {
  private prisma = getPrismaClient();
  private providers: Map<string, CarrierProvider> = new Map();
  private defaultProvider: CarrierProvider;

  constructor() {
    // Register providers
    const mockProvider = new MockCarrierProvider();
    this.providers.set('mock', mockProvider);
    this.defaultProvider = mockProvider;

    // Register Twilio if credentials available
    if (process.env.TWILIO_API_KEY && process.env.TWILIO_API_SECRET) {
      const twilioProvider = new TwilioCarrierProvider();
      this.providers.set('twilio', twilioProvider);
      this.defaultProvider = twilioProvider;
    }
  }

  /**
   * Register a custom carrier provider
   */
  registerProvider(provider: CarrierProvider): void {
    this.providers.set(provider.name, provider);
  }

  /**
   * Lookup carrier information for a phone number
   */
  async lookup(
    tenantId: string,
    phoneNumber: string,
    options: {
      provider?: string;
      useCache?: boolean;
      cacheTtl?: number; // seconds
    } = {}
  ): Promise<CarrierResult> {
    const normalized = this.normalizePhoneNumber(phoneNumber);
    const { provider: providerName, useCache = true, cacheTtl = 86400 } = options;

    // Check cache first
    if (useCache) {
      const cached = await this.prisma.carrierLookup.findUnique({
        where: {
          tenantId_phoneNumber: {
            tenantId,
            phoneNumber: normalized,
          },
        },
      });

      if (cached && cached.cachedUntil && cached.cachedUntil > new Date()) {
        return {
          carrier: cached.carrier,
          lata: cached.lata,
          ocn: cached.ocn,
          provider: cached.provider,
          cached: true,
          metadata: cached.metadata as Record<string, unknown> | undefined,
        };
      }
    }

    // Perform lookup
    const provider = providerName
      ? this.providers.get(providerName) || this.defaultProvider
      : this.defaultProvider;

    const result = await provider.lookup(normalized);

    // Store in cache
    const cachedUntil = new Date();
    cachedUntil.setSeconds(cachedUntil.getSeconds() + cacheTtl);

    await this.prisma.carrierLookup.upsert({
      where: {
        tenantId_phoneNumber: {
          tenantId,
          phoneNumber: normalized,
        },
      },
      create: {
        tenantId,
        phoneNumber: normalized,
        carrier: result.carrier,
        lata: result.lata,
        ocn: result.ocn,
        provider: provider.name,
        cached: true,
        cachedUntil,
        metadata: result.metadata || {},
      },
      update: {
        carrier: result.carrier,
        lata: result.lata,
        ocn: result.ocn,
        provider: provider.name,
        cached: true,
        cachedUntil,
        metadata: result.metadata || {},
        updatedAt: new Date(),
      },
    });

    return {
      carrier: result.carrier,
      lata: result.lata,
      ocn: result.ocn,
      provider: provider.name,
      cached: false,
      metadata: result.metadata,
    };
  }

  /**
   * Override carrier information (admin function)
   */
  async overrideCarrier(
    tenantId: string,
    phoneNumber: string,
    carrier: string | null,
    lata: string | null,
    ocn: string | null,
    reason: string
  ): Promise<void> {
    const normalized = this.normalizePhoneNumber(phoneNumber);

    await this.prisma.carrierLookup.upsert({
      where: {
        tenantId_phoneNumber: {
          tenantId,
          phoneNumber: normalized,
        },
      },
      create: {
        tenantId,
        phoneNumber: normalized,
        carrier,
        lata,
        ocn,
        provider: 'override',
        cached: true,
        cachedUntil: null, // Never expires
        metadata: {
          override: true,
          reason,
          overriddenAt: new Date().toISOString(),
        },
      },
      update: {
        carrier,
        lata,
        ocn,
        provider: 'override',
        cached: true,
        cachedUntil: null,
        metadata: {
          override: true,
          reason,
          overriddenAt: new Date().toISOString(),
        },
        updatedAt: new Date(),
      },
    });

    logger.info(`Overridden carrier for ${normalized}: ${carrier} (LATA: ${lata}, OCN: ${ocn})`);
  }

  /**
   * Normalize phone number to E.164 format
   */
  private normalizePhoneNumber(phoneNumber: string): string {
    let normalized = phoneNumber.replace(/[^\d+]/g, '');
    if (!normalized.startsWith('+')) {
      if (normalized.length === 10) {
        normalized = `+1${normalized}`;
      } else if (normalized.length === 11 && normalized.startsWith('1')) {
        normalized = `+${normalized}`;
      }
    }
    return normalized;
  }
}

export const carrierService = new CarrierService();

