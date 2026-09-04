/**
 * Insurance Lead CRM — Reporting & CSV Export
 *
 * Two questions this module exists to answer, for any date range, at any time:
 *
 *   1. Which leads did Ameriquote accept when we sent them?
 *   2. Which ones did it not accept, and what reason did it give?
 *
 * The submission table already holds every fact needed for both — it records
 * the post status, the buyer's verbatim response, the lead id and price on an
 * acceptance, and the error message on a rejection. What it did not have was a
 * read that puts an outcome and a reason on every row, so the answer had to be
 * reconstructed by hand from raw statuses. That reconstruction lives here.
 *
 * Every report this module produces renders as JSON or as CSV from the same
 * rows, so an export can never disagree with what the screen shows.
 */

import type { Prisma } from '@prisma/client';

import { getPrismaClient } from '../lib/prisma.js';

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/**
 * RFC 4180 rendering. A cell is quoted only when it has to be, and an embedded
 * quote is doubled. Lead notes and buyer error strings carry commas, quotes and
 * newlines routinely, so this is not optional.
 */
export function toCsv(headers: string[], rows: Array<Array<unknown>>): string {
  const cell = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    const str = value instanceof Date ? value.toISOString() : String(value);
    if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
    return str;
  };

  const lines = [headers.map(cell).join(',')];
  for (const row of rows) lines.push(row.map(cell).join(','));
  // CRLF: Excel treats a bare LF file as a single column on some locales.
  return lines.join('\r\n');
}

/** Filename-safe slug for a Content-Disposition header. */
export function reportFilename(base: string, startDate?: string, endDate?: string): string {
  const day = (value?: string) => (value ? value.slice(0, 10) : '');
  const range = [day(startDate), day(endDate)].filter(Boolean).join('_to_');
  const stamp = range || new Date().toISOString().slice(0, 10);
  return `${base}_${stamp}.csv`.replace(/[^A-Za-z0-9._-]/g, '_');
}

// ---------------------------------------------------------------------------
// Delivery outcomes
// ---------------------------------------------------------------------------

/**
 * Three buckets, because "accepted" and "not accepted" do not cover a lead that
 * was never sent at all — and lumping the unsent in with the rejected is how a
 * held batch gets mistaken for a buyer problem.
 */
export type DeliveryOutcome = 'ACCEPTED' | 'NOT_ACCEPTED' | 'NOT_SENT';

export const DELIVERY_OUTCOME_LABELS: Record<DeliveryOutcome, string> = {
  ACCEPTED: 'Accepted',
  NOT_ACCEPTED: 'Not accepted',
  NOT_SENT: 'Not sent',
};

/**
 * MANUAL_REVIEW is an acceptance. Ameriquote has the lead and issued an id for
 * it; it is queued behind their own approval step. Counting it as a rejection
 * both understates what was sold and invites a re-send, which comes back as a
 * 90-day duplicate and burns the lead.
 */
const ACCEPTED_STATUSES = ['MATCHED', 'MANUAL_REVIEW'] as const;
const NOT_ACCEPTED_STATUSES = ['UNMATCHED', 'ERROR'] as const;
const NOT_SENT_STATUSES = ['PENDING', 'HOLD', 'SKIPPED'] as const;

export function outcomeForPostStatus(postStatus: string): DeliveryOutcome {
  if ((ACCEPTED_STATUSES as readonly string[]).includes(postStatus)) return 'ACCEPTED';
  if ((NOT_ACCEPTED_STATUSES as readonly string[]).includes(postStatus)) return 'NOT_ACCEPTED';
  return 'NOT_SENT';
}

interface ReasonSource {
  postStatus: string;
  validationStatus: string;
  ameriquoteResponseStatus: string | null;
  ameriquoteErrorMessage: string | null;
  ameriquoteLeadId: string | null;
  validationErrors: unknown;
  attemptCount: number;
}

