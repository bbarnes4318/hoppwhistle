/**
 * Prospect Intake Routes
 *
 * Endpoints for submitting and retrieving customer intake form data.
 * This data is used for screen pop when incoming calls match a stored phone number.
 */

import { PrismaClient } from '@prisma/client';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

const prisma = new PrismaClient();

// Types
interface ProspectIntakePayload {
  // Client Info
  firstName?: string;
  lastName?: string;
  phone: string; // Required
  email?: string;
  dob?: string; // ISO date string
  age?: number; // Age in years
  gender?: string;

  // Address
  street?: string;
  city?: string;
  state?: string;
  zip?: string;

  // Policy Details
  carrier?: string;
  policyType?: string;
  coverageAmount?: number;
  monthlyPremium?: number;

  // Beneficiaries
  beneficiaries?: Array<{
    name: string;
    relationship: string;
    percentage: number;
  }>;

  // Underwriting & Billing
  ssPaidOnDate?: string;
  payDay?: string;
  bankDraftDate?: string;

  // Banking
  bankName?: string;
  accountType?: string;
  routingNumber?: string;
  accountNumber?: string;

  // TrustedForm / Compliance
  trustedFormCertUrl?: string;

  // Metadata
  source?: string;
  notes?: string;
}

interface AuthenticatedUser {
  tenantId?: string;
  apiKeyId?: string;
  userId?: string;
  scopes?: string[];
}

type AuthRequest = FastifyRequest & { user?: AuthenticatedUser };

function getTenantId(request: FastifyRequest): string | null {
  const user = (request as AuthRequest).user;
  const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
  return demoTenantId || user?.tenantId || null;
}

/**
 * Normalize phone number to digits only for consistent lookup
 */
function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

/**
 * Mask routing or account number to last 4 digits (e.g. ****1234)
 */
function maskBankingField(val?: string): string | null {
  if (!val) return null;
  const cleaned = val.trim();
  if (cleaned.length <= 4) return cleaned;
  return `****${cleaned.slice(-4)}`;
}

