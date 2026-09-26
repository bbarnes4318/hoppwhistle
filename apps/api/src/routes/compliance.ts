import type { DncListType, Prisma } from '@prisma/client';
import { FastifyInstance } from 'fastify';

import { getPrismaClient } from '../lib/prisma.js';
import {
  getActingTenantId,
  getActingUserId,
  resolveTenant,
  sendTenantRefusal,
} from '../lib/tenant-context.js';
import { compliancePolicyService } from '../services/compliance-policy-service.js';
import { complianceService } from '../services/compliance-service.js';
import { consentProviderService } from '../services/consent-provider-service.js';

const prisma = getPrismaClient();

export function registerComplianceRoutes(fastify: FastifyInstance): Promise<void> {
  // Check compliance for a phone number
  fastify.post<{
    Body: {
      phoneNumber: string;
      campaignId?: string;
      consentToken?: string;
      callId?: string;
    };
  }>('/api/v1/compliance/check', async (request, reply) => {
    try {
      const { phoneNumber, campaignId, consentToken, callId } = request.body;
      const tenantId = resolveTenant(request, reply);
      if (!tenantId) return;

      const policy = await compliancePolicyService.getEffectivePolicy(tenantId);
      const result = await complianceService.checkCompliance(tenantId, phoneNumber, {
        campaignId,
        consentToken,
        callId,
        enforceDnc: policy.enforceDnc,
        enforceConsent: policy.enforceConsent,
        allowOverride: policy.allowOverride,
      });

      return {
        allowed: result.allowed,
        reason: result.reason,
        dncMatch: result.dncMatch,
        consentStatus: result.consentStatus,
        override: result.override,
      };
    } catch (error) {
      void reply.code(400);
      return {
        error: {
          code: 'COMPLIANCE_CHECK_ERROR',
          message: error instanceof Error ? error.message : 'Failed to check compliance',
        },
      };
    }
  });

  // Create compliance override
  fastify.post<{
    Body: {
      phoneNumber: string;
      reason: string;
      callId?: string;
      expiresAt?: string;
    };
  }>('/api/v1/compliance/override', async (request, reply) => {
    try {
      const { phoneNumber, reason, callId, expiresAt } = request.body;
      const tenantId = resolveTenant(request, reply);
      if (!tenantId) return;
      const userId = getActingUserId(request) ?? undefined;

      const policy = await compliancePolicyService.getEffectivePolicy(tenantId);
      if (!policy.allowOverride) {
        void reply.code(403);
        return {
          error: {
            code: 'OVERRIDE_NOT_ALLOWED',
            message: 'Overrides are not allowed for this tenant',
          },
        };
      }

      const overrideId = await complianceService.createOverride(tenantId, phoneNumber, reason, {
        callId,
        userId,
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
      });

      return {
        success: true,
        overrideId,
      };
    } catch (error) {
      void reply.code(400);
      return {
        error: {
          code: 'OVERRIDE_ERROR',
          message: error instanceof Error ? error.message : 'Failed to create override',
        },
      };
    }
  });

  // Store consent token
  fastify.post<{
    Body: {
      phoneNumber: string;
      token: string;
      provider: 'TRUSTEDFORM' | 'JORNAYA' | 'CUSTOM';
      callId?: string;
      ipAddress?: string;
      source?: string;
      expiresAt?: string;
    };
  }>('/api/v1/compliance/consent', async (request, reply) => {
    try {
      const {
        phoneNumber,
        token,
        provider,
        callId,
        ipAddress,
        source,
        expiresAt,
      } = request.body;
      const tenantId = resolveTenant(request, reply);
      if (!tenantId) return;

      // Verify token with provider if not CUSTOM
      if (provider !== 'CUSTOM') {
        const verification = await consentProviderService.verifyToken(token, provider);
        if (!verification.verified) {
          void reply.code(400);
          return {
            error: {
              code: 'TOKEN_VERIFICATION_FAILED',
              message: verification.error || 'Token verification failed',
            },
          };
        }
      }

      const consentId = await complianceService.storeConsentToken(
        tenantId,
        phoneNumber,
        token,
        provider,
        {
          callId,
          ipAddress,
          source,
          expiresAt: expiresAt ? new Date(expiresAt) : undefined,
        }
      );

      return {
        success: true,
        consentId,
      };
    } catch (error) {
      void reply.code(400);
      return {
        error: {
          code: 'CONSENT_STORAGE_ERROR',
          message: error instanceof Error ? error.message : 'Failed to store consent token',
        },
      };
    }
  });

  // List DNC lists
  fastify.get('/api/v1/compliance/dnc-lists', async (request, reply) => {
    const tenantId = getActingTenantId(request);
    
    if (!tenantId) {
      return sendTenantRefusal(request, reply);
    }

    const { type } = request.query as { type?: string };

    const where: Prisma.DncListWhereInput = { tenantId };
    if (type) {
      where.type = type as DncListType;
    }

    const lists = await prisma.dncList.findMany({
      where,
      include: {
        _count: {
          select: { entries: true },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return {
      data: lists.map((list) => ({
        id: list.id,
        name: list.name,
        type: list.type,
        status: list.status.toLowerCase(),
        entryCount: list._count.entries,
        createdAt: list.createdAt.toISOString(),
        updatedAt: list.updatedAt.toISOString(),
      })),
    };
  });

  // Create DNC list
  fastify.post<{
    Body: {
      name: string;
      type: 'GLOBAL' | 'CAMPAIGN' | 'CUSTOM';
      campaignId?: string;
    };
  }>('/api/v1/compliance/dnc-lists', async (request, reply) => {
    try {
      const userId = getActingUserId(request) ?? undefined;
      const tenantId = getActingTenantId(request);
      
      if (!tenantId) {
        return sendTenantRefusal(request, reply);
      }

      const { name, type, campaignId } = request.body;

      if (!name || !name.trim()) {
        void reply.code(400);
        return { error: { code: 'VALIDATION_ERROR', message: 'Name is required' } };
      }

      // Verify campaign exists if provided
      if (campaignId) {
        const campaign = await prisma.campaign.findFirst({
          where: {
            id: campaignId,
            tenantId,
          },
        });

        if (!campaign) {
          void reply.code(404);
          return { error: { code: 'NOT_FOUND', message: 'Campaign not found' } };
        }
      }

      const list = await prisma.dncList.create({
        data: {
          tenantId,
          name: name.trim(),
          type,
          status: 'ACTIVE',
          metadata: campaignId ? { campaignId } : undefined,
        },
        include: {
          _count: {
            select: { entries: true },
          },
        },
      });

      // Audit log
      const { auditCreate } = await import('../services/audit.js');
      await auditCreate(
        tenantId,
        'DncList',
        list.id,
        {
          name: list.name,
          type: list.type,
          campaignId,
        },
        {
          userId,
          ipAddress: request.ip,
          requestId: request.id,
        }
      );

      void reply.code(201);
      return {
        id: list.id,
        name: list.name,
        type: list.type,
        status: list.status.toLowerCase(),
        entryCount: list._count.entries,
        createdAt: list.createdAt.toISOString(),
        updatedAt: list.updatedAt.toISOString(),
      };
    } catch (error) {
      void reply.code(400);
      return {
        error: {
          code: 'DNC_LIST_ERROR',
          message: error instanceof Error ? error.message : 'Failed to create DNC list',
        },
      };
    }
  });

  // Delete DNC list
  fastify.delete('/api/v1/compliance/dnc-lists/:listId', async (request, reply) => {
    const userId = getActingUserId(request) ?? undefined;
    const tenantId = getActingTenantId(request);
    
    if (!tenantId) {
      return sendTenantRefusal(request, reply);
    }

    const { listId } = request.params as { listId: string };

    const list = await prisma.dncList.findFirst({
      where: {
        id: listId,
        tenantId,
      },
    });

    if (!list) {
      void reply.code(404);
      return { error: { code: 'NOT_FOUND', message: 'DNC list not found' } };
    }

    await prisma.dncList.delete({
      where: { id: listId },
    });

    // Audit log
    const { auditCreate } = await import('../services/audit.js');
    await auditCreate(
      tenantId,
      'DncList',
      listId,
      { deleted: true, name: list.name },
      {
        userId,
        ipAddress: request.ip,
        requestId: request.id,
      }
    );

    void reply.code(204);
    return;
  });

  // Get compliance audit log
  fastify.get('/api/v1/compliance/audit', async (request, reply) => {
    const tenantId = resolveTenant(request, reply);
    if (!tenantId) return;
    const { callId, limit = 100 } = request.query as {
      callId?: string;
      phoneNumber?: string;
      limit?: number;
    };

    const where: Prisma.AuditLogWhereInput = {
      tenantId,
      action: {
        startsWith: 'compliance.',
      },
    };

    if (callId) {
      where.entityId = callId;
      where.entityType = 'call';
    }

    const logs = await prisma.auditLog.findMany({
      where,
      take: limit,
      orderBy: {
        createdAt: 'desc',
      },
    });

    return {
      data: logs,
    };
  });

  return Promise.resolve();
}

