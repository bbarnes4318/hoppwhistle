/**
 * Retention & Onboarding Module API Routes
 *
 * CRUD operations for retention policies and call logging functionality.
 */
import { FastifyInstance, FastifyRequest } from 'fastify';
import { PrismaClient, PolicyStatus, PolicyType, RelationshipType } from '@prisma/client';
import { z } from 'zod';

import { getActingTenantId } from '../lib/tenant-context.js';

const prisma = new PrismaClient();

// ============================================================================
// Request Schemas
// ============================================================================

const CreatePolicySchema = z.object({
  // Lead/Contact Info
  firstName: z.string().optional(),
  middleName: z.string().optional(),
  lastName: z.string().optional(),
  phoneNumber: z.string().min(10),
  email: z.string().email().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zipCode: z.string().optional(),

  // Beneficiary
  primaryBeneficiary: z.string().optional(),
  primaryRelationship: z.nativeEnum(RelationshipType).optional(),
  contingentBeneficiary: z.string().optional(),
  contingentRelationship: z.nativeEnum(RelationshipType).optional(),

  // Policy Info
  carrier: z.string().optional(),
  coverage: z.number().optional(),
  monthlyPremium: z.number().optional(),
  policyType: z.nativeEnum(PolicyType).optional(),

  // Billing
  ssBilling: z.boolean().default(false),
  billingDateStr: z.string().optional(),

  // Status
  status: z.nativeEnum(PolicyStatus).default('SUBMITTED'),
  notes: z.string().optional(),
});

const UpdatePolicySchema = CreatePolicySchema.partial();

const LogCallSchema = z.object({
  note: z.string().min(1),
});

const UpdateStatusSchema = z.object({
  status: z.nativeEnum(PolicyStatus),
});

// ============================================================================
// Billing Date Validation
// ============================================================================

const SS_BILLING_OPTIONS = ['1st', '3rd', '2nd Wed', '3rd Wed', '4th Wed'];
const STANDARD_BILLING_RANGE = Array.from({ length: 28 }, (_, i) => String(i + 1));

function validateBillingDate(ssBilling: boolean, billingDateStr?: string): boolean {
  if (!billingDateStr) return true; // Optional field

  if (ssBilling) {
    return SS_BILLING_OPTIONS.includes(billingDateStr);
  } else {
    return STANDARD_BILLING_RANGE.includes(billingDateStr);
  }
}

// ============================================================================
// Tenant Context Helper
// ============================================================================

interface AuthenticatedUser {
  tenantId?: string;
  apiKeyId?: string;
  userId?: string;
  scopes?: string[];
}

type AuthRequest = FastifyRequest & { user?: AuthenticatedUser };

/**
 * The acting tenant, from `lib/tenant-context.ts`.
 *
 * This file used to carry its own copy of the rule, and the copy also consulted
 * the `X-Demo-Tenant-Id` header -- so an authenticated caller could name a
 * tenant that was not theirs. There is now one implementation, it reads only
 * the authenticated principal, and this wrapper exists solely so the existing
 * call sites keep their shape.
 */
function getTenantId(request: FastifyRequest): string | null {
  return getActingTenantId(request);
}

// ============================================================================
// Route Registration
// ============================================================================

