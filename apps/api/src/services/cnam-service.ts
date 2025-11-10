import { getPrismaClient } from '../lib/prisma.js';

import { logger } from './logger.js';

export interface CnamProvider {
  name: string;
  lookup(phoneNumber: string): Promise<{ callerName: string | null; metadata?: Record<string, unknown> }>;
}

export interface CnamResult {
  callerName: string | null;
  provider: string;
  cached: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Mock CNAM provider for testing
 */
export class MockCnamProvider implements CnamProvider {
  name = 'mock';

  async lookup(phoneNumber: string): Promise<{ callerName: string | null; metadata?: Record<string, unknown> }> {
    // Mock implementation - returns fake names based on area code
    const areaCode = phoneNumber.slice(2, 5);
    const mockNames: Record<string, string> = {
      '212': 'John Smith',
      '310': 'Jane Doe',
      '415': 'Bob Johnson',
      '646': 'Alice Williams',
    };

    const callerName = mockNames[areaCode] || null;

    return {
      callerName,
      metadata: {
        source: 'mock',
        areaCode,
      },
    };
  }
}

/**
 * Twilio CNAM provider (placeholder)
 */
export class TwilioCnamProvider implements CnamProvider {
  name = 'twilio';
  private apiKey?: string;
  private apiSecret?: string;

  constructor(apiKey?: string, apiSecret?: string) {
    this.apiKey = apiKey || process.env.TWILIO_API_KEY;
    this.apiSecret = apiSecret || process.env.TWILIO_API_SECRET;
  }

  async lookup(phoneNumber: string): Promise<{ callerName: string | null; metadata?: Record<string, unknown> }> {
    if (!this.apiKey || !this.apiSecret) {
      logger.warn('Twilio credentials not configured, using mock');
      return new MockCnamProvider().lookup(phoneNumber);
    }

    try {
      // Placeholder - replace with actual Twilio Lookup API call
      const response = await fetch(
        `https://lookups.twilio.com/v1/PhoneNumbers/${encodeURIComponent(phoneNumber)}?Type=caller-name`,
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
        callerName: data.caller_name?.caller_name || null,
        metadata: {
          source: 'twilio',
          countryCode: data.country_code,
        },
      };
    } catch (error) {
      logger.error('Twilio CNAM lookup failed:', error);
      return {
        callerName: null,
        metadata: {
          error: error instanceof Error ? error.message : 'Lookup failed',
        },
      };
    }
  }
}

export class CnamService {
  private prisma = getPrismaClient();
  private providers: Map<string, CnamProvider> = new Map();
  private defaultProvider: CnamProvider;

  constructor() {
    // Register providers
    const mockProvider = new MockCnamProvider();
    this.providers.set('mock', mockProvider);
    this.defaultProvider = mockProvider;

    // Register Twilio if credentials available
    if (process.env.TWILIO_API_KEY && process.env.TWILIO_API_SECRET) {
      const twilioProvider = new TwilioCnamProvider();
      this.providers.set('twilio', twilioProvider);
      this.defaultProvider = twilioProvider;
    }
  }

  /**
   * Register a custom CNAM provider
   */
  registerProvider(provider: CnamProvider): void {
    this.providers.set(provider.name, provider);
  }

  /**
   * Lookup caller name for a phone number
   */
  async lookup(
    tenantId: string,
    phoneNumber: string,
    options: {
      provider?: string;
      useCache?: boolean;
      cacheTtl?: number; // seconds
    } = {}
  ): Promise<CnamResult> {
    const normalized = this.normalizePhoneNumber(phoneNumber);
    const { provider: providerName, useCache = true, cacheTtl = 86400 } = options;

    // Check cache first
    if (useCache) {
      const cached = await this.prisma.cnamLookup.findUnique({
        where: {
          tenantId_phoneNumber: {
            tenantId,
            phoneNumber: normalized,
          },
        },
      });

      if (cached && cached.cachedUntil && cached.cachedUntil > new Date()) {
        return {
          callerName: cached.callerName,
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

    await this.prisma.cnamLookup.upsert({
      where: {
        tenantId_phoneNumber: {
          tenantId,
          phoneNumber: normalized,
        },
      },
      create: {
        tenantId,
        phoneNumber: normalized,
        callerName: result.callerName,
        provider: provider.name,
        cached: true,
        cachedUntil,
        metadata: result.metadata || {},
      },
      update: {
        callerName: result.callerName,
        provider: provider.name,
        cached: true,
        cachedUntil,
        metadata: result.metadata || {},
        updatedAt: new Date(),
      },
    });

    return {
      callerName: result.callerName,
      provider: provider.name,
      cached: false,
      metadata: result.metadata,
    };
  }

  /**
   * Override caller name (admin function)
   */
  async overrideCallerName(
    tenantId: string,
    phoneNumber: string,
    callerName: string | null,
    reason: string
  ): Promise<void> {
    const normalized = this.normalizePhoneNumber(phoneNumber);

    await this.prisma.cnamLookup.upsert({
      where: {
        tenantId_phoneNumber: {
          tenantId,
          phoneNumber: normalized,
        },
      },
      create: {
        tenantId,
        phoneNumber: normalized,
        callerName,
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
        callerName,
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

    logger.info(`Overridden CNAM for ${normalized} to "${callerName}"`);
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

export const cnamService = new CnamService();

