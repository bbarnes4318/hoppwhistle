/**
 * Insurance Lead Pipeline — Orchestration Service
 *
 * Central entry point for the full lead lifecycle:
 *   ingest → validate → store → map → post → record result
 *
 * Also provides CRM read/update/stats/retry functions for the frontend.
 */

import type {
  Prisma,
  InsuranceValidationStatus,
  InsurancePostStatus,
  InsuranceLeadMode,
  InsuranceLeadStatus,
} from '@prisma/client';

import { createServiceLogger } from '../lib/logger.js';
import { getPrismaClient } from '../lib/prisma.js';

import { getInsuranceLeadMode } from './insurance-lead-config.js';
import { mapToAmeriquote } from './insurance-lead-mapper.js';
import { validateAndNormalize } from './insurance-lead-validator.js';

const log = createServiceLogger('insurance-lead-service');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Vertical = 'ACA' | 'FE' | 'B2B';

export interface IngestResult {
  insuranceLeadId: string;
  submissionId: string;
  validationStatus: 'VALID' | 'INVALID';
  postStatus: string;
  postMode: string;
  ameriquoteStatus?: string;
  errors?: Array<{ path: string; message: string }>;
}

export interface LeadFilters {
  vertical?: Vertical;
  validationStatus?: 'VALID' | 'INVALID';
  postStatus?: string;
  postMode?: 'TEST' | 'LIVE';
  search?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
  status?: string;
  leadStage?: string;
  followUp?: string;
  listId?: string;
}

// ---------------------------------------------------------------------------
// Ingest Lead — full pipeline
// ---------------------------------------------------------------------------

async function createActivity(
  tenantId: string,
  insuranceLeadId: string,
  activity: {
    type:
      | 'NOTE'
      | 'CALL'
      | 'STATUS_CHANGE'
      | 'SUBMISSION'
      | 'VALIDATION'
      | 'SYSTEM'
      | 'TASK'
      | 'COMPLIANCE';
    title: string;
    description?: string;
    metadata?: any;
    createdById?: string;
  }
) {
  const prisma = getPrismaClient();
  try {
    await prisma.insuranceActivity.create({
      data: {
        tenantId,
        insuranceLeadId,
        type: activity.type,
        title: activity.title,
        description: activity.description || null,
        metadata: (activity.metadata || undefined) as Prisma.InputJsonValue,
        createdById: activity.createdById || null,
      },
    });
  } catch (err) {
    log.error({ msg: 'Failed to create activity log', err, insuranceLeadId });
  }
}

function parseSafeDate(val: unknown): Date | null {
  if (!val) return null;
  const d = new Date(val as string | number | Date);
  return isNaN(d.getTime()) ? null : d;
}

// ---------------------------------------------------------------------------
// Ingest Lead — full pipeline
// ---------------------------------------------------------------------------