export async function registerRetentionRoutes(fastify: FastifyInstance): Promise<void> {
  // ------------------------------------------------------------------------
  // GET /api/v1/retention - List all policies
  // ------------------------------------------------------------------------
  fastify.get('/api/v1/retention', async (request: FastifyRequest, reply) => {
    const tenantId = getTenantId(request);
    if (!tenantId) {
      return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    }

    try {
      const {
        status,
        search,
        limit = 50,
        offset = 0,
      } = request.query as {
        status?: PolicyStatus;
        search?: string;
        limit?: number;
        offset?: number;
      };

      // Build where clause
      const where: Record<string, unknown> = { tenantId };

      if (status) {
        where.status = status;
      }

      // Get policies with joined Lead data
      const policies = await prisma.retentionPolicy.findMany({
        where,
        include: {
          lead: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              fullName: true,
              phoneNumber: true,
              email: true,
              address: true,
              city: true,
              state: true,
              zipCode: true,
            },
          },
          notes: {
            orderBy: { createdAt: 'desc' },
            take: 5,
          },
        },
        orderBy: [
          { status: 'asc' }, // Priority order
          { createdAt: 'desc' },
        ],
        take: Number(limit),
        skip: Number(offset),
      });

      // Filter by search term if provided
      let filteredPolicies = policies;
      if (search) {
        const searchLower = search.toLowerCase();
        filteredPolicies = policies.filter(
          p =>
            p.lead?.fullName?.toLowerCase().includes(searchLower) ||
            p.lead?.phoneNumber?.includes(search) ||
            p.lead?.email?.toLowerCase().includes(searchLower) ||
            p.carrier?.toLowerCase().includes(searchLower)
        );
      }

      // Get total count
      const total = await prisma.retentionPolicy.count({ where });

      return reply.send({
        success: true,
        data: {
          policies: filteredPolicies,
          meta: {
            total,
            limit: Number(limit),
            offset: Number(offset),
          },
        },
      });
    } catch (error) {
      request.log.error(error, 'Failed to list retention policies');
      return reply.status(500).send({ success: false, error: 'Failed to list policies' });
    }
  });

  // ------------------------------------------------------------------------
  // GET /api/v1/retention/:id - Get single policy
  // ------------------------------------------------------------------------
  fastify.get('/api/v1/retention/:id', async (request: FastifyRequest, reply) => {
    const tenantId = getTenantId(request);
    if (!tenantId) {
      return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    }

    try {
      const { id } = request.params as { id: string };
      const policy = await prisma.retentionPolicy.findFirst({
        where: { id, tenantId },
        include: {
          lead: true,
          notes: {
            orderBy: { createdAt: 'desc' },
          },
        },
      });

      if (!policy) {
        return reply.status(404).send({ success: false, error: 'Policy not found under this tenant' });
      }

      return reply.send({ success: true, data: policy });
    } catch (error) {
      request.log.error(error, 'Failed to get retention policy');
      return reply.status(500).send({ success: false, error: 'Failed to get policy' });
    }
  });

  // ------------------------------------------------------------------------
  // POST /api/v1/retention - Create new policy
  // ------------------------------------------------------------------------
  fastify.post('/api/v1/retention', async (request: FastifyRequest, reply) => {
    const tenantId = getTenantId(request);
    if (!tenantId) {
      return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    }

    try {
      const body = CreatePolicySchema.parse(request.body);

      // Validate billing date
      if (!validateBillingDate(body.ssBilling, body.billingDateStr)) {
        return reply.status(400).send({
          success: false,
          error: body.ssBilling
            ? `Invalid SS billing date. Must be one of: ${SS_BILLING_OPTIONS.join(', ')}`
            : 'Invalid billing date. Must be between 1-28',
        });
      }

      // Find or create Lead by phone number (scoped by tenant)
      let lead = await prisma.lead.findFirst({
        where: {
          tenantId,
          phoneNumber: body.phoneNumber,
        },
      });

      if (!lead) {
        // Create new Lead
        lead = await prisma.lead.create({
          data: {
            tenantId,
            phoneNumber: body.phoneNumber,
            firstName: body.firstName,
            lastName: body.lastName,
            fullName: (body.firstName && body.lastName) ? `${body.firstName} ${body.lastName}` : undefined,
            email: body.email,
            address: body.address,
            city: body.city,
            state: body.state,
            zipCode: body.zipCode,
            leadSource: 'Retention Intake',
            status: 'ACTIVE',
          },
        });
      }

      // Create RetentionPolicy
      const policy = await prisma.retentionPolicy.create({
        data: {
          tenantId,
          leadId: lead.id,
          primaryBeneficiary: body.primaryBeneficiary || null,
          primaryRelationship: body.primaryRelationship || null,
          contingentBeneficiary: body.contingentBeneficiary || null,
          contingentRelationship: body.contingentRelationship || null,
          carrier: body.carrier || null,
          coverage: body.coverage || null,
          monthlyPremium: body.monthlyPremium || null,
          policyType: body.policyType || null,
          ssBilling: body.ssBilling,
          billingDateStr: body.billingDateStr || null,
          status: body.status,
        },
        include: {
          lead: true,
        },
      });

      // Write initial note if provided
      if (body.notes) {
        await prisma.retentionNote.create({
          data: {
            policyId: policy.id,
            note: body.notes,
            userId: (request as AuthRequest).user?.userId || null,
          },
        });
      }

      return reply.status(201).send({ success: true, data: policy });
    } catch (error) {
      request.log.error(error, 'Failed to create retention policy');
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ success: false, error: error.errors });
      }
      return reply.status(500).send({ success: false, error: 'Failed to create policy' });
    }
  });

  // ------------------------------------------------------------------------
  // PUT /api/v1/retention/:id - Update policy
  // ------------------------------------------------------------------------
  fastify.put('/api/v1/retention/:id', async (request: FastifyRequest, reply) => {
    const tenantId = getTenantId(request);
    if (!tenantId) {
      return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    }

    try {
      const { id } = request.params as { id: string };
      const body = UpdatePolicySchema.parse(request.body);

      const existingPolicy = await prisma.retentionPolicy.findFirst({ where: { id, tenantId } });
      if (!existingPolicy) {
        return reply.status(404).send({ success: false, error: 'Policy not found under this tenant' });
      }

      // Validate billing date if changed
      const isSsBilling = body.ssBilling !== undefined ? body.ssBilling : existingPolicy.ssBilling;
      const billingDateStr = body.billingDateStr !== undefined ? body.billingDateStr : (existingPolicy.billingDateStr || undefined);

      if (!validateBillingDate(isSsBilling, billingDateStr)) {
        return reply.status(400).send({
          success: false,
          error: isSsBilling
            ? `Invalid SS billing date. Must be one of: ${SS_BILLING_OPTIONS.join(', ')}`
            : 'Invalid billing date. Must be between 1-28',
        });
      }

      const policy = await prisma.retentionPolicy.update({
        where: { id },
        data: {
          primaryBeneficiary: body.primaryBeneficiary !== undefined ? body.primaryBeneficiary : undefined,
          primaryRelationship: body.primaryRelationship !== undefined ? body.primaryRelationship : undefined,
          contingentBeneficiary: body.contingentBeneficiary !== undefined ? body.contingentBeneficiary : undefined,
          contingentRelationship: body.contingentRelationship !== undefined ? body.contingentRelationship : undefined,
          carrier: body.carrier !== undefined ? body.carrier : undefined,
          coverage: body.coverage !== undefined ? body.coverage : undefined,
          monthlyPremium: body.monthlyPremium !== undefined ? body.monthlyPremium : undefined,
          policyType: body.policyType !== undefined ? body.policyType : undefined,
          ssBilling: body.ssBilling !== undefined ? body.ssBilling : undefined,
          billingDateStr: body.billingDateStr !== undefined ? body.billingDateStr : undefined,
          status: body.status !== undefined ? body.status : undefined,
        },
        include: {
          lead: true,
        },
      });

      // Write note about updates if provided
      if (body.notes) {
        await prisma.retentionNote.create({
          data: {
            policyId: policy.id,
            note: body.notes,
            userId: (request as AuthRequest).user?.userId || null,
          },
        });
      }

      return reply.send({ success: true, data: policy });
    } catch (error) {
      request.log.error(error, 'Failed to update retention policy');
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ success: false, error: error.errors });
      }
      return reply.status(500).send({ success: false, error: 'Failed to update policy' });
    }
  });

  // ------------------------------------------------------------------------
  // POST /api/v1/retention/:id/log-call - Log a call attempt
  // ------------------------------------------------------------------------
  fastify.post('/api/v1/retention/:id/log-call', async (request: FastifyRequest, reply) => {
    const tenantId = getTenantId(request);
    if (!tenantId) {
      return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    }

    try {
      const { id } = request.params as { id: string };
      const { note } = LogCallSchema.parse(request.body);

      const policy = await prisma.retentionPolicy.findFirst({ where: { id, tenantId } });
      if (!policy) {
        return reply.status(404).send({ success: false, error: 'Policy not found under this tenant' });
      }

      // Add to onboarding attempts count & create note
      const [updatedPolicy] = await Promise.all([
        prisma.retentionPolicy.update({
          where: { id },
          data: {
            onboardingAttempts: { increment: 1 },
          },
        }),
        prisma.retentionNote.create({
          data: {
            policyId: id,
            note: `[Call Logged] ${note}`,
            userId: (request as AuthRequest).user?.userId || null,
          },
        }),
      ]);

      return reply.send({ success: true, data: updatedPolicy });
    } catch (error) {
      request.log.error(error, 'Failed to log call');
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ success: false, error: error.errors });
      }
      return reply.status(500).send({ success: false, error: 'Failed to log call' });
    }
  });

  // ------------------------------------------------------------------------
  // POST /api/v1/retention/:id/status - Update policy status
  // ------------------------------------------------------------------------
  fastify.post('/api/v1/retention/:id/status', async (request: FastifyRequest, reply) => {
    const tenantId = getTenantId(request);
    if (!tenantId) {
      return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    }

    try {
      const { id } = request.params as { id: string };
      const { status } = UpdateStatusSchema.parse(request.body);

      const policy = await prisma.retentionPolicy.findFirst({ where: { id, tenantId } });
      if (!policy) {
        return reply.status(404).send({ success: false, error: 'Policy not found under this tenant' });
      }

      const updatedPolicy = await prisma.retentionPolicy.update({
        where: { id },
        data: { status },
      });

      // Log status transition note
      await prisma.retentionNote.create({
        data: {
          policyId: id,
          note: `[Status Change] Transitioned status from ${policy.status} to ${status}`,
          userId: (request as AuthRequest).user?.userId || null,
        },
      });

      return reply.send({ success: true, data: updatedPolicy });
    } catch (error) {
      request.log.error(error, 'Failed to update status');
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ success: false, error: error.errors });
      }
      return reply.status(500).send({ success: false, error: 'Failed to update status' });
    }
  });

  // ------------------------------------------------------------------------
  // POST /api/v1/retention/:id/onboarding-attempt - Record onboarding attempt
  // ------------------------------------------------------------------------
  fastify.post('/api/v1/retention/:id/onboarding-attempt', async (request: FastifyRequest, reply) => {
    const tenantId = getTenantId(request);
    if (!tenantId) {
      return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    }

    try {
      const { id } = request.params as { id: string };

      const policy = await prisma.retentionPolicy.findFirst({ where: { id, tenantId } });
      if (!policy) {
        return reply.status(404).send({ success: false, error: 'Policy not found under this tenant' });
      }

      const updatedPolicy = await prisma.retentionPolicy.update({
        where: { id },
        data: {
          onboardingAttempts: { increment: 1 },
        },
      });

      return reply.send({ success: true, data: updatedPolicy });
    } catch (error) {
      request.log.error(error, 'Failed to log onboarding attempt');
      return reply.status(500).send({ success: false, error: 'Failed to log attempt' });
    }
  });

  // ------------------------------------------------------------------------
  // GET /api/v1/retention/stats - Get retention statistics
  // ------------------------------------------------------------------------
  fastify.get('/api/v1/retention/stats', async (request: FastifyRequest, reply) => {
    const tenantId = getTenantId(request);
    if (!tenantId) {
      return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    }

    try {
      const [totalPolicies, statusCounts, avgAttempts] = await Promise.all([
        // Total count (scoped to tenant)
        prisma.retentionPolicy.count({ where: { tenantId } }),

        // Count by status (scoped to tenant)
        prisma.retentionPolicy.groupBy({
          by: ['status'],
          where: { tenantId },
          _count: { status: true },
        }),

        // Average attempts (scoped to tenant)
        prisma.retentionPolicy.aggregate({
          where: { tenantId },
          _avg: { onboardingAttempts: true },
        }),
      ]);

      // Calculate active vs completed
      const completedStatuses: PolicyStatus[] = ['PAID', 'NOT_TAKEN', 'LAPSED'];
      const statusMap = statusCounts.reduce(
        (acc, s) => {
          acc[s.status] = s._count.status;
          return acc;
        },
        {} as Record<PolicyStatus, number>
      );

      const completedCount = completedStatuses.reduce((sum, s) => sum + (statusMap[s] || 0), 0);
      const activeCount = totalPolicies - completedCount;

      return reply.send({
        success: true,
        data: {
          total: totalPolicies,
          active: activeCount,
          completed: completedCount,
          byStatus: statusMap,
          averageAttempts: Math.round(avgAttempts._avg.onboardingAttempts || 0),
        },
      });
    } catch (error) {
      request.log.error(error, 'Failed to get retention stats');
      return reply.status(500).send({ success: false, error: 'Failed to get stats' });
    }
  });
}

export default registerRetentionRoutes;
