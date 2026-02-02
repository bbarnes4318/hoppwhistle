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

/**
 * Normalize phone number to digits only for consistent lookup
 */
function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
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

      const normalizedPhone = normalizePhone(body.phone);
      if (normalizedPhone.length < 10) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Phone number must be at least 10 digits',
          },
        });
      }

      try {
        // Get client IP address
        const clientIp = request.ip || request.headers['x-forwarded-for'] || 'unknown';

        // Upsert - update if exists, create if not
        const prospect = await prisma.prospectIntake.upsert({
          where: {
            tenantId_phone: {
              tenantId: 'default-tenant-id',
              phone: normalizedPhone,
            },
          },
          update: {
            firstName: body.firstName,
            lastName: body.lastName,
            email: body.email,
            dob: body.dob ? new Date(body.dob) : undefined,
            gender: body.gender,
            street: body.street,
            city: body.city,
            state: body.state,
            zip: body.zip,
            carrier: body.carrier,
            policyType: body.policyType,
            coverageAmount: body.coverageAmount,
            monthlyPremium: body.monthlyPremium,
            beneficiaries: body.beneficiaries,
            ssPaidOnDate: body.ssPaidOnDate,
            payDay: body.payDay,
            bankDraftDate: body.bankDraftDate,
            bankName: body.bankName,
            accountType: body.accountType,
            routingNumber: body.routingNumber,
            accountNumber: body.accountNumber,
            trustedFormCertUrl: body.trustedFormCertUrl,
            ipAddress: typeof clientIp === 'string' ? clientIp : clientIp[0],
            source: body.source || 'intake_form',
            notes: body.notes,
            updatedAt: new Date(),
          },
          create: {
            tenantId: 'default-tenant-id',
            phone: normalizedPhone,
            firstName: body.firstName,
            lastName: body.lastName,
            email: body.email,
            dob: body.dob ? new Date(body.dob) : undefined,
            gender: body.gender,
            street: body.street,
            city: body.city,
            state: body.state,
            zip: body.zip,
            carrier: body.carrier,
            policyType: body.policyType,
            coverageAmount: body.coverageAmount,
            monthlyPremium: body.monthlyPremium,
            beneficiaries: body.beneficiaries,
            ssPaidOnDate: body.ssPaidOnDate,
            payDay: body.payDay,
            bankDraftDate: body.bankDraftDate,
            bankName: body.bankName,
            accountType: body.accountType,
            routingNumber: body.routingNumber,
            accountNumber: body.accountNumber,
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
      const { phoneNumber } = request.params;
      const normalizedPhone = normalizePhone(phoneNumber);

      if (normalizedPhone.length < 10) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Phone number must be at least 10 digits',
          },
        });
      }

      try {
        // Try exact match first
        let prospect = await prisma.prospectIntake.findFirst({
          where: {
            phone: normalizedPhone,
            status: 'ACTIVE',
          },
        });

        // If no exact match, try last 10 digits match
        if (!prospect && normalizedPhone.length > 10) {
          const last10 = normalizedPhone.slice(-10);
          prospect = await prisma.prospectIntake.findFirst({
            where: {
              phone: last10,
              status: 'ACTIVE',
            },
          });
        }

        if (!prospect) {
          return reply.code(404).send({
            found: false,
            message: 'No prospect data found for this phone number',
          });
        }

        // Return prospect data (mask sensitive banking info)
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
            // Mask sensitive banking info
            routingNumber: prospect.routingNumber
              ? `****${prospect.routingNumber.slice(-4)}`
              : null,
            accountNumber: prospect.accountNumber
              ? `****${prospect.accountNumber.slice(-4)}`
              : null,
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
    try {
      const prospects = await prisma.prospectIntake.findMany({
        where: {
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
      const { id } = request.params;

      try {
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
