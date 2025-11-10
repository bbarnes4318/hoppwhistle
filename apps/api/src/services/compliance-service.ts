import { createHash } from 'crypto';

import { getPrismaClient } from '../lib/prisma.js';

import { logger } from './logger.js';

export interface ComplianceCheckResult {
  allowed: boolean;
  reason?: string;
  dncMatch?: {
    listId: string;
    listName: string;
    phoneNumber: string;
  };
  consentStatus?: 'verified' | 'missing' | 'expired' | 'revoked';
  override?: {
    id: string;
    expiresAt?: Date;
  };
}

export class ComplianceService {
  private prisma = getPrismaClient();

  /**
   * Check if a phone number is on DNC list
   */
  async checkDnc(
    tenantId: string,
    phoneNumber: string,
    campaignId?: string
  ): Promise<{ blocked: boolean; match?: { listId: string; listName: string } }> {
    // Normalize phone number (E.164 format)
    const normalized = this.normalizePhoneNumber(phoneNumber);

    // Check global DNC lists
    const globalDnc = await this.prisma.dncListEntry.findFirst({
      where: {
        phoneNumber: normalized,
        dncList: {
          tenantId,
          type: 'GLOBAL',
          status: 'ACTIVE',
        },
      },
      include: {
        dncList: true,
      },
    });

    if (globalDnc) {
      return {
        blocked: true,
        match: {
          listId: globalDnc.dncListId,
          listName: globalDnc.dncList.name,
        },
      };
    }

    // Check campaign-specific DNC if campaignId provided
    if (campaignId) {
      const campaignDnc = await this.prisma.dncListEntry.findFirst({
        where: {
          phoneNumber: normalized,
          dncList: {
            tenantId,
            type: 'CAMPAIGN',
            status: 'ACTIVE',
            metadata: {
              path: ['campaignId'],
              equals: campaignId,
            },
          },
        },
        include: {
          dncList: true,
        },
      });

      if (campaignDnc) {
        return {
          blocked: true,
          match: {
            listId: campaignDnc.dncListId,
            listName: campaignDnc.dncList.name,
          },
        };
      }
    }

    return { blocked: false };
  }