export async function registerProspectIntakeRoutes(fastify: FastifyInstance) {
  /**
   * POST /api/v1/prospects/intake
   *
   * Submit a new customer intake form. Upserts by phone number.
   */
  fastify.post<{ Body: ProspectIntakePayload }>(
    '/api/v1/prospects/intake',
    async (request: FastifyRequest<{ Body: ProspectIntakePayload }>, reply: FastifyReply) => {
      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.code(401).send({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required. Valid tenant context missing.',
          },
        });
      }

      const body = request.body;

      // Validate required phone
      if (!body.phone) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Phone number is required',
          },
        });
      }

      const rawPhone = normalizePhone(body.phone);
      if (rawPhone.length < 10) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Phone number must be at least 10 digits',
          },
        });
      }
      const normalizedPhone = rawPhone.slice(-10);

      try {
        // Get client IP address
        const clientIp = request.ip || request.headers['x-forwarded-for'] || 'unknown';

        // Securely mask banking fields before DB upsert
        const maskedRouting = maskBankingField(body.routingNumber);
        const maskedAccount = maskBankingField(body.accountNumber);

        // Upsert - update if exists, create if not (scoped by tenantId)
        const prospect = await prisma.prospectIntake.upsert({
          where: {
            tenantId_phone: {
              tenantId,
              phone: normalizedPhone,
            },
          },
          update: {
            firstName: body.firstName,
            lastName: body.lastName,
            email: body.email,
            dob: body.dob ? new Date(body.dob) : undefined,
            age: body.age,
            gender: body.gender,
            street: body.street,
            city: body.city,
            state: body.state,
            zip: body.zip,
            carrier: body.carrier,
            policyType: body.policyType,
            coverageAmount: body.coverageAmount,
            monthlyPremium: body.monthlyPremium,
            beneficiaries: body.beneficiaries || undefined,
            ssPaidOnDate: body.ssPaidOnDate,
            payDay: body.payDay,
            bankDraftDate: body.bankDraftDate,
            bankName: body.bankName,
            accountType: body.accountType,
            routingNumber: maskedRouting,
            accountNumber: maskedAccount,
            trustedFormCertUrl: body.trustedFormCertUrl,
            ipAddress: typeof clientIp === 'string' ? clientIp : clientIp[0],
            source: body.source || 'intake_form',
            notes: body.notes,
            updatedAt: new Date(),
          },
          create: {
            tenantId,
            phone: normalizedPhone,
            firstName: body.firstName,
            lastName: body.lastName,
            email: body.email,
            dob: body.dob ? new Date(body.dob) : undefined,
            age: body.age,
            gender: body.gender,
            street: body.street,
            city: body.city,
            state: body.state,
            zip: body.zip,
            carrier: body.carrier,
            policyType: body.policyType,
            coverageAmount: body.coverageAmount,
            monthlyPremium: body.monthlyPremium,
            beneficiaries: body.beneficiaries || undefined,
            ssPaidOnDate: body.ssPaidOnDate,
            payDay: body.payDay,
            bankDraftDate: body.bankDraftDate,
            bankName: body.bankName,
            accountType: body.accountType,
            routingNumber: maskedRouting,
            accountNumber: maskedAccount,
            trustedFormCertUrl: body.trustedFormCertUrl,
            ipAddress: typeof clientIp === 'string' ? clientIp : clientIp[0],
            source: body.source || 'intake_form',
            notes: body.notes,
          },
        });

        fastify.log.info({
          event: 'prospect_intake_saved',
          prospectId: prospect.id,
          phone: `***${normalizedPhone.slice(-4)}`,
        });

        return reply.code(200).send({
          success: true,
          prospectId: prospect.id,
          message: 'Prospect intake saved successfully',
        });
      } catch (error) {
        fastify.log.error({ event: 'prospect_intake_error', error });
        return reply.code(500).send({
          error: {
            code: 'DATABASE_ERROR',
            message: 'Failed to save prospect intake',
          },
        });
      }
    }
  );

  /**
   * GET /api/v1/prospects/by-phone/:phoneNumber
   *
   * Look up a prospect by phone number (for screen pop on incoming calls).
   */
  fastify.get<{ Params: { phoneNumber: string } }>(
    '/api/v1/prospects/by-phone/:phoneNumber',
    async (request, reply) => {
      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.code(401).send({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required. Valid tenant context missing.',
          },
        });
      }

      const { phoneNumber } = request.params;
      const rawPhone = normalizePhone(phoneNumber);

      if (rawPhone.length < 10) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Phone number must be at least 10 digits',
          },
        });
      }
      const normalizedPhone = rawPhone.slice(-10);

      try {
        // Scoped exactly to tenantId
        const prospect = await prisma.prospectIntake.findFirst({
          where: {
            tenantId,
            phone: normalizedPhone,
            status: 'ACTIVE',
          },
        });

        if (!prospect) {
          return reply.code(404).send({
            found: false,
            message: 'No prospect data found for this phone number',
          });
        }

        // Return prospect data (bank routing/account are already masked in DB)
        return reply.code(200).send({
          found: true,
          prospect: {
            id: prospect.id,
            firstName: prospect.firstName,
            lastName: prospect.lastName,
            phone: prospect.phone,
            email: prospect.email,
            dob: prospect.dob,
            gender: prospect.gender,
            street: prospect.street,
            city: prospect.city,
            state: prospect.state,
            zip: prospect.zip,
            carrier: prospect.carrier,
            policyType: prospect.policyType,
            coverageAmount: prospect.coverageAmount,
            monthlyPremium: prospect.monthlyPremium,
            beneficiaries: prospect.beneficiaries,
            ssPaidOnDate: prospect.ssPaidOnDate,
            payDay: prospect.payDay,
            bankDraftDate: prospect.bankDraftDate,
            bankName: prospect.bankName,
            accountType: prospect.accountType,
            routingNumber: prospect.routingNumber,
            accountNumber: prospect.accountNumber,
            createdAt: prospect.createdAt,
            updatedAt: prospect.updatedAt,
          },
        });
      } catch (error) {
        fastify.log.error({ event: 'prospect_lookup_error', error });
        return reply.code(500).send({
          error: {
            code: 'DATABASE_ERROR',
            message: 'Failed to look up prospect',
          },
        });
      }
    }
  );

  /**
   * GET /api/v1/prospects/intake
   *
   * List recent prospect intakes (for admin/debugging).
   */
  fastify.get('/api/v1/prospects/intake', async (request, reply) => {
    const tenantId = getTenantId(request);
    if (!tenantId) {
      return reply.code(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required. Valid tenant context missing.',
        },
      });
    }

    try {
      const prospects = await prisma.prospectIntake.findMany({
        where: {
          tenantId,
          status: 'ACTIVE',
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 50,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
          carrier: true,
          policyType: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return reply.code(200).send({
        count: prospects.length,
        prospects: prospects.map(p => ({
          ...p,
          phone: `***-***-${p.phone.slice(-4)}`, // Mask phone for list view
        })),
      });
    } catch (error) {
      fastify.log.error({ event: 'prospect_list_error', error });
      return reply.code(500).send({
        error: {
          code: 'DATABASE_ERROR',
          message: 'Failed to list prospects',
        },
      });
    }
  });

  /**
   * DELETE /api/v1/prospects/intake/:id
   *
   * Archive a prospect intake (soft delete).
   */
  fastify.delete<{ Params: { id: string } }>(
    '/api/v1/prospects/intake/:id',
    async (request, reply) => {
      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.code(401).send({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required. Valid tenant context missing.',
          },
        });
      }

      const { id } = request.params;

      try {
        const existing = await prisma.prospectIntake.findFirst({
          where: { id, tenantId },
        });

        if (!existing) {
          return reply.code(404).send({
            error: {
              code: 'NOT_FOUND',
              message: 'Prospect intake not found under this tenant',
            },
          });
        }

        await prisma.prospectIntake.update({
          where: { id },
          data: { status: 'ARCHIVED' },
        });

        return reply.code(200).send({
          success: true,
          message: 'Prospect intake archived',
        });
      } catch (error) {
        fastify.log.error({ event: 'prospect_delete_error', error });
        return reply.code(500).send({
          error: {
            code: 'DATABASE_ERROR',
            message: 'Failed to archive prospect',
          },
        });
      }
    }
  );
}
