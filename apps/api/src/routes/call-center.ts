/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument */
/**
 * Call Center Portal — API Routes
 *
 * All routes under /api/v1/call-center
 */

import { FastifyInstance, FastifyRequest } from 'fastify';

import { getPrismaClient } from '../lib/prisma.js';

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

// eslint-disable-next-line @typescript-eslint/require-await
export async function registerCallCenterRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/v1/call-center/customer-lookup
   * Normalizes query phone to last 10 digits and searches CRM records.
   */
  fastify.get<{
    Querystring: { phone?: string };
  }>('/api/v1/call-center/customer-lookup', async (request, reply) => {
    const tenantId = getTenantId(request);
    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const { phone } = request.query;
    if (!phone) {
      void reply.code(400);
      return { error: { code: 'INVALID_PHONE', message: 'Phone query parameter is required' } };
    }

    const normalized = phone.replace(/\D/g, '');
    const last10 = normalized.length >= 10 ? normalized.slice(-10) : normalized;
    if (last10.length === 0) {
      void reply.code(400);
      return { error: { code: 'INVALID_PHONE', message: 'Valid phone digits are required' } };
    }

    try {
      const prisma = getPrismaClient();

      // 1. Fetch InsuranceLeads matching phone
      const insuranceLeads = await prisma.insuranceLead.findMany({
        where: {
          tenantId,
          phone: { endsWith: last10 },
        },
        include: {
          submissions: { orderBy: { receivedAt: 'desc' } },
          activities: { orderBy: { createdAt: 'desc' } },
          tasks: { orderBy: { createdAt: 'desc' } },
          list: true,
        },
      });

      // 2. Fetch generic Leads matching phone
      const genericLeads = await prisma.lead.findMany({
        where: {
          tenantId,
          phoneNumber: { endsWith: last10 },
        },
      });

      // 3. Fetch ProspectIntakes matching phone
      const prospectIntakes = await prisma.prospectIntake.findMany({
        where: {
          tenantId,
          phone: { endsWith: last10 },
        },
      });

      // 4. Fetch Calls matching phone
      const calls = await prisma.call.findMany({
        where: {
          tenantId,
          OR: [{ callerId: { endsWith: last10 } }, { toNumber: { endsWith: last10 } }],
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });

      // Determine primary match
      let primaryRecordType: 'InsuranceLead' | 'Lead' | 'ProspectIntake' | null = null;
      if (insuranceLeads.length > 0) {
        primaryRecordType = 'InsuranceLead';
      } else if (genericLeads.length > 0) {
        primaryRecordType = 'Lead';
      } else if (prospectIntakes.length > 0) {
        primaryRecordType = 'ProspectIntake';
      }

      // Map Primary Customer
      let customer: Record<string, any> | null = null;
      const recentCallsList: any[] = calls.map(c => ({
        id: c.id,
        direction: c.direction,
        status: c.status,
        duration: c.duration,
        createdAt: c.createdAt.toISOString(),
        callerId: c.callerId,
        toNumber: c.toNumber,
        startedAt: c.startedAt?.toISOString() || null,
        answeredAt: c.answeredAt?.toISOString() || null,
        endedAt: c.endedAt?.toISOString() || null,
        recordingUrl: c.recordingUrl || null,
        campaignName: c.campaignName || null,
        publisherName: c.publisherName || null,
        buyerName: c.buyerName || null,
      }));

      let activitiesList: any[] = [];
      let tasksList: any[] = [];
      let submissionsList: any[] = [];

      if (primaryRecordType === 'InsuranceLead' && insuranceLeads[0]) {
        const lead = insuranceLeads[0];
        customer = {
          id: lead.id,
          recordType: 'InsuranceLead',
          vertical: lead.vertical,
          firstName: lead.firstName || null,
          lastName: lead.lastName || null,
          fullName: lead.fullName || null,
          phone: lead.phone,
          email: lead.email || null,
          address: lead.address || null,
          city: lead.city || null,
          state: lead.state || null,
          zipCode: lead.zipCode || null,
          county: lead.county || null,
          birthDate: lead.birthDate || null,
          age: lead.age || null,
          gender: lead.gender || null,
          source: lead.source || null,
          status: lead.status,
          priority: lead.priority || null,
          assignedToId: lead.assignedToId || null,
          lastContactedAt: lead.lastContactedAt?.toISOString() || null,
          nextFollowUpAt: lead.nextFollowUpAt?.toISOString() || null,
          doNotCall: lead.doNotCall,
          insurance: {
            smoker: lead.smoker || null,
            faceAmount: lead.faceAmount || null,
            coverageAmount: lead.coverageAmount || null,
            lifeType: lead.lifeType || null,
            riskType: lead.riskType || null,
            carrier: lead.carrier || null,
            product: lead.product || null,
            monthlyPremium: lead.monthlyPremium || null,
          },
          compliance: {
            trustedFormUrl: lead.trustedFormUrl || null,
            leadidToken: lead.leadidToken || null,
            consentLanguage: lead.consentLanguage || null,
            recordingUrl: lead.recordingUrl || null,
          },
          customFields: lead.customFields || null,
          listId: lead.listId || null,
          list: lead.list ? { id: lead.list.id, name: lead.list.name } : null,
        };

        activitiesList = lead.activities.map(a => ({
          id: a.id,
          type: a.type,
          title: a.title,
          description: a.description || null,
          createdAt: a.createdAt.toISOString(),
        }));

        tasksList = lead.tasks.map(t => ({
          id: t.id,
          title: t.title,
          description: t.description || null,
          status: t.status,
          priority: t.priority,
          dueAt: t.dueAt?.toISOString() || null,
          completedAt: t.completedAt?.toISOString() || null,
          createdAt: t.createdAt.toISOString(),
        }));

        submissionsList = lead.submissions.map(s => ({
          id: s.id,
          receivedAt: s.receivedAt.toISOString(),
          validationStatus: s.validationStatus,
          postStatus: s.postStatus,
          postMode: s.postMode,
          ameriquoteResponseStatus: s.ameriquoteResponseStatus || null,
          ameriquoteErrorMessage: s.ameriquoteErrorMessage || null,
          createdAt: s.createdAt.toISOString(),
        }));
      } else if (primaryRecordType === 'Lead' && genericLeads[0]) {
        const lead = genericLeads[0];
        customer = {
          id: lead.id,
          recordType: 'Lead',
          vertical: 'GENERIC',
          firstName: lead.firstName || null,
          lastName: lead.lastName || null,
          fullName: lead.fullName || null,
          phone: lead.phoneNumber,
          email: lead.email || null,
          address: lead.address || null,
          city: lead.city || null,
          state: lead.state || null,
          zipCode: lead.zipCode || null,
          county: null,
          birthDate: null,
          age: null,
          gender: null,
          source: lead.leadSource || null,
          status: lead.status,
          priority: String(lead.priority),
          assignedToId: lead.assignedToId || null,
          lastContactedAt: lead.lastContactedAt?.toISOString() || null,
          nextFollowUpAt: null,
          doNotCall: false,
          insurance: null,
          compliance: null,
        };
      } else if (primaryRecordType === 'ProspectIntake' && prospectIntakes[0]) {
        const lead = prospectIntakes[0];
        customer = {
          id: lead.id,
          recordType: 'ProspectIntake',
          vertical: 'FE',
          firstName: lead.firstName || null,
          lastName: lead.lastName || null,
          fullName: lead.firstName && lead.lastName ? `${lead.firstName} ${lead.lastName}` : null,
          phone: lead.phone,
          email: lead.email || null,
          address: lead.street || null,
          city: lead.city || null,
          state: lead.state || null,
          zipCode: lead.zip || null,
          county: null,
          birthDate: lead.dob?.toISOString() || null,
          age: lead.age || null,
          gender: lead.gender || null,
          source: lead.source || null,
          status: lead.status,
          priority: null,
          assignedToId: lead.agentId || null,
          lastContactedAt: null,
          nextFollowUpAt: null,
          doNotCall: false,
          insurance: {
            smoker: null,
            faceAmount: null,
            coverageAmount: lead.coverageAmount?.toString() || null,
            lifeType: null,
            riskType: null,
            carrier: lead.carrier || null,
            product: null,
            monthlyPremium: lead.monthlyPremium?.toString() || null,
          },
          compliance: {
            trustedFormUrl: lead.trustedFormCertUrl || null,
            leadidToken: null,
            consentLanguage: null,
            recordingUrl: null,
          },
        };
      }

      // Compile duplicates (all matches except the primary chosen one)
      const duplicates: any[] = [];
      const pushDuplicate = (record: any, type: string, phoneVal: string) => {
        duplicates.push({
          id: record.id,
          recordType: type,
          fullName:
            record.fullName ||
            (record.firstName && record.lastName
              ? `${record.firstName} ${record.lastName}`
              : null) ||
            'Unnamed Record',
          phone: phoneVal,
          email: record.email || null,
          status: record.status || null,
          createdAt: record.createdAt.toISOString(),
        });
      };

      for (let i = primaryRecordType === 'InsuranceLead' ? 1 : 0; i < insuranceLeads.length; i++) {
        pushDuplicate(insuranceLeads[i], 'InsuranceLead', insuranceLeads[i].phone);
      }
      for (let i = primaryRecordType === 'Lead' ? 1 : 0; i < genericLeads.length; i++) {
        pushDuplicate(genericLeads[i], 'Lead', genericLeads[i].phoneNumber);
      }
      for (
        let i = primaryRecordType === 'ProspectIntake' ? 1 : 0;
        i < prospectIntakes.length;
        i++
      ) {
        pushDuplicate(prospectIntakes[i], 'ProspectIntake', prospectIntakes[i].phone);
      }

      return {
        customer,
        recentCalls: recentCallsList,
        activities: activitiesList,
        tasks: tasksList,
        submissions: submissionsList,
        duplicates,
      };
    } catch (error: unknown) {
      void reply.code(500);
      return {
        error: {
          code: 'LOOKUP_FAILED',
          message: (error as Error).message || 'Failed to search customer CRM records',
        },
      };
    }
  });
}