function validationErrorSummary(errors: unknown): string {
  if (!Array.isArray(errors) || errors.length === 0) return '';
  return errors
    .map(entry => {
      if (!entry || typeof entry !== 'object') return String(entry);
      const { path, message } = entry as { path?: unknown; message?: unknown };
      const field = typeof path === 'string' && path ? `${path}: ` : '';
      return `${field}${typeof message === 'string' ? message : JSON.stringify(entry)}`;
    })
    .join('; ');
}

/**
 * The reason column. Never blank — a row that says "not accepted" with an empty
 * reason is exactly the row this report was asked for, so every branch ends in
 * a sentence a human can act on.
 */
export function reasonForSubmission(submission: ReasonSource): string {
  const buyerMessage = submission.ameriquoteErrorMessage?.trim();

  switch (submission.postStatus) {
    case 'MATCHED':
      return submission.ameriquoteLeadId
        ? `Accepted — Ameriquote lead id ${submission.ameriquoteLeadId}`
        : 'Accepted — matched by Ameriquote';

    case 'MANUAL_REVIEW':
      return submission.ameriquoteLeadId
        ? `Accepted — held for Ameriquote's manual approval (lead id ${submission.ameriquoteLeadId})`
        : "Accepted — held for Ameriquote's manual approval";

    case 'UNMATCHED':
      return (
        buyerMessage || 'Unmatched — Ameriquote had no buyer whose filters this lead satisfied'
      );

    case 'ERROR':
      return buyerMessage || 'Rejected by Ameriquote with no reason in the response';

    case 'SKIPPED': {
      const details = validationErrorSummary(submission.validationErrors);
      return details
        ? `Never sent — failed validation (${details})`
        : 'Never sent — the lead failed validation';
    }

    case 'HOLD':
      return 'Never sent — held in the CRM awaiting a send';

    case 'PENDING':
      return submission.attemptCount > 0
        ? 'In flight — a post was started and no response has been recorded'
        : 'Never sent — queued for delivery';

    default:
      return buyerMessage || `No delivery reason recorded (status ${submission.postStatus})`;
  }
}

// ---------------------------------------------------------------------------
// Delivery report
// ---------------------------------------------------------------------------

export interface DeliveryReportFilters {
  startDate?: string;
  endDate?: string;
  vertical?: 'ACA' | 'FE' | 'B2B';
  listId?: string;
  postStatus?: string;
  postMode?: 'TEST' | 'LIVE';
  outcome?: DeliveryOutcome;
  search?: string;
  page?: number;
  limit?: number;
}

export interface DeliveryReportRow {
  submissionId: string;
  insuranceLeadId: string;
  leadName: string;
  phone: string;
  email: string | null;
  state: string | null;
  zipCode: string | null;
  vertical: string;
  listName: string | null;
  source: string | null;
  sentAt: string | null;
  receivedAt: string;
  lastAttemptAt: string | null;
  attemptCount: number;
  postMode: string;
  postStatus: string;
  validationStatus: string;
  outcome: DeliveryOutcome;
  outcomeLabel: string;
  ameriquoteStatus: string | null;
  ameriquoteLeadId: string | null;
  ameriquotePrice: string | null;
  reason: string;
}

export interface DeliveryReportSummary {
  totalSubmissions: number;
  accepted: number;
  notAccepted: number;
  notSent: number;
  matched: number;
  manualReview: number;
  unmatched: number;
  errored: number;
  /** Sum of the price Ameriquote paid on accepted leads, to 2dp. */
  acceptedRevenue: string;
  /** Accepted ÷ everything actually sent. Null when nothing was sent. */
  acceptanceRate: number | null;
}

export interface DeliveryReportReason {
  outcome: DeliveryOutcome;
  postStatus: string;
  reason: string;
  count: number;
  examples: Array<{ name: string; phone: string; submissionId: string }>;
}

