/**
 * Retention & Onboarding Module API Routes
 *
 * CRUD operations for retention policies and call logging functionality.
 */
import { FastifyInstance, FastifyRequest } from 'fastify';
import { PrismaClient, PolicyStatus, PolicyType, RelationshipType } from '@prisma/client';
import { z } from 'zod';

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
// Route Registration
// ============================================================================

export async function registerRetentionRoutes(fastify: FastifyInstance): Promise<void> {
  // ------------------------------------------------------------------------
  // GET /api/v1/retention - List all policies
  // ------------------------------------------------------------------------
  fastify.get('/api/v1/retention', async (request: FastifyRequest, reply) => {
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
      const where: Record<string, unknown> = {};

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
        data: filteredPolicies,
        pagination: {
          total,
          limit: Number(limit),
          offset: Number(offset),
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
    try {
      const { id } = request.params as { id: string };

      const policy = await prisma.retentionPolicy.findUnique({
        where: { id },
        include: {
          lead: true,
          notes: {
            orderBy: { createdAt: 'desc' },
          },
        },
      });

      if (!policy) {
        return reply.status(404).send({ success: false, error: 'Policy not found' });
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

      // Default tenant ID (TODO: get from auth)
      const tenantId = 'default-tenant';

      // Find or create Lead by phone number
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
            fullName:
              body.firstName && body.lastName ? `${body.firstName} ${body.lastName}` : undefined,
            email: body.email,
            address: body.address,
            city: body.city,
            state: body.state,
            zipCode: body.zipCode,
            leadSource: 'Retention Intake',
          },
        });
      } else {
        // Update existing Lead with new info
        lead = await prisma.lead.update({
          where: { id: lead.id },
          data: {
            firstName: body.firstName || lead.firstName,
            lastName: body.lastName || lead.lastName,
            fullName:
              body.firstName && body.lastName
                ? `${body.firstName} ${body.lastName}`
                : lead.fullName,
            email: body.email || lead.email,
            address: body.address || lead.address,
            city: body.city || lead.city,
            state: body.state || lead.state,
            zipCode: body.zipCode || lead.zipCode,
          },
        });
      }

      // Create RetentionPolicy
      const policy = await prisma.retentionPolicy.create({
        data: {
          tenantId,
          leadId: lead.id,
          primaryBeneficiary: body.primaryBeneficiary,
          primaryRelationship: body.primaryRelationship,
          contingentBeneficiary: body.contingentBeneficiary,
          contingentRelationship: body.contingentRelationship,
          carrier: body.carrier,
          coverage: body.coverage,
          monthlyPremium: body.monthlyPremium,
          policyType: body.policyType,
          ssBilling: body.ssBilling,
          billingDateStr: body.billingDateStr,
          status: body.status,
        },
        include: {
          lead: true,
        },
      });

      // Create initial note if provided
      if (body.notes) {
        await prisma.retentionNote.create({
          data: {
            policyId: policy.id,
            note: body.notes,
          },
        });
      }

      return reply.status(201).send({ success: true, data: policy });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ success: false, error: error.errors });
      }
      request.log.error(error, 'Failed to create retention policy');
      return reply.status(500).send({ success: false, error: 'Failed to create policy' });
    }
  });

  // ------------------------------------------------------------------------
  // PUT /api/v1/retention/:id - Update policy
  // ------------------------------------------------------------------------
  fastify.put('/api/v1/retention/:id', async (request: FastifyRequest, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = UpdatePolicySchema.parse(request.body);

      // Validate billing date if being updated
      if (body.ssBilling !== undefined || body.billingDateStr !== undefined) {
        const existingPolicy = await prisma.retentionPolicy.findUnique({ where: { id } });
        const ssBilling = body.ssBilling ?? existingPolicy?.ssBilling ?? false;
        if (!validateBillingDate(ssBilling, body.billingDateStr)) {
          return reply.status(400).send({
            success: false,
            error: ssBilling
              ? `Invalid SS billing date. Must be one of: ${SS_BILLING_OPTIONS.join(', ')}`
              : 'Invalid billing date. Must be between 1-28',
          });
        }
      }

      const policy = await prisma.retentionPolicy.update({
        where: { id },
        data: {
          primaryBeneficiary: body.primaryBeneficiary,
          primaryRelationship: body.primaryRelationship,
          contingentBeneficiary: body.contingentBeneficiary,
          contingentRelationship: body.contingentRelationship,
          carrier: body.carrier,
          coverage: body.coverage,
          monthlyPremium: body.monthlyPremium,
          policyType: body.policyType,
          ssBilling: body.ssBilling,
          billingDateStr: body.billingDateStr,
          status: body.status,
        },
        include: {
          lead: true,
          notes: {
            orderBy: { createdAt: 'desc' },
          },
        },
      });

      return reply.send({ success: true, data: policy });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ success: false, error: error.errors });
      }
      request.log.error(error, 'Failed to update retention policy');
      return reply.status(500).send({ success: false, error: 'Failed to update policy' });
    }
  });

  // ------------------------------------------------------------------------
  // POST /api/v1/retention/:id/log-call - Log a call attempt
  // ------------------------------------------------------------------------
  fastify.post('/api/v1/retention/:id/log-call', async (request: FastifyRequest, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = LogCallSchema.parse(request.body);

      // Get current policy
      const policy = await prisma.retentionPolicy.findUnique({ where: { id } });
      if (!policy) {
        return reply.status(404).send({ success: false, error: 'Policy not found' });
      }

      const newAttempts = policy.onboardingAttempts + 1;

      // Check if completed (9 attempts)
      const shouldComplete = newAttempts >= 9;

      // Update policy
      const updatedPolicy = await prisma.retentionPolicy.update({
        where: { id },
        data: {
          onboardingAttempts: newAttempts,
          // Auto-mark as completed if 9 attempts reached (unless already PAID or DECLINED)
          status:
            shouldComplete &&
            policy.status !== 'PAID' &&
            policy.status !== 'DECLINED' &&
            policy.status !== 'NOT_TAKEN'
              ? 'LAPSED'
              : undefined,
        },
        include: {
          lead: true,
        },
      });

      // Create note
      const note = await prisma.retentionNote.create({
        data: {
          policyId: id,
          note: body.note,
        },
      });

      // Update Lead's lastContactedAt
      await prisma.lead.update({
        where: { id: policy.leadId },
        data: { lastContactedAt: new Date() },
      });

      return reply.send({
        success: true,
        data: {
          policy: updatedPolicy,
          note,
          completed: shouldComplete,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ success: false, error: error.errors });
      }
      request.log.error(error, 'Failed to log call');
      return reply.status(500).send({ success: false, error: 'Failed to log call' });
    }
  });

  // ------------------------------------------------------------------------
  // PUT /api/v1/retention/:id/status - Update policy status
  // ------------------------------------------------------------------------
  fastify.put('/api/v1/retention/:id/status', async (request: FastifyRequest, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = UpdateStatusSchema.parse(request.body);

      const policy = await prisma.retentionPolicy.update({
        where: { id },
        data: { status: body.status },
        include: {
          lead: true,
        },
      });

      // Auto-create note for status change
      await prisma.retentionNote.create({
        data: {
          policyId: id,
          note: `Status changed to ${body.status}`,
        },
      });

      return reply.send({ success: true, data: policy });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ success: false, error: error.errors });
      }
      request.log.error(error, 'Failed to update policy status');
      return reply.status(500).send({ success: false, error: 'Failed to update status' });
    }
  });

  // ------------------------------------------------------------------------
  // POST /api/v1/retention/:id/convert-gi - Convert declined policy to GI
  // ------------------------------------------------------------------------
  fastify.post('/api/v1/retention/:id/convert-gi', async (request: FastifyRequest, reply) => {
    try {
      const { id } = request.params as { id: string };

      const policy = await prisma.retentionPolicy.findUnique({ where: { id } });
      if (!policy) {
        return reply.status(404).send({ success: false, error: 'Policy not found' });
      }

      if (policy.status !== 'DECLINED') {
        return reply.status(400).send({
          success: false,
          error: 'Only DECLINED policies can be converted to GI',
        });
      }

      // Update policy type to GI and reset status
      const updatedPolicy = await prisma.retentionPolicy.update({
        where: { id },
        data: {
          policyType: 'GUARANTEED_ISSUE',
          status: 'SUBMITTED',
          onboardingAttempts: 0, // Reset attempts for new GI policy
        },
        include: {
          lead: true,
        },
      });

      // Log the conversion
      await prisma.retentionNote.create({
        data: {
          policyId: id,
          note: 'Policy converted to Guaranteed Issue after decline',
        },
      });

      return reply.send({ success: true, data: updatedPolicy });
    } catch (error) {
      request.log.error(error, 'Failed to convert to GI');
      return reply.status(500).send({ success: false, error: 'Failed to convert to GI' });
    }
  });

  // ------------------------------------------------------------------------
  // GET /api/v1/retention/stats - Get retention statistics
  // ------------------------------------------------------------------------
  fastify.get('/api/v1/retention/stats', async (request: FastifyRequest, reply) => {
    try {
      const [totalPolicies, statusCounts, avgAttempts] = await Promise.all([
        // Total count
        prisma.retentionPolicy.count(),

        // Count by status
        prisma.retentionPolicy.groupBy({
          by: ['status'],
          _count: { status: true },
        }),

        // Average attempts
        prisma.retentionPolicy.aggregate({
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
