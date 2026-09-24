/**
 * The agency CRM's pipeline: prospects, and the prospects that became
 * submitted applications.
 *
 * ── What "converted" means here ──────────────────────────────────────────────
 *
 * A lead is converted when a SUBMITTED, NON-VOIDED application exists for it.
 * The same definition the applications page and the closing percentage use:
 * a PENDING carrier row is not business the agency wrote, and a voided one was
 * taken out of the measurement by NetEnroll.
 *
 * `InsuranceCarrierApplication.insuranceLeadId` is the direct link, but it is a
 * plain optional column and most applications are logged from the console
 * without it. So an application is also tied to a lead by the applicant's
 * phone number -- the one field both records always carry, normalised to its
 * last ten digits on both sides. A lead with either kind of match leaves the
 * prospect list and appears under Submitted Apps.
 *
 * ── Whose rows ───────────────────────────────────────────────────────────────
 *
 * An agency principal sees the agency. An agent sees the applications they
 * wrote (`createdById`) and the leads assigned to them -- the same narrowing
 * `GET /api/v1/applications` and `GET /api/v1/insurance-leads` already apply,
 * decided by the route from the principal and never from the query string.
 */

import type { Prisma } from '@prisma/client';

import { getPrismaClient } from '../lib/prisma.js';

/** Ten digits, or null. Applications store digits only; leads store ten. */
export function lastTenDigits(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : null;
}

export interface PipelineScope {
  tenantId: string;
  /** The agent's own id, or undefined for an agency principal. */
  agentId?: string;
  /** States a state-restricted agent may work. Undefined means unrestricted. */
  licensedStates?: string[];
}

export interface PipelineRange {
  /** Inclusive lower bound on `submittedAt`. */
  from?: Date;
  /** Exclusive upper bound on `submittedAt`. */
  to?: Date;
}

function submittedApplicationWhere(
  scope: PipelineScope,
  range: PipelineRange = {}
): Prisma.InsuranceCarrierApplicationWhereInput {
  return {
    tenantId: scope.tenantId,
    submittedAt: {
      not: null,
      ...(range.from ? { gte: range.from } : {}),
      ...(range.to ? { lt: range.to } : {}),
    },
    voidedAt: null,
    ...(scope.agentId ? { createdById: scope.agentId } : {}),
  };
}

/**
 * The lead ids and phone numbers that mark a lead as converted, over ALL time.
 *
 * All time, deliberately, whatever period the page is showing: a prospect who
 * submitted last month is not a prospect again this month.
 */
export async function getConvertedLeadKeys(
  scope: PipelineScope
): Promise<{ leadIds: string[]; phones: string[] }> {
  const prisma = getPrismaClient();
  const rows = await prisma.insuranceCarrierApplication.findMany({
    where: submittedApplicationWhere(scope),
    select: { insuranceLeadId: true, phone: true },
  });

  const leadIds = new Set<string>();
  const phones = new Set<string>();
  for (const row of rows) {
    if (row.insuranceLeadId) leadIds.add(row.insuranceLeadId);
    const phone = lastTenDigits(row.phone);
    if (phone) phones.add(phone);
  }
  return { leadIds: [...leadIds], phones: [...phones] };
}

/** A where clause matching leads that have NOT been converted. */
export function notConvertedWhere(keys: {
  leadIds: string[];
  phones: string[];
}): Prisma.InsuranceLeadWhereInput {
  const matches: Prisma.InsuranceLeadWhereInput[] = [];
  if (keys.leadIds.length > 0) matches.push({ id: { in: keys.leadIds } });
  if (keys.phones.length > 0) matches.push({ phone: { in: keys.phones } });
  return matches.length === 0 ? {} : { NOT: { OR: matches } };
}

/** The leads an agency (or an agent) holds, before the pipeline split. */
function leadScopeWhere(scope: PipelineScope): Prisma.InsuranceLeadWhereInput {
  return {
    tenantId: scope.tenantId,
    ...(scope.agentId ? { assignedToId: scope.agentId } : {}),
    ...(scope.licensedStates !== undefined ? { state: { in: scope.licensedStates } } : {}),
  };
}

export interface PipelineSummary {
  /** Leads with no submitted application. */
  prospects: number;
  /** Prospects with a follow-up due today or already overdue, not marked lost. */
  followUpsDue: number;
  /** Submitted, non-voided applications in the range. */
  submittedApps: number;
  /** Their annualised premium, summed. */
  annualPremium: number;
  /** Null for an empty range: an average of nothing is not $0. */
  averageAnnualPremium: number | null;
}

