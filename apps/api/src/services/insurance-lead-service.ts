/**
 * Insurance Lead Pipeline — Orchestration Service
 *
 * Central entry point for the full lead lifecycle:
 *   ingest → validate → store → map → post → record result
 *
 * Also provides CRM read/update/stats/retry functions for the frontend.
 */

import type { Prisma } from '@prisma/client';

import { createServiceLogger } from '../lib/logger.js';
import { getPrismaClient } from '../lib/prisma.js';
import { getInsuranceLeadMode } from './insurance-lead-config.js';
import { mapToAmeriquote } from './insurance-lead-mapper.js';
import { postToAmeriquote } from './insurance-lead-poster.js';
import { validateAndNormalize } from './insurance-lead-validator.js';

const log = createServiceLogger('insurance-lead-service');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Vertical = 'ACA' | 'FE';

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
}

// ---------------------------------------------------------------------------
// Ingest Lead — full pipeline
// ---------------------------------------------------------------------------

export async function ingestLead(
  tenantId: string,
  vertical: Vertical,
  rawPayload: Record<string, unknown>,
): Promise<IngestResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma = getPrismaClient() as any;
  const mode = getInsuranceLeadMode();

  log.info({ msg: 'Ingesting insurance lead', tenantId, vertical, mode });

  // 1. Validate & Normalize
  const validation = validateAndNormalize(vertical, rawPayload);

  // 2. Build CRM contact fields from whatever we have
  const contactData = validation.normalized || rawPayload;
  const phone = String(contactData.phone || contactData.primaryPhone || '').replace(/\D/g, '');
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
        fullName: (firstName && lastName) ? `${firstName} ${lastName}` : existing.fullName,
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
      },
    });
  } else {
    insuranceLead = await prisma.insuranceLead.create({
      data: {
        tenantId,
        vertical,
        firstName: firstName || null,
        lastName: lastName || null,
        fullName: (firstName && lastName) ? `${firstName} ${lastName}` : null,
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
      },
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
          postStatus: 'HOLD',   // Held until explicit send
        },
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma = getPrismaClient() as any;
  const page = filters.page || 1;
  const limit = Math.min(filters.limit || 25, 100);
  const skip = (page - 1) * limit;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { tenantId };

  if (filters.vertical) where.vertical = filters.vertical;

  // Search across name, phone, email, zip
  if (filters.search) {
    const s = filters.search;
    where.OR = [
      { firstName: { contains: s, mode: 'insensitive' } },
      { lastName: { contains: s, mode: 'insensitive' } },
      { fullName: { contains: s, mode: 'insensitive' } },
      { phone: { contains: s } },
      { email: { contains: s, mode: 'insensitive' } },
      { zipCode: { contains: s } },
    ];
  }

  // Date range
  if (filters.startDate || filters.endDate) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dateFilter: any = {};
    if (filters.startDate) dateFilter.gte = new Date(filters.startDate);
    if (filters.endDate) dateFilter.lte = new Date(filters.endDate);
    where.createdAt = dateFilter;
  }

  // For submission-level filters, use a submissions relation filter
  if (filters.validationStatus || filters.postStatus || filters.postMode) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const subFilter: any = {};
    if (filters.validationStatus) subFilter.validationStatus = filters.validationStatus;
    if (filters.postStatus) subFilter.postStatus = filters.postStatus;
    if (filters.postMode) subFilter.postMode = filters.postMode;
    where.submissions = { some: subFilter };
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
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip,
    }),
    prisma.insuranceLead.count({ where }),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: (leads as any[]).map((lead: any) => ({
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

export async function getLeadById(tenantId: string, id: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma = getPrismaClient() as any;

  const lead = await prisma.insuranceLead.findFirst({
    where: { id, tenantId },
    include: {
      submissions: {
        orderBy: { receivedAt: 'desc' },
      },
    },
  });

  if (!lead) return null;

  return {
    ...lead,
    createdAt: lead.createdAt.toISOString(),
    updatedAt: lead.updatedAt.toISOString(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    submissions: (lead.submissions as any[]).map((s: any) => ({
      ...s,
      receivedAt: s.receivedAt.toISOString(),
      postedAt: s.postedAt?.toISOString() || null,
      lastAttemptAt: s.lastAttemptAt?.toISOString() || null,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    })),
  };
}

// ---------------------------------------------------------------------------
// CRM Update
// ---------------------------------------------------------------------------

export async function updateLead(
  tenantId: string,
  id: string,
  updates: Record<string, unknown>,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma = getPrismaClient() as any;

  const existing = await prisma.insuranceLead.findFirst({
    where: { id, tenantId },
  });

  if (!existing) return null;

  const allowedFields = [
    'firstName', 'lastName', 'fullName', 'email', 'phone',
    'address', 'address2', 'city', 'county', 'state', 'zipCode',
    'birthDate', 'age', 'gender', 'source', 'notes', 'status',
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: Record<string, any> = {};
  for (const key of allowedFields) {
    if (updates[key] !== undefined) {
      data[key] = updates[key];
    }
  }

  // Auto-compute fullName
  if (data.firstName || data.lastName) {
    const fn = (data.firstName || existing.firstName || '') as string;
    const ln = (data.lastName || existing.lastName || '') as string;
    if (fn && ln) data.fullName = `${fn} ${ln}`;
  }

  const updated = await prisma.insuranceLead.update({
    where: { id },
    data,
  });

  return updated;
}

// ---------------------------------------------------------------------------
// Retry Submission
// ---------------------------------------------------------------------------

export async function retrySubmission(
  tenantId: string,
  leadId: string,
  submissionId: string,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma = getPrismaClient() as any;
  const mode = getInsuranceLeadMode();

  const submission = await prisma.insuranceLeadSubmission.findFirst({
    where: { id: submissionId, tenantId, insuranceLeadId: leadId },
  });

  if (!submission) return { error: 'Submission not found' };
  if (submission.validationStatus !== 'VALID') return { error: 'Cannot retry invalid submissions' };
  if (submission.postStatus === 'MATCHED') return { error: 'Submission already matched' };

  const normalized = submission.normalizedPayload as Record<string, unknown>;
  if (!normalized) return { error: 'No normalized payload available' };

  const vertical = submission.vertical as Vertical;

  try {
    const { fullPayload, redactedPayload } = mapToAmeriquote(vertical, normalized);

    await prisma.insuranceLeadSubmission.update({
      where: { id: submissionId },
      data: {
        mappedOutboundPayload: redactedPayload as unknown as Prisma.InputJsonValue,
        postMode: mode,
        postStatus: 'PENDING',
      },
    });

    const result = await postToAmeriquote(fullPayload);

    let postStatus = 'ERROR';
    if (result.status === 'Matched') postStatus = 'MATCHED';
    else if (result.status === 'Unmatched') postStatus = 'UNMATCHED';

    await prisma.insuranceLeadSubmission.update({
      where: { id: submissionId },
      data: {
        postStatus,
        postMode: mode,
        ameriquoteResponseRaw: result.rawBody || null,
        ameriquoteResponseStatus: result.status,
        ameriquoteLeadId: result.leadId || null,
        ameriquotePrice: result.price || null,
        ameriquoteErrorMessage: result.errorMessage || null,
        postedAt: new Date(),
        lastAttemptAt: new Date(),
        attemptCount: { increment: 1 },
      },
    });

    return { success: true, postStatus, ameriquoteStatus: result.status };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    await prisma.insuranceLeadSubmission.update({
      where: { id: submissionId },
      data: {
        postStatus: 'ERROR',
        ameriquoteErrorMessage: message,
        lastAttemptAt: new Date(),
        attemptCount: { increment: 1 },
      },
    });

    return { error: message };
  }
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export async function getStats(tenantId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma = getPrismaClient() as any;

  const [
    totalLeads, acaLeads, feLeads,
    totalSubmissions, validSubmissions, invalidSubmissions,
    matchedSubmissions, unmatchedSubmissions, errorSubmissions,
    testSubmissions, liveSubmissions,
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
    totalLeads, acaLeads, feLeads,
    totalSubmissions, validSubmissions, invalidSubmissions,
    matchedSubmissions, unmatchedSubmissions, errorSubmissions,
    testSubmissions, liveSubmissions,
  };
}