export async function ingestLead(
  tenantId: string,
  vertical: Vertical,
  rawPayload: Record<string, unknown>
): Promise<IngestResult> {
  const prisma = getPrismaClient();
  const mode = getInsuranceLeadMode();

  log.info({ msg: 'Ingesting insurance lead', tenantId, vertical, mode });

  // 1. Validate & Normalize
  const validation = validateAndNormalize(vertical, rawPayload);

  // 2. Build CRM contact fields from whatever we have
  const contactData = validation.normalized || rawPayload;
  const FIRST_CLASS_FIELDS = new Set([
    'id',
    'tenantId',
    'vertical',
    'firstName',
    'lastName',
    'fullName',
    'email',
    'phone',
    'address',
    'address2',
    'city',
    'county',
    'state',
    'zipCode',
    'birthDate',
    'age',
    'gender',
    'source',
    'status',
    'notes',
    'tags',
    'assignedToId',
    'assignedAt',
    'lastContactedAt',
    'nextFollowUpAt',
    'priority',
    'leadStage',
    'doNotCall',
    'duplicateOfId',
    'smoker',
    'faceAmount',
    'lifeType',
    'riskType',
    'carrier',
    'product',
    'monthlyPremium',
    'coverageAmount',
    'trustedFormUrl',
    'leadidToken',
    'consentLanguage',
    'recordingUrl',
    'createdAt',
    'updatedAt',
    'customFields',
    'listId',
    'company',
    'repName',
    'industry',
    'revenue',
    'yearEstablished',
  ]);
  const extraFields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(contactData)) {
    if (!FIRST_CLASS_FIELDS.has(key) && value !== undefined && value !== null) {
      extraFields[key] = value;
    }
  }
  const rawPhone = String(contactData.phone || contactData.primaryPhone || '').replace(/\D/g, '');
  const phone = rawPhone.length > 10 ? rawPhone.slice(-10) : rawPhone;
  const firstName = String(contactData.firstName || '').trim();
  const lastName = String(contactData.lastName || '').trim();

  // 3. Upsert InsuranceLead CRM master record
  // Find existing by tenant + phone + vertical, then update or create
  const existing = await prisma.insuranceLead.findFirst({
    where: { tenantId, phone, vertical },
  });

  let insuranceLead: { id: string };

  if (existing) {
    insuranceLead = await prisma.insuranceLead.update({
      where: { id: existing.id },
      data: {
        firstName: firstName || existing.firstName,
        lastName: lastName || existing.lastName,
        fullName: firstName && lastName ? `${firstName} ${lastName}` : existing.fullName,
        email: contactData.email ? String(contactData.email) : existing.email,
        address: contactData.address ? String(contactData.address) : existing.address,
        address2: contactData.address2 ? String(contactData.address2) : existing.address2,
        city: contactData.city ? String(contactData.city) : existing.city,
        county: contactData.county ? String(contactData.county) : existing.county,
        state: contactData.state ? String(contactData.state) : existing.state,
        zipCode: contactData.zipCode ? String(contactData.zipCode) : existing.zipCode,
        birthDate: contactData.birthDate ? String(contactData.birthDate) : existing.birthDate,
        age: typeof contactData.age === 'number' ? contactData.age : existing.age,
        gender: contactData.gender ? String(contactData.gender) : existing.gender,
        source: contactData.source ? String(contactData.source) : existing.source,
        // Update FE specific fields
        smoker: contactData.smoker ? String(contactData.smoker) : existing.smoker,
        faceAmount: contactData.faceAmount ? String(contactData.faceAmount) : existing.faceAmount,
        lifeType: contactData.lifeType ? String(contactData.lifeType) : existing.lifeType,
        riskType: contactData.riskType ? String(contactData.riskType) : existing.riskType,
        carrier: contactData.carrier ? String(contactData.carrier) : existing.carrier,
        product: contactData.product ? String(contactData.product) : existing.product,
        monthlyPremium: contactData.monthlyPremium
          ? String(contactData.monthlyPremium)
          : existing.monthlyPremium,
        coverageAmount: contactData.coverageAmount
          ? String(contactData.coverageAmount)
          : existing.coverageAmount,
        trustedFormUrl:
          contactData.trustedFormUrl || contactData.trustedFormCertUrl
            ? String(contactData.trustedFormUrl || contactData.trustedFormCertUrl)
            : existing.trustedFormUrl,
        leadidToken: contactData.leadidToken
          ? String(contactData.leadidToken)
          : existing.leadidToken,
        consentLanguage: contactData.consentLanguage
          ? String(contactData.consentLanguage)
          : existing.consentLanguage,
        recordingUrl: contactData.recordingUrl
          ? String(contactData.recordingUrl)
          : existing.recordingUrl,
        // Update B2B specific fields
        company: contactData.company ? String(contactData.company) : existing.company,
        repName: contactData.repName ? String(contactData.repName) : existing.repName,
        industry: contactData.industry ? String(contactData.industry) : existing.industry,
        revenue: contactData.revenue ? String(contactData.revenue) : existing.revenue,
        yearEstablished: contactData.yearEstablished
          ? String(contactData.yearEstablished)
          : existing.yearEstablished,
        // Shallow merge custom fields if they exist
        customFields: {
          ...((existing.customFields as Record<string, unknown>) || {}),
          ...((contactData.customFields as Record<string, unknown>) || {}),
          ...extraFields,
        } as any,
        // CRM fields
        notes: contactData.notes ? String(contactData.notes) : existing.notes,
        priority: contactData.priority ? String(contactData.priority) : existing.priority,
        nextFollowUpAt: contactData.nextFollowUpAt
          ? parseSafeDate(contactData.nextFollowUpAt) || existing.nextFollowUpAt
          : existing.nextFollowUpAt,
        status: contactData.status ? (contactData.status as InsuranceLeadStatus) : existing.status,
        leadStage: contactData.leadStage ? String(contactData.leadStage) : existing.leadStage,
        listId: contactData.listId ? String(contactData.listId) : existing.listId,
      },
    });

    // Write lead updated activity
    await createActivity(tenantId, insuranceLead.id, {
      type: 'SYSTEM',
      title: 'Lead Updated (Re-ingestion)',
      description: `Lead information updated via re-ingestion from source: ${String(contactData.source || 'unknown')}`,
    });
  } else {
    // FE specific fields parsed from contactData if valid/normalized
    insuranceLead = await prisma.insuranceLead.create({
      data: {
        tenantId,
        vertical,
        firstName: firstName || null,
        lastName: lastName || null,
        fullName: firstName && lastName ? `${firstName} ${lastName}` : null,
        phone: phone || `unknown-${Date.now()}`,
        email: contactData.email ? String(contactData.email) : null,
        address: contactData.address ? String(contactData.address) : null,
        address2: contactData.address2 ? String(contactData.address2) : null,
        city: contactData.city ? String(contactData.city) : null,
        county: contactData.county ? String(contactData.county) : null,
        state: contactData.state ? String(contactData.state) : null,
        zipCode: contactData.zipCode ? String(contactData.zipCode) : null,
        birthDate: contactData.birthDate ? String(contactData.birthDate) : null,
        age: typeof contactData.age === 'number' ? contactData.age : null,
        gender: contactData.gender ? String(contactData.gender) : null,
        source: contactData.source ? String(contactData.source) : null,
        // Optional FE specific fields
        smoker: contactData.smoker ? String(contactData.smoker) : null,
        faceAmount: contactData.faceAmount ? String(contactData.faceAmount) : null,
        lifeType: contactData.lifeType ? String(contactData.lifeType) : null,
        riskType: contactData.riskType ? String(contactData.riskType) : null,
        carrier: contactData.carrier ? String(contactData.carrier) : null,
        product: contactData.product ? String(contactData.product) : null,
        monthlyPremium: contactData.monthlyPremium ? String(contactData.monthlyPremium) : null,
        coverageAmount: contactData.coverageAmount ? String(contactData.coverageAmount) : null,
        trustedFormUrl:
          contactData.trustedFormUrl || contactData.trustedFormCertUrl
            ? String(contactData.trustedFormUrl || contactData.trustedFormCertUrl)
            : null,
        leadidToken: contactData.leadidToken ? String(contactData.leadidToken) : null,
        consentLanguage: contactData.consentLanguage ? String(contactData.consentLanguage) : null,
        recordingUrl: contactData.recordingUrl ? String(contactData.recordingUrl) : null,
        // Optional B2B specific fields
        company: contactData.company ? String(contactData.company) : null,
        repName: contactData.repName ? String(contactData.repName) : null,
        industry: contactData.industry ? String(contactData.industry) : null,
        revenue: contactData.revenue ? String(contactData.revenue) : null,
        yearEstablished: contactData.yearEstablished ? String(contactData.yearEstablished) : null,
        customFields: {
          ...((contactData.customFields as Record<string, unknown>) || {}),
          ...extraFields,
        } as any,
        // CRM fields
        notes: contactData.notes ? String(contactData.notes) : null,
        priority: contactData.priority ? String(contactData.priority) : null,
        nextFollowUpAt: contactData.nextFollowUpAt
          ? parseSafeDate(contactData.nextFollowUpAt)
          : null,
        status: contactData.status ? (contactData.status as InsuranceLeadStatus) : 'NEW',
        leadStage: contactData.leadStage ? String(contactData.leadStage) : null,
        listId: contactData.listId ? String(contactData.listId) : null,
      },
    });

    // Write lead created activity
    await createActivity(tenantId, insuranceLead.id, {
      type: 'SYSTEM',
      title: 'Lead Ingested',
      description: `New insurance lead ingested via source: ${String(contactData.source || 'unknown')}`,
    });
  }

  // 4. Create submission audit record
  const submission = await prisma.insuranceLeadSubmission.create({
    data: {
      tenantId,
      insuranceLeadId: insuranceLead.id,
      vertical,
      source: contactData.source ? String(contactData.source) : null,
      rawPayload: rawPayload as Prisma.InputJsonValue,
      normalizedPayload: (validation.normalized || {}) as Prisma.InputJsonValue,
      validationStatus: validation.valid ? 'VALID' : 'INVALID',
      validationErrors: validation.errors
        ? (validation.errors as unknown as Prisma.InputJsonValue)
        : undefined,
      postStatus: validation.valid ? 'PENDING' : 'SKIPPED',
      postMode: mode,
    },
  });

  // Write submission received activity
  await createActivity(tenantId, insuranceLead.id, {
    type: 'SUBMISSION',
    title: 'Submission Received',
    description: `Submission recorded for vertical ${vertical}.`,
    metadata: { submissionId: submission.id },
  });

  // 5. If valid, map the outbound payload for review — but do NOT post.
  //    Posting to the buyer only happens via explicit manual trigger
  //    (POST /api/v1/insurance-leads/:id/submissions/:submissionId/retry).
  if (validation.valid && validation.normalized) {
    try {
      const { redactedPayload } = mapToAmeriquote(vertical, validation.normalized);

      // Store mapped payload (redacted) so the user can review before sending
      await prisma.insuranceLeadSubmission.update({
        where: { id: submission.id },
        data: {
          mappedOutboundPayload: redactedPayload as unknown as Prisma.InputJsonValue,
          postStatus: 'HOLD', // Held until explicit send
        },
      });

      // Write lead held activity
      await createActivity(tenantId, insuranceLead.id, {
        type: 'SYSTEM',
        title: 'Lead Held',
        description: 'Ameriquote posting is disabled by owner request. Lead held on HOLD.',
      });

      log.info({
        msg: 'Lead validated and held — NOT posted (auto-post disabled)',
        submissionId: submission.id,
        vertical,
      });

      return {
        insuranceLeadId: insuranceLead.id,
        submissionId: submission.id,
        validationStatus: 'VALID',
        postStatus: 'HOLD',
        postMode: mode,
        ameriquoteStatus: undefined,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error({ msg: 'Failed to map lead', submissionId: submission.id, error: message });

      return {
        insuranceLeadId: insuranceLead.id,
        submissionId: submission.id,
        validationStatus: 'VALID',
        postStatus: 'HOLD',
        postMode: mode,
        ameriquoteStatus: undefined,
      };
    }
  }

  // Invalid lead — stored but not posted
  log.info({
    msg: 'Lead stored as invalid, not posted',
    submissionId: submission.id,
    errorCount: validation.errors?.length,
  });

  // Write validation failed activity
  await createActivity(tenantId, insuranceLead.id, {
    type: 'VALIDATION',
    title: 'Validation Failed',
    description: `Inbound lead validation failed with ${validation.errors?.length || 0} errors.`,
    metadata: { errors: validation.errors },
  });

  return {
    insuranceLeadId: insuranceLead.id,
    submissionId: submission.id,
    validationStatus: 'INVALID',
    postStatus: 'SKIPPED',
    postMode: mode,
    errors: validation.errors || undefined,
  };
}