export async function getPipelineSummary(
  scope: PipelineScope,
  range: PipelineRange = {},
  now: Date = new Date()
): Promise<PipelineSummary> {
  const prisma = getPrismaClient();
  const keys = await getConvertedLeadKeys(scope);

  // The same rows the Prospects list shows with no filter applied.
  const prospectWhere: Prisma.InsuranceLeadWhereInput = {
    AND: [leadScopeWhere(scope), notConvertedWhere(keys)],
  };

  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  const [prospects, followUpsDue, apps] = await Promise.all([
    prisma.insuranceLead.count({ where: prospectWhere }),
    prisma.insuranceLead.count({
      where: {
        AND: [
          prospectWhere,
          { nextFollowUpAt: { lte: endOfToday } },
          { OR: [{ leadStage: null }, { leadStage: { not: 'CLOSED_LOST' } }] },
        ],
      },
    }),
    prisma.insuranceCarrierApplication.aggregate({
      where: submittedApplicationWhere(scope, range),
      _count: { _all: true },
      _sum: { annualizedPremium: true },
    }),
  ]);

  const submittedApps = apps._count._all;
  const annualPremium = Number(Number(apps._sum.annualizedPremium ?? 0).toFixed(2));

  return {
    prospects,
    followUpsDue,
    submittedApps,
    annualPremium,
    averageAnnualPremium:
      submittedApps > 0 ? Number((annualPremium / submittedApps).toFixed(2)) : null,
  };
}

export interface SubmittedAppRow {
  id: string;
  submittedAt: string | null;
  applicant: string;
  phone: string | null;
  state: string | null;
  carrier: string;
  product: string;
  faceAmount: number | null;
  annualPremium: number | null;
  agentName: string | null;
  /** The CRM lead this application converted, when one could be tied to it. */
  leadId: string | null;
}

export async function getSubmittedApps(
  scope: PipelineScope,
  options: PipelineRange & { search?: string; page?: number; limit?: number } = {}
): Promise<{
  data: SubmittedAppRow[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}> {
  const prisma = getPrismaClient();
  const page = Math.max(options.page ?? 1, 1);
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 200);

  const where: Prisma.InsuranceCarrierApplicationWhereInput = submittedApplicationWhere(
    scope,
    options
  );

  const search = options.search?.trim();
  if (search) {
    const digits = search.replace(/\D/g, '');
    where.OR = [
      { firstName: { contains: search, mode: 'insensitive' } },
      { lastName: { contains: search, mode: 'insensitive' } },
      { carrier: { contains: search, mode: 'insensitive' } },
      { product: { contains: search, mode: 'insensitive' } },
      ...(digits.length > 0 ? [{ phone: { contains: digits.slice(-10) } }] : []),
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.insuranceCarrierApplication.findMany({
      where,
      orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        submittedAt: true,
        firstName: true,
        lastName: true,
        phone: true,
        state: true,
        carrier: true,
        product: true,
        faceAmount: true,
        annualizedPremium: true,
        createdById: true,
        insuranceLeadId: true,
      },
    }),
    prisma.insuranceCarrierApplication.count({ where }),
  ]);

  // Tie each application to its CRM lead: the stored link first, then phone.
  const unlinkedPhones = [
    ...new Set(
      rows
        .filter(row => !row.insuranceLeadId)
        .map(row => lastTenDigits(row.phone))
        .filter((p): p is string => p !== null)
    ),
  ];
  const leadsByPhone = unlinkedPhones.length
    ? await prisma.insuranceLead.findMany({
        where: { ...leadScopeWhere(scope), phone: { in: unlinkedPhones } },
        select: { id: true, phone: true },
        orderBy: { createdAt: 'desc' },
      })
    : [];
  const leadIdByPhone = new Map<string, string>();
  for (const lead of leadsByPhone) {
    if (!leadIdByPhone.has(lead.phone)) leadIdByPhone.set(lead.phone, lead.id);
  }

  const agentIds = [...new Set(rows.map(row => row.createdById).filter(Boolean))] as string[];
  const users = agentIds.length
    ? await prisma.user.findMany({
        where: { id: { in: agentIds }, tenantId: scope.tenantId },
        select: { id: true, email: true, firstName: true, lastName: true },
      })
    : [];
  const nameById = new Map(
    users.map(u => [u.id, [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || u.id])
  );

  return {
    data: rows.map(row => {
      const phone = lastTenDigits(row.phone);
      return {
        id: row.id,
        submittedAt: row.submittedAt?.toISOString() ?? null,
        applicant: [row.firstName, row.lastName].filter(Boolean).join(' ') || '—',
        phone,
        state: row.state,
        carrier: row.carrier,
        product: row.product,
        faceAmount: row.faceAmount,
        annualPremium:
          row.annualizedPremium === null ? null : Number(Number(row.annualizedPremium).toFixed(2)),
        agentName: row.createdById ? (nameById.get(row.createdById) ?? null) : null,
        leadId: row.insuranceLeadId ?? (phone ? (leadIdByPhone.get(phone) ?? null) : null),
      };
    }),
    meta: { page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) },
  };
}