export interface DeliveryReport {
  summary: DeliveryReportSummary;
  reasons: DeliveryReportReason[];
  rows: DeliveryReportRow[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

/** Hard ceiling on one page. An export asks for everything in the range. */
export const MAX_REPORT_ROWS = 50000;

/**
 * Timestamps arrive as `YYYY-MM-DD` from a date picker and as full ISO strings
 * from an API caller. A bare end date means "through the end of that day" —
 * without this, `endDate=2026-09-04` silently excludes everything sent that day.
 */
function parseRangeBoundary(value: string, edge: 'start' | 'end'): Date | null {
  const bareDay = /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
  const parsed = new Date(bareDay ? `${value.trim()}T00:00:00.000Z` : value);
  if (Number.isNaN(parsed.getTime())) return null;
  if (bareDay && edge === 'end') parsed.setUTCHours(23, 59, 59, 999);
  return parsed;
}

function buildWhere(
  tenantId: string,
  filters: DeliveryReportFilters
): Prisma.InsuranceLeadSubmissionWhereInput {
  const where: Prisma.InsuranceLeadSubmissionWhereInput = { tenantId };

  if (filters.vertical) where.vertical = filters.vertical;
  if (filters.postMode) where.postMode = filters.postMode;

  if (filters.postStatus) {
    where.postStatus = filters.postStatus as Prisma.InsuranceLeadSubmissionWhereInput['postStatus'];
  } else if (filters.outcome) {
    const statuses =
      filters.outcome === 'ACCEPTED'
        ? ACCEPTED_STATUSES
        : filters.outcome === 'NOT_ACCEPTED'
          ? NOT_ACCEPTED_STATUSES
          : NOT_SENT_STATUSES;
    where.postStatus = {
      in: [...statuses],
    } as Prisma.InsuranceLeadSubmissionWhereInput['postStatus'];
  }

  if (filters.startDate || filters.endDate) {
    const range: Prisma.DateTimeFilter = {};
    if (filters.startDate) {
      const start = parseRangeBoundary(filters.startDate, 'start');
      if (start) range.gte = start;
    }
    if (filters.endDate) {
      const end = parseRangeBoundary(filters.endDate, 'end');
      if (end) range.lte = end;
    }
    if (range.gte || range.lte) where.receivedAt = range;
  }

  const leadFilter: Prisma.InsuranceLeadWhereInput = {};
  if (filters.listId) leadFilter.listId = filters.listId;

  if (filters.search) {
    const s = filters.search.trim();
    const digits = s.replace(/\D/g, '');
    const orConditions: Prisma.InsuranceLeadWhereInput[] = [
      { firstName: { contains: s, mode: 'insensitive' } },
      { lastName: { contains: s, mode: 'insensitive' } },
      { fullName: { contains: s, mode: 'insensitive' } },
      { email: { contains: s, mode: 'insensitive' } },
      { zipCode: { contains: s } },
    ];
    if (digits.length > 0) {
      orConditions.push({ phone: { contains: digits.length > 10 ? digits.slice(-10) : digits } });
    }
    leadFilter.OR = orConditions;
  }

  if (Object.keys(leadFilter).length > 0) where.insuranceLead = leadFilter;

  return where;
}

const MAX_REASON_EXAMPLES = 5;

/**
 * Group the non-acceptances by the reason given, worst first. A run that
 * reports "412 not accepted" and nothing else cannot be acted on; this is the
 * part that says *why*, and how many leads each cause cost.
 */
function groupReasons(rows: DeliveryReportRow[]): DeliveryReportReason[] {
  const groups = new Map<string, DeliveryReportReason>();

  for (const row of rows) {
    if (row.outcome === 'ACCEPTED') continue;

    const key = `${row.postStatus}::${row.reason}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      if (existing.examples.length < MAX_REASON_EXAMPLES) {
        existing.examples.push({
          name: row.leadName,
          phone: row.phone,
          submissionId: row.submissionId,
        });
      }
      continue;
    }

    groups.set(key, {
      outcome: row.outcome,
      postStatus: row.postStatus,
      reason: row.reason,
      count: 1,
      examples: [{ name: row.leadName, phone: row.phone, submissionId: row.submissionId }],
    });
  }

  return [...groups.values()].sort((a, b) => b.count - a.count);
}

function displayName(lead: {
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
}): string {
  const composed = [lead.firstName, lead.lastName].filter(Boolean).join(' ').trim();
  return (lead.fullName || composed || '').trim() || 'Unnamed lead';
}

function toMoney(value: string | null): number {
  if (!value) return 0;
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * One row per delivery attempt, each carrying an outcome and a reason, plus the
 * counts and the grouped reasons over the whole filtered set.
 *
 * The summary counts the *whole* range, not just the page on screen, so an
 * export and the tiles above it always agree.
 */
export async function getDeliveryReport(
  tenantId: string,
  filters: DeliveryReportFilters = {}
): Promise<DeliveryReport> {
  const prisma = getPrismaClient();
  const where = buildWhere(tenantId, filters);

  const page = Math.max(1, filters.page || 1);
  const limit = Math.min(Math.max(1, filters.limit || 100), MAX_REPORT_ROWS);
  const skip = (page - 1) * limit;

  const [submissions, total, statusGroups, acceptedPrices] = await Promise.all([
    prisma.insuranceLeadSubmission.findMany({
      where,
      orderBy: [{ receivedAt: 'desc' }],
      take: limit,
      skip,
      select: {
        id: true,
        insuranceLeadId: true,
        vertical: true,
        source: true,
        receivedAt: true,
        postedAt: true,
        lastAttemptAt: true,
        attemptCount: true,
        postMode: true,
        postStatus: true,
        validationStatus: true,
        validationErrors: true,
        ameriquoteResponseStatus: true,
        ameriquoteLeadId: true,
        ameriquotePrice: true,
        ameriquoteErrorMessage: true,
        insuranceLead: {
          select: {
            firstName: true,
            lastName: true,
            fullName: true,
            phone: true,
            email: true,
            state: true,
            zipCode: true,
            list: { select: { name: true } },
          },
        },
      },
    }),
    prisma.insuranceLeadSubmission.count({ where }),
    prisma.insuranceLeadSubmission.groupBy({
      by: ['postStatus'],
      where,
      _count: { _all: true },
    }),
    prisma.insuranceLeadSubmission.findMany({
      where: { ...where, postStatus: { in: [...ACCEPTED_STATUSES] } },
      select: { ameriquotePrice: true },
    }),
  ]);

  const countFor = (status: string): number =>
    statusGroups.find(group => group.postStatus === status)?._count._all ?? 0;

  const matched = countFor('MATCHED');
  const manualReview = countFor('MANUAL_REVIEW');
  const unmatched = countFor('UNMATCHED');
  const errored = countFor('ERROR');
  const accepted = matched + manualReview;
  const notAccepted = unmatched + errored;
  const notSent = NOT_SENT_STATUSES.reduce((sum, status) => sum + countFor(status), 0);
  const sent = accepted + notAccepted;

  const rows: DeliveryReportRow[] = submissions.map(submission => {
    const lead = submission.insuranceLead;
    const outcome = outcomeForPostStatus(submission.postStatus);

    return {
      submissionId: submission.id,
      insuranceLeadId: submission.insuranceLeadId,
      leadName: displayName(lead),
      phone: lead.phone,
      email: lead.email,
      state: lead.state,
      zipCode: lead.zipCode,
      vertical: submission.vertical,
      listName: lead.list?.name ?? null,
      source: submission.source,
      sentAt: submission.postedAt ? submission.postedAt.toISOString() : null,
      receivedAt: submission.receivedAt.toISOString(),
      lastAttemptAt: submission.lastAttemptAt ? submission.lastAttemptAt.toISOString() : null,
      attemptCount: submission.attemptCount,
      postMode: submission.postMode,
      postStatus: submission.postStatus,
      validationStatus: submission.validationStatus,
      outcome,
      outcomeLabel: DELIVERY_OUTCOME_LABELS[outcome],
      ameriquoteStatus: submission.ameriquoteResponseStatus,
      ameriquoteLeadId: submission.ameriquoteLeadId,
      ameriquotePrice: submission.ameriquotePrice,
      reason: reasonForSubmission({
        postStatus: submission.postStatus,
        validationStatus: submission.validationStatus,
        ameriquoteResponseStatus: submission.ameriquoteResponseStatus,
        ameriquoteErrorMessage: submission.ameriquoteErrorMessage,
        ameriquoteLeadId: submission.ameriquoteLeadId,
        validationErrors: submission.validationErrors,
        attemptCount: submission.attemptCount,
      }),
    };
  });

  return {
    summary: {
      totalSubmissions: total,
      accepted,
      notAccepted,
      notSent,
      matched,
      manualReview,
      unmatched,
      errored,
      acceptedRevenue: acceptedPrices
        .reduce((sum, row) => sum + toMoney(row.ameriquotePrice), 0)
        .toFixed(2),
      acceptanceRate: sent > 0 ? accepted / sent : null,
    },
    reasons: groupReasons(rows),
    rows,
    meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

export const DELIVERY_REPORT_CSV_HEADERS = [
  'Outcome',
  'Reason',
  'Lead Name',
  'Phone',
  'Email',
  'State',
  'Zip',
  'Vertical',
  'Lead List',
  'Source',
  'Sent At (UTC)',
  'Received At (UTC)',
  'Last Attempt (UTC)',
  'Attempts',
  'Mode',
  'Post Status',
  'Validation',
  'Ameriquote Status',
  'Ameriquote Lead ID',
  'Price ($)',
  'Submission ID',
  'Lead ID',
];

export function deliveryReportToCsv(rows: DeliveryReportRow[]): string {
  return toCsv(
    DELIVERY_REPORT_CSV_HEADERS,
    rows.map(row => [
      row.outcomeLabel,
      row.reason,
      row.leadName,
      row.phone,
      row.email,
      row.state,
      row.zipCode,
      row.vertical,
      row.listName,
      row.source,
      row.sentAt,
      row.receivedAt,
      row.lastAttemptAt,
      row.attemptCount,
      row.postMode,
      row.postStatus,
      row.validationStatus,
      row.ameriquoteStatus,
      row.ameriquoteLeadId,
      row.ameriquotePrice,
      row.submissionId,
      row.insuranceLeadId,
    ])
  );
}

// ---------------------------------------------------------------------------
// CRM lead list export
// ---------------------------------------------------------------------------

export interface LeadCsvRow {
  id: string;
  vertical: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  phone: string;
  email: string | null;
  state: string | null;
  zipCode: string | null;
  source: string | null;
  status: string;
  leadStage: string | null;
  nextFollowUpAt: string | null;
  createdAt: string;
  latestSubmission: {
    id: string;
    receivedAt: string;
    validationStatus: string;
    postStatus: string;
    postMode: string;
    ameriquoteResponseStatus: string | null;
    source: string | null;
  } | null;
}

export const LEADS_CSV_HEADERS = [
  'Lead ID',
  'First Name',
  'Last Name',
  'Full Name',
  'Phone',
  'Email',
  'State',
  'Zip',
  'Vertical',
  'Source',
  'CRM Status',
  'Stage',
  'Next Follow-Up (UTC)',
  'Created At (UTC)',
  'Last Delivery Outcome',
  'Last Post Status',
  'Last Ameriquote Status',
  'Last Post Mode',
  'Last Submitted At (UTC)',
];

/**
 * The CRM grid, exported exactly as filtered. Rows come straight from the same
 * `getLeads` shape the table renders, so the file cannot drift from the screen.
 */
export function leadsToCsv(leads: LeadCsvRow[]): string {
  return toCsv(
    LEADS_CSV_HEADERS,
    leads.map(lead => {
      const submission = lead.latestSubmission;
      return [
        lead.id,
        lead.firstName,
        lead.lastName,
        lead.fullName,
        lead.phone,
        lead.email,
        lead.state,
        lead.zipCode,
        lead.vertical,
        lead.source,
        lead.status,
        lead.leadStage,
        lead.nextFollowUpAt,
        lead.createdAt,
        submission
          ? DELIVERY_OUTCOME_LABELS[outcomeForPostStatus(submission.postStatus)]
          : 'Not sent',
        submission?.postStatus ?? '',
        submission?.ameriquoteResponseStatus ?? '',
        submission?.postMode ?? '',
        submission?.receivedAt ?? '',
      ];
    })
  );
}