// ---------------------------------------------------------------------------
// CRM Read Operations
// ---------------------------------------------------------------------------

export async function getLeads(tenantId: string, filters: LeadFilters) {
  const prisma = getPrismaClient();
  const page = filters.page || 1;
  const limit = Math.min(filters.limit || 25, 50000);
  const skip = (page - 1) * limit;

  const where: Prisma.InsuranceLeadWhereInput = { tenantId };

  if (filters.vertical) where.vertical = filters.vertical;

  // Search across name, phone, email, zip, city, state
  if (filters.search) {
    const s = filters.search;
    const cleanSearch = s.replace(/\D/g, '');
    const phoneSearch =
      cleanSearch.length > 0
        ? cleanSearch.length > 10
          ? cleanSearch.slice(-10)
          : cleanSearch
        : '';
    const orConditions: Prisma.InsuranceLeadWhereInput[] = [
      { firstName: { contains: s, mode: 'insensitive' } },
      { lastName: { contains: s, mode: 'insensitive' } },
      { fullName: { contains: s, mode: 'insensitive' } },
      { email: { contains: s, mode: 'insensitive' } },
      { zipCode: { contains: s } },
      { city: { contains: s, mode: 'insensitive' } },
      { state: { contains: s, mode: 'insensitive' } },
    ];
    if (phoneSearch.length > 0) {
      orConditions.push({ phone: { contains: phoneSearch } });
    }
    where.OR = orConditions;
  }

  // Date range
  if (filters.startDate || filters.endDate) {
    const dateFilter: Prisma.DateTimeFilter = {};
    if (filters.startDate) dateFilter.gte = new Date(filters.startDate);
    if (filters.endDate) dateFilter.lte = new Date(filters.endDate);
    where.createdAt = dateFilter;
  }

  // For submission-level filters, use a submissions relation filter
  if (filters.validationStatus || filters.postStatus || filters.postMode) {
    const subFilter: Prisma.InsuranceLeadSubmissionWhereInput = {};
    if (filters.validationStatus)
      subFilter.validationStatus = filters.validationStatus as InsuranceValidationStatus;
    if (filters.postStatus) subFilter.postStatus = filters.postStatus as InsurancePostStatus;
    if (filters.postMode) subFilter.postMode = filters.postMode as InsuranceLeadMode;
    where.submissions = { some: subFilter };
  }

  // CRM status & stage filters
  if (filters.status) {
    where.status = filters.status as InsuranceLeadStatus;
  }
  if (filters.leadStage) {
    where.leadStage = filters.leadStage;
  }
  if (filters.listId) {
    where.listId = filters.listId;
  }

  // CRM follow-up filter
  if (filters.followUp) {
    const now = new Date();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    if (filters.followUp.toUpperCase() === 'OVERDUE') {
      where.nextFollowUpAt = { lt: now };
      where.status = { notIn: ['LOST', 'CONVERTED'] };
    } else if (filters.followUp.toUpperCase() === 'TODAY') {
      where.nextFollowUpAt = {
        gte: startOfToday,
        lte: endOfToday,
      };
    } else if (filters.followUp.toUpperCase() === 'TOMORROW') {
      const startOfTomorrow = new Date(startOfToday);
      startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
      const endOfTomorrow = new Date(endOfToday);
      endOfTomorrow.setDate(endOfTomorrow.getDate() + 1);
      where.nextFollowUpAt = {
        gte: startOfTomorrow,
        lte: endOfTomorrow,
      };
    } else if (filters.followUp.toUpperCase() === 'UPCOMING') {
      where.nextFollowUpAt = { gt: now };
    } else if (filters.followUp.toUpperCase() === 'NONE') {
      where.nextFollowUpAt = null;
    }
  }

  const [leads, total] = await Promise.all([
    prisma.insuranceLead.findMany({
      where,
      include: {
        submissions: {
          orderBy: { receivedAt: 'desc' },
          take: 1,
          select: {
            id: true,
            receivedAt: true,
            validationStatus: true,
            postStatus: true,
            postMode: true,
            ameriquoteResponseStatus: true,
            source: true,
          },
        },
      },
      orderBy: [
        { lastContactedAt: { sort: 'asc', nulls: 'first' } },
        { createdAt: 'desc' },
      ],
      take: limit,
      skip,
    }),
    prisma.insuranceLead.count({ where }),
  ]);

  return {
    data: leads.map(lead => ({
      id: lead.id,
      vertical: lead.vertical,
      firstName: lead.firstName,
      lastName: lead.lastName,
      fullName: lead.fullName,
      phone: lead.phone,
      email: lead.email,
      state: lead.state,
      zipCode: lead.zipCode,
      source: lead.source,
      status: lead.status,
      leadStage: lead.leadStage,
      nextFollowUpAt: lead.nextFollowUpAt ? lead.nextFollowUpAt.toISOString() : null,
      createdAt: lead.createdAt.toISOString(),
      latestSubmission: lead.submissions[0]
        ? {
            id: lead.submissions[0].id,
            receivedAt: lead.submissions[0].receivedAt.toISOString(),
            validationStatus: lead.submissions[0].validationStatus,
            postStatus: lead.submissions[0].postStatus,
            postMode: lead.submissions[0].postMode,
            ameriquoteResponseStatus: lead.submissions[0].ameriquoteResponseStatus,
            source: lead.submissions[0].source,
          }
        : null,
    })),
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export interface ActivityReturn {
  id: string;
  tenantId: string;
  insuranceLeadId: string;
  type: string;
  title: string;
  description: string | null;
  createdAt: string;
  metadata?: any;
  createdById?: string | null;
}

export async function getLeadById(tenantId: string, id: string) {
  const prisma = getPrismaClient();

  const lead = await prisma.insuranceLead.findFirst({
    where: { id, tenantId },
    include: {
      submissions: {
        orderBy: { receivedAt: 'desc' },
      },
      activities: {
        orderBy: { createdAt: 'desc' },
      },
      tasks: {
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!lead) return null;

  const last10 = lead.phone.replace(/\D/g, '').slice(-10);
  const callActivities: ActivityReturn[] = [];
  if (last10.length >= 10) {
    const calls = await prisma.call.findMany({
      where: {
        tenantId,
        OR: [{ callerId: { endsWith: last10 } }, { toNumber: { endsWith: last10 } }],
      },
      orderBy: { createdAt: 'desc' },
    });
    const mappedCalls = calls.map(c => ({
      id: `call-note-${c.id}`,
      tenantId: c.tenantId,
      insuranceLeadId: lead.id,
      type: 'CALL',
      title: `Call (${c.direction}) - ${c.campaignName || 'Call Center'}`,
      description: c.dispositionNotes
        ? `Disposition: ${c.disposition || 'None'}\nNotes: ${c.dispositionNotes}`
        : `Disposition: ${c.disposition || 'None'}`,
      createdAt: c.createdAt.toISOString(),
      metadata: null,
      createdById: null,
    }));
    callActivities.push(...mappedCalls);
  }

  const dbActivities: ActivityReturn[] = lead.activities.map(a => ({
    id: a.id,
    tenantId: a.tenantId,
    insuranceLeadId: a.insuranceLeadId,
    type: String(a.type),
    title: a.title,
    description: a.description || null,
    createdAt: a.createdAt.toISOString(),
    metadata: a.metadata,
    createdById: a.createdById || null,
  }));

  const sortedActivities: ActivityReturn[] = [...dbActivities, ...callActivities].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return {
    ...lead,
    createdAt: lead.createdAt.toISOString(),
    updatedAt: lead.updatedAt.toISOString(),
    submissions: lead.submissions.map(s => ({
      ...s,
      receivedAt: s.receivedAt.toISOString(),
      postedAt: s.postedAt?.toISOString() || null,
      lastAttemptAt: s.lastAttemptAt?.toISOString() || null,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    })),
    activities: sortedActivities,
    tasks: lead.tasks.map(t => ({
      ...t,
      dueAt: t.dueAt?.toISOString() || null,
      completedAt: t.completedAt?.toISOString() || null,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    })),
  };
}

// ---------------------------------------------------------------------------
// CRM Update
// ---------------------------------------------------------------------------

interface InsuranceLeadCRMUpdates {
  firstName?: string;
  lastName?: string;
  fullName?: string;
  email?: string;
  phone?: string;
  address?: string;
  address2?: string;
  city?: string;
  county?: string;
  state?: string;
  zipCode?: string;
  birthDate?: string;
  age?: number;
  gender?: string;
  source?: string;
  notes?: string;
  status?: string;
  assignedToId?: string | null;
  assignedAt?: Date | null;
  lastContactedAt?: Date | null;
  nextFollowUpAt?: Date | null;
  priority?: string | null;
  leadStage?: string | null;
  doNotCall?: boolean;
  duplicateOfId?: string | null;
  smoker?: boolean | null;
  faceAmount?: number | null;
  lifeType?: string | null;
  riskType?: string | null;
  carrier?: string | null;
  product?: string | null;
  monthlyPremium?: number | null;
  coverageAmount?: number | null;
  trustedFormUrl?: string | null;
  leadidToken?: string | null;
  consentLanguage?: string | null;
  recordingUrl?: string | null;
}

export async function updateLead(tenantId: string, id: string, updates: Record<string, unknown>) {
  const prisma = getPrismaClient();

  const existing = await prisma.insuranceLead.findFirst({
    where: { id, tenantId },
  });

  if (!existing) return null;

  const allowedFields = [
    'firstName',
    'lastName',
    'fullName',
    'email',
    'phone',
    'address',
    'address2',
    'city',
    'county',
    'state',
    'zipCode',
    'birthDate',
    'age',
    'gender',
    'source',
    'notes',
    'status',
    // CRM fields
    'assignedToId',
    'assignedAt',
    'lastContactedAt',
    'nextFollowUpAt',
    'priority',
    'leadStage',
    'doNotCall',
    'duplicateOfId',
    // FE fields
    'smoker',
    'faceAmount',
    'lifeType',
    'riskType',
    'carrier',
    'product',
    'monthlyPremium',
    'coverageAmount',
    'trustedFormUrl',
    'leadidToken',
    'consentLanguage',
    'recordingUrl',
    'customFields',
    'company',
    'repName',
    'industry',
    'revenue',
    'yearEstablished',
  ];

  const data: InsuranceLeadCRMUpdates = {};
  const dataObj = data as Record<string, unknown>;
  for (const key of allowedFields) {
    if (updates[key] !== undefined) {
      if (
        ['assignedAt', 'lastContactedAt', 'nextFollowUpAt'].includes(key) &&
        typeof updates[key] === 'string'
      ) {
        dataObj[key] = new Date(updates[key]);
      } else if (key === 'doNotCall') {
        dataObj[key] = updates[key] === true || updates[key] === 'true';
      } else {
        dataObj[key] = updates[key];
      }
    }
  }

  // Auto-compute fullName
  if (data.firstName || data.lastName) {
    const fn = data.firstName || existing.firstName || '';
    const ln = data.lastName || existing.lastName || '';
    if (fn && ln) data.fullName = `${fn} ${ln}`;
  }

  const updated = await prisma.insuranceLead.update({
    where: { id },
    data: data as Prisma.InsuranceLeadUpdateInput,
  });

  // Log status change activity
  if (data.status && data.status !== existing.status) {
    await createActivity(tenantId, id, {
      type: 'STATUS_CHANGE',
      title: 'Status Changed',
      description: `Lead status changed from ${existing.status} to ${data.status}.`,
    });
  }

  // Log notes change activity
  if (data.notes !== undefined && data.notes !== existing.notes) {
    await createActivity(tenantId, id, {
      type: 'NOTE',
      title: existing.notes ? 'Notes Updated' : 'Notes Added',
      description: data.notes || undefined,
    });
  }

  // Log general updates
  const updatedKeys = Object.keys(data).filter(
    k =>
      k !== 'status' &&
      k !== 'notes' &&
      String(data[k as keyof InsuranceLeadCRMUpdates]) !==
        String(existing[k as keyof typeof existing])
  );
  if (updatedKeys.length > 0) {
    await createActivity(tenantId, id, {
      type: 'SYSTEM',
      title: 'Lead Information Updated',
      description: `Updated fields: ${updatedKeys.join(', ')}.`,
    });
  }

  return updated;
}

// ---------------------------------------------------------------------------
// Retry Submission
// ---------------------------------------------------------------------------

export async function retrySubmission(tenantId: string, leadId: string, submissionId: string) {
  const prisma = getPrismaClient();
  const mode = getInsuranceLeadMode();

  const submission = await prisma.insuranceLeadSubmission.findFirst({
    where: { id: submissionId, tenantId, insuranceLeadId: leadId },
  });

  if (!submission) return { error: 'Submission not found' };
  if (submission.validationStatus !== 'VALID') return { error: 'Cannot retry invalid submissions' };

  // INTENTIONALLY DISABLED BY OWNER REQUEST - DO NOT RE-ENABLE WITHOUT EXPLICIT OWNER INSTRUCTION
  await prisma.insuranceLeadSubmission.update({
    where: { id: submissionId },
    data: {
      postStatus: 'HOLD',
      postMode: mode,
      ameriquoteErrorMessage: 'Ameriquote delivery is disabled by owner request.',
      lastAttemptAt: new Date(),
      attemptCount: { increment: 1 },
    },
  });

  // Write timeline activity for the blocked attempt
  await createActivity(tenantId, leadId, {
    type: 'SUBMISSION',
    title: 'Ameriquote Post Blocked',
    description: 'Manual retry was blocked: Ameriquote delivery is disabled by owner request.',
    metadata: { submissionId },
  });

  return {
    success: false,
    postStatus: 'HOLD',
    disabled: true,
    message: 'Ameriquote delivery is disabled by owner request.',
  };
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export async function getStats(tenantId: string) {
  const prisma = getPrismaClient();

  const [
    totalLeads,
    acaLeads,
    feLeads,
    totalSubmissions,
    validSubmissions,
    invalidSubmissions,
    matchedSubmissions,
    unmatchedSubmissions,
    errorSubmissions,
    testSubmissions,
    liveSubmissions,
  ] = await Promise.all([
    prisma.insuranceLead.count({ where: { tenantId } }),
    prisma.insuranceLead.count({ where: { tenantId, vertical: 'ACA' } }),
    prisma.insuranceLead.count({ where: { tenantId, vertical: 'FE' } }),
    prisma.insuranceLeadSubmission.count({ where: { tenantId } }),
    prisma.insuranceLeadSubmission.count({ where: { tenantId, validationStatus: 'VALID' } }),
    prisma.insuranceLeadSubmission.count({ where: { tenantId, validationStatus: 'INVALID' } }),
    prisma.insuranceLeadSubmission.count({ where: { tenantId, postStatus: 'MATCHED' } }),
    prisma.insuranceLeadSubmission.count({ where: { tenantId, postStatus: 'UNMATCHED' } }),
    prisma.insuranceLeadSubmission.count({ where: { tenantId, postStatus: 'ERROR' } }),
    prisma.insuranceLeadSubmission.count({ where: { tenantId, postMode: 'TEST' } }),
    prisma.insuranceLeadSubmission.count({ where: { tenantId, postMode: 'LIVE' } }),
  ]);

  return {
    totalLeads,
    acaLeads,
    feLeads,
    totalSubmissions,
    validSubmissions,
    invalidSubmissions,
    matchedSubmissions,
    unmatchedSubmissions,
    errorSubmissions,
    testSubmissions,
    liveSubmissions,
  };
}

// ---------------------------------------------------------------------------
// Bulk Import
// ---------------------------------------------------------------------------

export async function bulkImportLeads(tenantId: string, leads: Array<Record<string, unknown>>) {
  const prisma = getPrismaClient();
  let importCount = 0;

  const standardFields = [
    'firstName',
    'lastName',
    'fullName',
    'email',
    'phone',
    'address',
    'address2',
    'city',
    'county',
    'state',
    'zipCode',
    'birthDate',
    'age',
    'gender',
    'source',
    'notes',
    'status',
    'assignedToId',
    'assignedAt',
    'lastContactedAt',
    'nextFollowUpAt',
    'priority',
    'leadStage',
    'doNotCall',
    'smoker',
    'faceAmount',
    'monthlyPremium',
    'carrier',
    'coverageAmount',
    'lifeType',
    'riskType',
    'product',
    'trustedFormUrl',
    'leadidToken',
    'consentLanguage',
    'recordingUrl',
  ];

  for (const lead of leads) {
    const rawPhone = String(lead.phone || lead.phoneNumber || '').trim();
    if (!rawPhone) continue;

    // Normalize phone to last 10 digits
    const cleanPhone = rawPhone.replace(/\D/g, '');
    const phone = cleanPhone.length > 10 ? cleanPhone.slice(-10) : cleanPhone;
    if (phone.length < 10) continue; // Skip invalid phone numbers

    const firstName = lead.firstName ? String(lead.firstName).trim() : null;
    const lastName = lead.lastName ? String(lead.lastName).trim() : null;
    const fullName = lead.fullName
      ? String(lead.fullName).trim()
      : firstName && lastName
        ? `${firstName} ${lastName}`
        : null;

    // Extract custom fields (any fields not in standardFields list)
    const customFields: Record<string, unknown> = {};
    for (const key of Object.keys(lead)) {
      if (
        !standardFields.includes(key) &&
        key !== 'id' &&
        key !== 'tenantId' &&
        lead[key] !== undefined
      ) {
        customFields[key] = lead[key];
      }
    }

    // Merge with any customFields explicitly provided as an object
    if (lead.customFields && typeof lead.customFields === 'object') {
      Object.assign(customFields, lead.customFields);
    }

    const vertical = String(lead.vertical || 'FE').toUpperCase() === 'ACA' ? 'ACA' : 'FE';

    // Find existing by tenant + phone + vertical
    const existing = await prisma.insuranceLead.findFirst({
      where: { tenantId, phone, vertical },
    });

    const data: Prisma.InsuranceLeadUpdateInput = {
      firstName: firstName || (existing ? existing.firstName : null),
      lastName: lastName || (existing ? existing.lastName : null),
      fullName: fullName || (existing ? existing.fullName : null),
      email: lead.email ? String(lead.email).trim() : existing ? existing.email : null,
      address: lead.address ? String(lead.address).trim() : existing ? existing.address : null,
      address2: lead.address2 ? String(lead.address2).trim() : existing ? existing.address2 : null,
      city: lead.city ? String(lead.city).trim() : existing ? existing.city : null,
      county: lead.county ? String(lead.county).trim() : existing ? existing.county : null,
      state: lead.state ? String(lead.state).trim() : existing ? existing.state : null,
      zipCode: lead.zipCode ? String(lead.zipCode).trim() : existing ? existing.zipCode : null,
      birthDate: lead.birthDate
        ? String(lead.birthDate).trim()
        : existing
          ? existing.birthDate
          : null,
      age: typeof lead.age === 'number' ? lead.age : existing ? existing.age : null,
      gender: lead.gender ? String(lead.gender).trim() : existing ? existing.gender : null,
      source: lead.source ? String(lead.source).trim() : existing ? existing.source : 'bulk_upload',
      status: (() => {
        if (lead.status) {
          const upper = String(lead.status).toUpperCase().trim();
          if (['NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'LOST'].includes(upper)) {
            return upper as InsuranceLeadStatus;
          }
        }
        return existing ? existing.status : 'NEW';
      })(),

      smoker: lead.smoker ? String(lead.smoker).trim() : existing ? existing.smoker : null,
      faceAmount: lead.faceAmount
        ? String(lead.faceAmount).trim()
        : existing
          ? existing.faceAmount
          : null,
      monthlyPremium: lead.monthlyPremium
        ? String(lead.monthlyPremium).trim()
        : existing
          ? existing.monthlyPremium
          : null,
      carrier: lead.carrier ? String(lead.carrier).trim() : existing ? existing.carrier : null,
      coverageAmount: lead.coverageAmount
        ? String(lead.coverageAmount).trim()
        : existing
          ? existing.coverageAmount
          : null,

      // Store customFields as a JSON object
      customFields: (
        Object.keys(customFields).length > 0
          ? customFields
          : existing
            ? (existing.customFields as Prisma.InputJsonValue)
            : {}
      ) as any,
    };

    if (existing) {
      await prisma.insuranceLead.update({
        where: { id: existing.id },
        data,
      });
    } else {
      await prisma.insuranceLead.create({
        data: {
          ...data,
          phone,
          vertical,
          tenant: { connect: { id: tenantId } },
        } as Prisma.InsuranceLeadCreateInput,
      });
    }
    importCount++;
  }

  return { success: true, count: importCount };
}
