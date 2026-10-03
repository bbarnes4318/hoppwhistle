/**
 * Prospect Intake Routes
 *
 * Endpoints for submitting and retrieving customer intake form data.
 * Manual CRM entries can also create an insurance-lead submission and
 * explicitly choose whether to send that submission to the buyer.
 */

import { PrismaClient } from '@prisma/client';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import { isAgencyPrincipal } from '../lib/agent-scope.js';
import { enforceLicensedState } from '../lib/licensed-states.js';
import { getActingTenantId, getActingUserId } from '../lib/tenant-context.js';
import type { IngestOwnership } from '../services/insurance-lead-service.js';

const prisma = new PrismaClient();

type InsuranceVertical = 'FE' | 'ACA';

interface ProspectIntakePayload {
  // Manual CRM delivery controls
  vertical?: InsuranceVertical;
  sendToBuyer?: boolean;

  // Client Info
  firstName?: string;
  lastName?: string;
  phone: string;
  email?: string;
  dob?: string;
  age?: number;
  gender?: string;

  // Address
  street?: string;
  city?: string;
  state?: string;
  zip?: string;

  // Buyer fields
  smoker?: string;
  heightFeet?: number;
  heightInches?: number;
  weight?: number;
  landingPage?: string;
  leadidToken?: string;
  consentLanguage?: string;
  recordingUrl?: string;

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

interface ManualCrmSyncResult {
  insuranceLeadId: string;
  submissionId: string;
  validationStatus: 'VALID' | 'INVALID';
  validationErrors?: Array<{ path: string; message: string }>;
  postStatus: string;
  postMode: string;
  sentToBuyer: boolean;
  buyerStatus: string | null;
  buyerError: string | null;
  message: string;
}

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

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

function maskBankingField(val?: string): string | null {
  if (!val) return null;
  const cleaned = val.trim();
  if (cleaned.length <= 4) return cleaned;
  return `****${cleaned.slice(-4)}`;
}

/**
 * The agent an intake is narrowed to, or `null` for a caller who sees the
 * agency's intakes.
 *
 * ── Who is narrowed ──────────────────────────────────────────────────────────
 *
 * A person who is not the agency's principal: an agent sees and changes the
 * intakes they took, the same rule `lib/agent-scope.ts` applies to the CRM.
 * This route used to be tenant-scoped and nothing more, so any agent could list
 * a colleague's prospects, archive them, or overwrite them by re-submitting the
 * same phone number.
 *
 * An API key is NOT narrowed here, unlike the CRM. This endpoint is also a
 * partner ingestion surface (see `no-acting-tenant-audit.test.ts`), a key acts
 * for the agency rather than as one of its agents, and narrowing it to
 * `NO_OWNER` would have refused every update an existing integration sends.
 *
 * ── What is deliberately NOT narrowed ────────────────────────────────────────
 *
 * `GET /api/v1/prospects/by-phone/:phoneNumber` is the incoming-call screen
 * pop. Whichever agent answers a call must see who is calling, whoever took the
 * intake, so that route stays agency-wide by design.
 */
function intakeOwnerScope(request: FastifyRequest): string | null {
  if (isAgencyPrincipal(request)) return null;
  return getActingUserId(request);
}

/**
 * Whether this agent has been on a call with `phone`: answered it inbound or
 * placed it outbound. The same "last call this agent had with the prospect"
 * rule the CRM's application entry uses.
 *
 * It is what lets the agent who answered a screen-popped call save the intake
 * form for that caller, even though a colleague took the original intake --
 * the screen pop shows them the prospect, and refusing the save would break
 * the call they are on.
 */
async function agentHadCallWith(tenantId: string, userId: string, phone: string): Promise<boolean> {
  const call = await prisma.call.findFirst({
    where: {
      tenantId,
      answeredByUserId: userId,
      OR: [
        { direction: 'INBOUND', callerId: { endsWith: phone } },
        { direction: 'OUTBOUND', toNumber: { endsWith: phone } },
      ],
    },
    select: { id: true },
  });
  return !!call;
}

const PROSPECT_HELD_ELSEWHERE = {
  error: {
    code: 'PROSPECT_HELD_ELSEWHERE',
    message: 'This prospect is already in the agency and is not assigned to you.',
  },
};

function shouldCreateInsuranceCrmLead(body: ProspectIntakePayload): boolean {
  return body.source === 'manual_crm_entry' || typeof body.sendToBuyer === 'boolean';
}

async function syncManualLeadToInsuranceCrm(
  tenantId: string,
  normalizedPhone: string,
  body: ProspectIntakePayload,
  clientIp: string,
  ownership: IngestOwnership
): Promise<ManualCrmSyncResult> {
  const vertical: InsuranceVertical = body.vertical === 'ACA' ? 'ACA' : 'FE';
  const sendToBuyer = body.sendToBuyer === true;
  const { ingestLead } = await import('../services/insurance-lead-service.js');

  const result = await ingestLead(
    tenantId,
    vertical,
    {
      firstName: body.firstName,
      lastName: body.lastName,
      phone: normalizedPhone,
      email: body.email,
      birthDate: body.dob,
      age: body.age,
      gender: body.gender,
      address: body.street,
      city: body.city,
      state: body.state,
      zipCode: body.zip,
      smoker: body.smoker,
      heightFeet: body.heightFeet,
      heightInches: body.heightInches,
      weight: body.weight,
      carrier: body.carrier,
      coverageAmount: body.coverageAmount,
      monthlyPremium: body.monthlyPremium,
      trustedFormUrl: body.trustedFormCertUrl,
      leadidToken: body.leadidToken,
      consentLanguage: body.consentLanguage,
      recordingUrl: body.recordingUrl,
      landingPage: body.landingPage || 'https://agents.netenroll.com/intake',
      ipAddress: clientIp,
      source: body.source || 'manual_crm_entry',
      notes: body.notes,
    },
    ownership
  );

  await prisma.insuranceActivity.updateMany({
    where: {
      tenantId,
      insuranceLeadId: result.insuranceLeadId,
      title: 'Lead Held',
    },
    data: {
      title: sendToBuyer ? 'Buyer Delivery Requested' : 'Saved to CRM Only',
      description: sendToBuyer
        ? 'The user selected Save & Send to Buyer for this manually entered lead.'
        : 'The user selected Save to CRM Only. This lead was not sent to the buyer.',
    },
  });

  if (!sendToBuyer) {
    return {
      insuranceLeadId: result.insuranceLeadId,
      submissionId: result.submissionId,
      validationStatus: result.validationStatus,
      validationErrors: result.errors,
      postStatus: result.postStatus,
      postMode: result.postMode,
      sentToBuyer: false,
      buyerStatus: null,
      buyerError: null,
      message: 'Lead saved to CRM. It was not sent to the buyer.',
    };
  }

  if (result.validationStatus !== 'VALID') {
    return {
      insuranceLeadId: result.insuranceLeadId,
      submissionId: result.submissionId,
      validationStatus: result.validationStatus,
      validationErrors: result.errors,
      postStatus: result.postStatus,
      postMode: result.postMode,
      sentToBuyer: false,
      buyerStatus: null,
      buyerError: 'The lead did not pass validation, so buyer delivery was not attempted.',
      message: 'Lead saved to CRM, but it was not sent because required data was invalid.',
    };
  }

  const { deliverInsuranceLeadSubmission } = await import('../services/insurance-lead-delivery.js');
  const delivery = await deliverInsuranceLeadSubmission(
    tenantId,
    result.insuranceLeadId,
    result.submissionId,
    { trigger: 'AUTO' }
  );

  if ('error' in delivery) {
    return {
      insuranceLeadId: result.insuranceLeadId,
      submissionId: result.submissionId,
      validationStatus: result.validationStatus,
      validationErrors: result.errors,
      postStatus: 'ERROR',
      postMode: result.postMode,
      sentToBuyer: true,
      buyerStatus: 'Error',
      buyerError: delivery.error,
      message: 'Lead saved to CRM, but buyer delivery failed.',
    };
  }

  return {
    insuranceLeadId: result.insuranceLeadId,
    submissionId: result.submissionId,
    validationStatus: result.validationStatus,
    validationErrors: result.errors,
    postStatus: delivery.postStatus,
    postMode: delivery.postMode,
    sentToBuyer: true,
    buyerStatus: delivery.ameriquoteStatus,
    buyerError: delivery.errorMessage || null,
    message:
      delivery.postStatus === 'ERROR'
        ? 'Lead saved to CRM, but the buyer returned an error.'
        : `Lead saved and sent to the buyer with status ${delivery.ameriquoteStatus}.`,
  };
}

// eslint-disable-next-line @typescript-eslint/require-await -- Fastify plugins must return a promise
export async function registerProspectIntakeRoutes(fastify: FastifyInstance) {
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
      if (!body.phone) {
        return reply.code(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'Phone number is required' },
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

      // `body.state` is the browser's word for where this prospect lives, and
      // this endpoint writes it to `ProspectIntake` and -- for a manual CRM
      // entry -- on into `InsuranceLead` via `ingestLead`. It is the one place
      // in this change where the state under test comes from the request, so it
      // is validated against the agent's licence rather than trusted: an agent
      // cannot create a record in a state they may not work, then read it back
      // through the CRM because the record now says so.
      //
      // An absent or unreadable state is refused for a restricted agent. That
      // is the default-deny rule and not an oversight: an intake with no state
      // is a record no licence can cover, and letting it through would make
      // "leave the dropdown alone" the way past this check.
      if (!(await enforceLicensedState(request, reply, tenantId, body.state))) {
        return;
      }

      /*
       * One intake per phone per agency, so a submit for a number that already
       * has one is an UPDATE of that row. For an agent the row must be theirs,
       * or one whose caller they have been on the phone with -- otherwise
       * re-submitting a colleague's prospect's number overwrote it. Refused
       * before anything is written, the intake or the CRM lead.
       */
      const ownerScope = intakeOwnerScope(request);
      const existingIntake = await prisma.prospectIntake.findUnique({
        where: { tenantId_phone: { tenantId, phone: normalizedPhone } },
        select: { agentId: true },
      });
      if (
        ownerScope &&
        existingIntake &&
        existingIntake.agentId !== ownerScope &&
        !(await agentHadCallWith(tenantId, ownerScope, normalizedPhone))
      ) {
        return reply.code(409).send(PROSPECT_HELD_ELSEWHERE);
      }

      /*
       * The CRM lead a manual entry writes follows the CRM's own ownership
       * rule: an agent's new lead is assigned to them, and an existing lead
       * held by someone else is refused (`ingestLead` throws
       * LeadHeldElsewhereError before writing). It is checked here too so the
       * refusal lands before the intake row above is touched.
       */
      const crmOwnership: IngestOwnership = ownerScope
        ? { assignToId: ownerScope, agentScoped: true }
        : {};
      if (ownerScope && shouldCreateInsuranceCrmLead(body)) {
        const heldLead = await prisma.insuranceLead.findFirst({
          where: {
            tenantId,
            phone: normalizedPhone,
            vertical: body.vertical === 'ACA' ? 'ACA' : 'FE',
          },
          select: { assignedToId: true },
        });
        if (heldLead && heldLead.assignedToId !== ownerScope) {
          return reply.code(409).send(PROSPECT_HELD_ELSEWHERE);
        }
      }

      // Who took the intake. Kept on update -- except that a row from before
      // the column was written goes to the agent now working it.
      const takenBy = getActingUserId(request);
      const claimOnUpdate =
        existingIntake && !existingIntake.agentId && ownerScope ? { agentId: ownerScope } : {};

      try {
        const forwardedFor = request.headers['x-forwarded-for'];
        const clientIp =
          request.ip ||
          (typeof forwardedFor === 'string' ? forwardedFor : forwardedFor?.[0]) ||
          'unknown';
        const maskedRouting = maskBankingField(body.routingNumber);
        const maskedAccount = maskBankingField(body.accountNumber);

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
            ipAddress: clientIp,
            source: body.source || 'intake_form',
            notes: body.notes,
            ...claimOnUpdate,
            updatedAt: new Date(),
          },
          create: {
            tenantId,
            phone: normalizedPhone,
            agentId: takenBy,
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
            ipAddress: clientIp,
            source: body.source || 'intake_form',
            notes: body.notes,
          },
        });