  /**
   * Check consent token status
   */
  async checkConsent(
    tenantId: string,
    phoneNumber: string,
    token?: string
  ): Promise<{ verified: boolean; status?: string; tokenId?: string }> {
    const normalized = this.normalizePhoneNumber(phoneNumber);

    // If token provided, check by token hash
    if (token) {
      const tokenHash = this.hashToken(token);
      const consent = await this.prisma.consentToken.findFirst({
        where: {
          tenantId,
          tokenHash,
          phoneNumber: normalized,
          status: 'VERIFIED',
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: new Date() } },
          ],
        },
      });

      if (consent) {
        return { verified: true, status: 'verified', tokenId: consent.id };
      }
    }

    // Check by phone number
    const consent = await this.prisma.consentToken.findFirst({
      where: {
        tenantId,
        phoneNumber: normalized,
        status: 'VERIFIED',
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      orderBy: {
        verifiedAt: 'desc',
      },
    });

    if (consent) {
      return { verified: true, status: 'verified', tokenId: consent.id };
    }

    return { verified: false, status: 'missing' };
  }

  /**
   * Check for active override
   */
  async checkOverride(
    tenantId: string,
    phoneNumber: string,
    callId?: string
  ): Promise<{ hasOverride: boolean; overrideId?: string; expiresAt?: Date }> {
    const normalized = this.normalizePhoneNumber(phoneNumber);

    const override = await this.prisma.complianceOverride.findFirst({
      where: {
        tenantId,
        phoneNumber: normalized,
        OR: [
          { callId: callId || null },
          { callId: null }, // Global override
        ],
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      orderBy: {
        approvedAt: 'desc',
      },
    });

    if (override) {
      return {
        hasOverride: true,
        overrideId: override.id,
        expiresAt: override.expiresAt || undefined,
      };
    }

    return { hasOverride: false };
  }

  /**
   * Full compliance check before routing to buyer
   */
  async checkCompliance(
    tenantId: string,
    phoneNumber: string,
    options: {
      campaignId?: string;
      consentToken?: string;
      callId?: string;
      enforceDnc?: boolean;
      enforceConsent?: boolean;
      allowOverride?: boolean;
    } = {}
  ): Promise<ComplianceCheckResult> {
    const {
      campaignId,
      consentToken,
      callId,
      enforceDnc = true,
      enforceConsent = true,
      allowOverride = false,
    } = options;

    // Check for override first
    if (allowOverride) {
      const override = await this.checkOverride(tenantId, phoneNumber, callId);
      if (override.hasOverride) {
        return {
          allowed: true,
          reason: 'Override approved',
          override: {
            id: override.overrideId!,
            expiresAt: override.expiresAt,
          },
        };
      }
    }

    // Check DNC
    if (enforceDnc) {
      const dncCheck = await this.checkDnc(tenantId, phoneNumber, campaignId);
      if (dncCheck.blocked) {
        return {
          allowed: false,
          reason: `Phone number is on DNC list: ${dncCheck.match?.listName}`,
          dncMatch: {
            listId: dncCheck.match!.listId,
            listName: dncCheck.match!.listName,
            phoneNumber,
          },
        };
      }
    }

    // Check consent
    if (enforceConsent) {
      const consentCheck = await this.checkConsent(tenantId, phoneNumber, consentToken);
      if (!consentCheck.verified) {
        return {
          allowed: false,
          reason: 'Consent token missing or invalid',
          consentStatus: consentCheck.status as any,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Create compliance override (requires admin approval if policy requires it)
   */
  async createOverride(
    tenantId: string,
    phoneNumber: string,
    reason: string,
    options: {
      callId?: string;
      userId?: string;
      expiresAt?: Date;
      policyId?: string;
    } = {}
  ): Promise<string> {
    const normalized = this.normalizePhoneNumber(phoneNumber);

    const override = await this.prisma.complianceOverride.create({
      data: {
        tenantId,
        phoneNumber: normalized,
        callId: options.callId,
        reason,
        userId: options.userId,
        expiresAt: options.expiresAt,
        policyId: options.policyId,
      },
    });

    // Log audit event
    await this.logAudit(tenantId, {
      action: 'compliance.override.created',
      entityType: 'compliance_override',
      entityId: override.id,
      changes: {
        phoneNumber: normalized,
        reason,
        callId: options.callId,
      },
      userId: options.userId,
    });

    logger.info(`Created compliance override for ${normalized} (tenant: ${tenantId})`);
    return override.id;
  }

  /**
   * Store consent token
   */
  async storeConsentToken(
    tenantId: string,
    phoneNumber: string,
    token: string,
    provider: 'TRUSTEDFORM' | 'JORNAYA' | 'CUSTOM',
    options: {
      callId?: string;
      ipAddress?: string;
      source?: string;
      expiresAt?: Date;
      metadata?: Record<string, unknown>;
    } = {}
  ): Promise<string> {
    const normalized = this.normalizePhoneNumber(phoneNumber);
    const tokenHash = this.hashToken(token);

    const consent = await this.prisma.consentToken.create({
      data: {
        tenantId,
        phoneNumber: normalized,
        callId: options.callId,
        token,
        tokenHash,
        provider,
        status: 'VERIFIED',
        verifiedAt: new Date(),
        ipAddress: options.ipAddress,
        source: options.source,
        expiresAt: options.expiresAt,
        metadata: options.metadata || {},
      },
    });

    logger.info(`Stored consent token for ${normalized} (provider: ${provider})`);
    return consent.id;
  }

  /**
   * Normalize phone number to E.164 format
   */
  private normalizePhoneNumber(phoneNumber: string): string {
    // Remove all non-digit characters except +
    let normalized = phoneNumber.replace(/[^\d+]/g, '');

    // If doesn't start with +, assume US number and add +1
    if (!normalized.startsWith('+')) {
      if (normalized.length === 10) {
        normalized = `+1${normalized}`;
      } else if (normalized.length === 11 && normalized.startsWith('1')) {
        normalized = `+${normalized}`;
      }
    }

    return normalized;
  }

  /**
   * Hash token for fast lookup
   */
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Log audit event
   */
  private async logAudit(
    tenantId: string,
    data: {
      action: string;
      entityType: string;
      entityId: string;
      changes?: Record<string, unknown>;
      userId?: string;
      ipAddress?: string;
      userAgent?: string;
    }
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          tenantId,
          userId: data.userId,
          action: data.action,
          entityType: data.entityType,
          entityId: data.entityId,
          changes: data.changes || {},
          ipAddress: data.ipAddress,
          userAgent: data.userAgent,
        },
      });
    } catch (error) {
      logger.error('Failed to log audit event:', error);
      // Don't throw - audit logging failure shouldn't break the flow
    }
  }
}

// Export singleton instance
export const complianceService = new ComplianceService();

