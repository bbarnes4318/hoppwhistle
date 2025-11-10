import { FastifyInstance } from 'fastify';

import { getPrismaClient } from '../lib/prisma.js';
import { carrierService } from '../services/carrier-service.js';
import { cnamService } from '../services/cnam-service.js';
import { stirShakenService } from '../services/stir-shaken-service.js';

const prisma = getPrismaClient();

export async function registerStirShakenRoutes(fastify: FastifyInstance) {
  // Get STIR/SHAKEN status for a call
  fastify.get<{ Params: { callId: string } }>(
    '/api/v1/admin/stir-shaken/:callId',
    async (request, reply) => {
      const attestation = await stirShakenService.getAttestation(request.params.callId);

      if (!attestation) {
        reply.code(404);
        return {
          error: {
            code: 'NOT_FOUND',
            message: 'STIR/SHAKEN status not found for this call',
          },
        };
      }

      return { data: attestation };
    }
  );

  // Override STIR/SHAKEN attestation
  fastify.post<{
    Params: { callId: string };
    Body: {
      attestation: 'A' | 'B' | 'C' | 'NONE';
      reason: string;
    };
  }>('/api/v1/admin/stir-shaken/:callId/override', async (request, reply) => {
    try {
      const { attestation, reason } = request.body;
      const userId = (request as any).user?.id;

      if (!userId) {
        reply.code(401);
        return {
          error: {
            code: 'UNAUTHORIZED',
            message: 'User authentication required',
          },
        };
      }

      await stirShakenService.overrideAttestation(
        request.params.callId,
        attestation,
        reason,
        userId
      );

      return {
        success: true,
        message: 'Attestation overridden successfully',
      };
    } catch (error) {
      reply.code(400);
      return {
        error: {
          code: 'OVERRIDE_ERROR',
          message: error instanceof Error ? error.message : 'Failed to override attestation',
        },
      };
    }
  });

  // Lookup CNAM
  fastify.get('/api/v1/admin/cnam/lookup', async (request, reply) => {
    const { phoneNumber, provider, useCache } = request.query as {
      phoneNumber: string;
      provider?: string;
      useCache?: string;
    };

    if (!phoneNumber) {
      reply.code(400);
      return {
        error: {
          code: 'MISSING_PARAM',
          message: 'phoneNumber is required',
        },
      };
    }

    const tenantId = (request as any).user?.tenantId || 'default';

    const result = await cnamService.lookup(tenantId, phoneNumber, {
      provider,
      useCache: useCache !== 'false',
    });

    return { data: result };
  });

  // Override CNAM
  fastify.post('/api/v1/admin/cnam/override', async (request, reply) => {
    try {
      const { phoneNumber, callerName, reason } = request.body as {
        phoneNumber: string;
        callerName: string | null;
        reason: string;
      };

      const tenantId = (request as any).user?.tenantId || 'default';

      await cnamService.overrideCallerName(tenantId, phoneNumber, callerName, reason);

      return {
        success: true,
        message: 'Caller name overridden successfully',
      };
    } catch (error) {
      reply.code(400);
      return {
        error: {
          code: 'OVERRIDE_ERROR',
          message: error instanceof Error ? error.message : 'Failed to override caller name',
        },
      };
    }
  });

  // Lookup carrier
  fastify.get('/api/v1/admin/carrier/lookup', async (request, reply) => {
    const { phoneNumber, provider, useCache } = request.query as {
      phoneNumber: string;
      provider?: string;
      useCache?: string;
    };

    if (!phoneNumber) {
      reply.code(400);
      return {
        error: {
          code: 'MISSING_PARAM',
          message: 'phoneNumber is required',
        },
      };
    }

    const tenantId = (request as any).user?.tenantId || 'default';

    const result = await carrierService.lookup(tenantId, phoneNumber, {
      provider,
      useCache: useCache !== 'false',
    });

    return { data: result };
  });

  // Override carrier
  fastify.post('/api/v1/admin/carrier/override', async (request, reply) => {
    try {
      const { phoneNumber, carrier, lata, ocn, reason } = request.body as {
        phoneNumber: string;
        carrier: string | null;
        lata: string | null;
        ocn: string | null;
        reason: string;
      };

      const tenantId = (request as any).user?.tenantId || 'default';

      await carrierService.overrideCarrier(tenantId, phoneNumber, carrier, lata, ocn, reason);

      return {
        success: true,
        message: 'Carrier information overridden successfully',
      };
    } catch (error) {
      reply.code(400);
      return {
        error: {
          code: 'OVERRIDE_ERROR',
          message: error instanceof Error ? error.message : 'Failed to override carrier',
        },
      };
    }
  });

  // List all STIR/SHAKEN statuses
  fastify.get('/api/v1/admin/stir-shaken', async (request, reply) => {
    const { phoneNumber, limit = 100 } = request.query as {
      phoneNumber?: string;
      limit?: number;
    };

    const tenantId = (request as any).user?.tenantId || 'default';

    const where: any = { tenantId };
    if (phoneNumber) {
      where.phoneNumber = phoneNumber;
    }

    const statuses = await prisma.stirShakenStatus.findMany({
      where,
      take: limit,
      orderBy: {
        createdAt: 'desc',
      },
    });

    return {
      data: statuses.map((s) => ({
        id: s.id,
        callId: s.callId,
        phoneNumber: s.phoneNumber,
        attestation: s.attestation,
        identity: s.identity,
        origId: s.origId,
        passthru: s.passthru,
        override: s.override,
        overrideReason: s.overrideReason,
        verifiedAt: s.verifiedAt,
        createdAt: s.createdAt,
      })),
    };
  });
}