        fastify.log.info({
          event: 'prospect_intake_saved',
          prospectId: prospect.id,
          phone: `***${normalizedPhone.slice(-4)}`,
          manualCrmEntry: shouldCreateInsuranceCrmLead(body),
          sendToBuyer: body.sendToBuyer === true,
        });

        if (shouldCreateInsuranceCrmLead(body)) {
          const crmResult = await syncManualLeadToInsuranceCrm(
            tenantId,
            normalizedPhone,
            body,
            clientIp,
            crmOwnership
          );

          return reply.code(200).send({
            success: true,
            prospectId: prospect.id,
            ...crmResult,
          });
        }

        return reply.code(200).send({
          success: true,
          prospectId: prospect.id,
          message: 'Prospect intake saved successfully',
        });
      } catch (error) {
        const { LeadHeldElsewhereError } = await import('../services/insurance-lead-service.js');
        if (error instanceof LeadHeldElsewhereError) {
          // The CRM lead was assigned to someone else between the check above
          // and the write.
          return reply.code(409).send(PROSPECT_HELD_ELSEWHERE);
        }
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

      const rawPhone = normalizePhone(request.params.phoneNumber);
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
          error: { code: 'DATABASE_ERROR', message: 'Failed to look up prospect' },
        });
      }
    }
  );

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

    const ownerScope = intakeOwnerScope(request);

    try {
      const prospects = await prisma.prospectIntake.findMany({
        // An agent lists the intakes they took; see intakeOwnerScope.
        where: { tenantId, status: 'ACTIVE', ...(ownerScope ? { agentId: ownerScope } : {}) },
        orderBy: { createdAt: 'desc' },
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
        prospects: prospects.map(prospect => ({
          ...prospect,
          phone: `***-***-${prospect.phone.slice(-4)}`,
        })),
      });
    } catch (error) {
      fastify.log.error({ event: 'prospect_list_error', error });
      return reply.code(500).send({
        error: { code: 'DATABASE_ERROR', message: 'Failed to list prospects' },
      });
    }
  });

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

      try {
        // An agent archives only the intakes they took. A colleague's reads as
        // not found, the same answer as another agency's.
        const ownerScope = intakeOwnerScope(request);
        const existing = await prisma.prospectIntake.findFirst({
          where: {
            id: request.params.id,
            tenantId,
            ...(ownerScope ? { agentId: ownerScope } : {}),
          },
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
          where: { id: request.params.id },
          data: { status: 'ARCHIVED' },
        });

        return reply.code(200).send({ success: true, message: 'Prospect archived' });
      } catch (error) {
        fastify.log.error({ event: 'prospect_delete_error', error });
        return reply.code(500).send({
          error: { code: 'DATABASE_ERROR', message: 'Failed to archive prospect' },
        });
      }
    }
  );
}
