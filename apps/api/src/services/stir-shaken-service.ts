import { getPrismaClient } from '../lib/prisma.js';

import { logger } from './logger.js';

export interface StirShakenHeaders {
  identity?: string;      // Identity header
  origId?: string;        // Originating Identity header
  passthru?: string;      // Passport header
}

export interface StirShakenAttestation {
  callId: string;
  tenantId: string;
  phoneNumber: string;
  attestation: 'A' | 'B' | 'C' | 'NONE';
  headers?: StirShakenHeaders;
  verifiedBy?: string;
}

export class StirShakenService {
  private prisma = getPrismaClient();

  /**
   * Store STIR/SHAKEN attestation status
   */
  async storeAttestation(
    callId: string,
    tenantId: string,
    phoneNumber: string,
    attestation: 'A' | 'B' | 'C' | 'NONE',
    options: {
      headers?: StirShakenHeaders;
      verifiedBy?: string;
      metadata?: Record<string, unknown>;
    } = {}
  ): Promise<string> {
    const status = await this.prisma.stirShakenStatus.upsert({
      where: { callId },
      create: {
        callId,
        tenantId,
        phoneNumber: this.normalizePhoneNumber(phoneNumber),
        attestation,
        identity: options.headers?.identity,
        origId: options.headers?.origId,
        passthru: options.headers?.passthru,
        verifiedAt: new Date(),
        verifiedBy: options.verifiedBy,
        metadata: options.metadata || {},
      },
      update: {
        attestation,
        identity: options.headers?.identity,
        origId: options.headers?.origId,
        passthru: options.headers?.passthru,
        verifiedAt: new Date(),
        verifiedBy: options.verifiedBy,
        metadata: options.metadata || {},
      },
    });

    logger.info(`Stored STIR/SHAKEN attestation ${attestation} for call ${callId}`);
    return status.id;
  }

  /**
   * Get attestation status for a call
   */
  async getAttestation(callId: string): Promise<StirShakenAttestation | null> {
    const status = await this.prisma.stirShakenStatus.findUnique({
      where: { callId },
    });

    if (!status) {
      return null;
    }

    return {
      callId: status.callId,
      tenantId: status.tenantId,
      phoneNumber: status.phoneNumber,
      attestation: status.attestation,
      headers: {
        identity: status.identity || undefined,
        origId: status.origId || undefined,
        passthru: status.passthru || undefined,
      },
      verifiedBy: status.verifiedBy || undefined,
    };
  }

  /**
   * Override attestation (admin function)
   */
  async overrideAttestation(
    callId: string,
    attestation: 'A' | 'B' | 'C' | 'NONE',
    reason: string,
    userId: string
  ): Promise<void> {
    await this.prisma.stirShakenStatus.update({
      where: { callId },
      data: {
        attestation,
        override: true,
        overrideReason: reason,
        overrideUserId: userId,
        updatedAt: new Date(),
      },
    });

    // Log audit
    await this.prisma.auditLog.create({
      data: {
        tenantId: (await this.prisma.stirShakenStatus.findUnique({ where: { callId } }))!.tenantId,
        userId,
        action: 'stir_shaken.override',
        entityType: 'stir_shaken_status',
        entityId: callId,
        changes: {
          attestation,
          reason,
        },
      },
    }).catch((err) => {
      logger.error('Failed to log audit:', err);
    });

    logger.info(`Overridden STIR/SHAKEN attestation for call ${callId} to ${attestation}`);
  }

  /**
   * Get attestation by phone number (for lookup)
   */
  async getAttestationByPhoneNumber(
    tenantId: string,
    phoneNumber: string
  ): Promise<StirShakenAttestation | null> {
    const normalized = this.normalizePhoneNumber(phoneNumber);
    
    const status = await this.prisma.stirShakenStatus.findFirst({
      where: {
        tenantId,
        phoneNumber: normalized,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (!status) {
      return null;
    }

    return {
      callId: status.callId,
      tenantId: status.tenantId,
      phoneNumber: status.phoneNumber,
      attestation: status.attestation,
      headers: {
        identity: status.identity || undefined,
        origId: status.origId || undefined,
        passthru: status.passthru || undefined,
      },
      verifiedBy: status.verifiedBy || undefined,
    };
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

export const stirShakenService = new StirShakenService();

