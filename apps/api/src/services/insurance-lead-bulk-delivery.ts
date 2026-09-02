/**
 * Insurance Lead Pipeline — Bulk Delivery
 *
 * `ingestLead` deliberately parks every valid submission on HOLD: nothing is
 * ever posted to the buyer as a side effect of an import. That is the right
 * default, but it left no way to release a thousand imported leads short of
 * clicking retry a thousand times.
 *
 * This module is that missing explicit action. It never runs on ingest — a
 * caller has to ask for it — and it refuses to post a lead the buyer would
 * reject unless the caller overrides on purpose.
 */

import type { Prisma } from '@prisma/client';

import { createServiceLogger } from '../lib/logger.js';
import { getPrismaClient } from '../lib/prisma.js';

import { deliverInsuranceLeadSubmission } from './insurance-lead-delivery.js';
import { checkDeliveryReadiness, type ReadinessIssue } from './insurance-lead-readiness.js';

const log = createServiceLogger('insurance-lead-bulk-delivery');

/**
 * Post statuses that are still worth sending.
 *
 * MATCHED and MANUAL_REVIEW are both excluded because the buyer already has
 * the lead: the first is sold, the second is accepted and holding for their
 * review. Posting either a second time comes back as a 90-day duplicate and
 * burns the lead permanently. SKIPPED belongs to submissions that failed
 * validation and have no normalized payload to map.
 */
const SENDABLE_POST_STATUSES = ['HOLD', 'PENDING', 'ERROR', 'UNMATCHED'] as const;

/** Ceiling on one request's work, so a bulk send stays inside an HTTP timeout. */
export const MAX_BATCH_SIZE = 250;
const DEFAULT_BATCH_SIZE = 100;

function getConcurrency(): number {
  const raw = parseInt(process.env.INSURANCE_LEAD_DELIVERY_CONCURRENCY || '', 10);
  if (!isNaN(raw) && raw >= 1 && raw <= 20) return raw;
  return 4;
}

export interface BulkDeliverySelector {
  /** Restrict to one imported list — the normal way to send a CSV batch. */
  listId?: string;
  vertical?: 'ACA' | 'FE' | 'B2B';
  /** Explicit submissions, for re-sending a hand-picked set. */
  submissionIds?: string[];
}

export interface BulkDeliveryOptions extends BulkDeliverySelector {
  limit?: number;
  /**
   * Post leads the readiness check flagged as missing buyer-required fields.
   * Off by default: those posts are rejections that still burn a ping.
   */
  force?: boolean;
  /**
   * Submission id the previous batch ended on. Paging by cursor rather than by
   * status keeps leads that were held back as NOT_READY from being re-selected
   * forever — they keep their HOLD status, so an offset-free query would hand
   * back the same unsendable rows on every call.
   */
  cursor?: string;
}

export interface BulkDeliveryLeadResult {
  insuranceLeadId: string;
  submissionId: string;
  phone: string;
  name: string;
  outcome: 'MATCHED' | 'UNMATCHED' | 'MANUAL_REVIEW' | 'ERROR' | 'NOT_READY';
  ameriquoteLeadId?: string;
  ameriquotePrice?: string;
  /** What the buyer said, verbatim where we have it. */
  message?: string;
  /** Matched / Unmatched / Error / Unknown, as the gateway reported it. */
  ameriquoteStatus?: string;
  blockers?: ReadinessIssue[];
}

/** One distinct failure reason and how many leads in the batch hit it. */
export interface BulkDeliveryFailureReason {
  outcome: 'UNMATCHED' | 'ERROR' | 'NOT_READY';
  message: string;
  count: number;
  /** A few leads carrying this reason, so it can be chased down by phone. */
  examples: Array<{ name: string; phone: string; submissionId: string }>;
}

export interface BulkDeliveryResult {
  attempted: number;
  matched: number;
  unmatched: number;
  /** Accepted by the buyer, holding for their manual approval. Not a failure. */
  manualReview: number;
  errored: number;
  notReady: number;
  /** Sendable submissions still queued after this batch's cursor. */
  remaining: number;
  /** Pass back as `cursor` to send the next batch; null when the run is done. */
  nextCursor: string | null;
  /**
   * Every non-delivery in this batch, grouped by what the buyer actually said,
   * worst first. The counts alone never explained a failed run — this is the
   * part a human reads.
   */
  failureReasons: BulkDeliveryFailureReason[];
  results: BulkDeliveryLeadResult[];
}

export interface PreflightBucket {
  count: number;
  /** Issue message → number of leads carrying it, worst first. */
  reasons: Array<{ message: string; field: string; count: number }>;
}

export interface PreflightResult {
  /** Every submission the selector matches that is not already MATCHED. */
  sendable: number;
  ready: number;
  blocked: PreflightBucket;
  warnings: PreflightBucket;
  alreadyMatched: number;
  /** Submissions excluded because they never passed validation. */
  invalid: number;
  mode: 'TEST' | 'LIVE';
  /**
   * Set when nothing can be delivered regardless of the leads themselves —
   * today, a missing API key. Callers must refuse to send while this is set.
   */
  configError?: string;
}

interface SubmissionRow {
  id: string;
  insuranceLeadId: string;
  vertical: string;
  postStatus: string;
  normalizedPayload: unknown;
  insuranceLead: { phone: string; firstName: string | null; lastName: string | null };
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

function buildWhere(
  tenantId: string,
  selector: BulkDeliverySelector
): Prisma.InsuranceLeadSubmissionWhereInput {
  const where: Prisma.InsuranceLeadSubmissionWhereInput = { tenantId };

  if (selector.submissionIds?.length) {
    where.id = { in: selector.submissionIds };
  }
  if (selector.vertical) {
    where.vertical = selector.vertical;
  }
  if (selector.listId) {
    where.insuranceLead = { listId: selector.listId };
  }

  return where;
}

const SUBMISSION_SELECT = {
  id: true,
  insuranceLeadId: true,
  vertical: true,
  postStatus: true,
  normalizedPayload: true,
  insuranceLead: { select: { phone: true, firstName: true, lastName: true } },
} as const;

function leadName(row: SubmissionRow): string {
  return `${row.insuranceLead.firstName || ''} ${row.insuranceLead.lastName || ''}`.trim();
}

function readinessFor(row: SubmissionRow) {
  const normalized = (row.normalizedPayload as Record<string, unknown> | null) || {};
  return checkDeliveryReadiness(row.vertical as 'ACA' | 'FE' | 'B2B', normalized);
}

// ---------------------------------------------------------------------------
// Preflight — what would happen if we sent this batch
// ---------------------------------------------------------------------------

function tallyIssues(issues: ReadinessIssue[][]): PreflightBucket['reasons'] {
  const counts = new Map<string, { message: string; field: string; count: number }>();

  for (const perLead of issues) {
    // Count each distinct reason once per lead, not once per occurrence.
    const seen = new Set<string>();
    for (const issue of perLead) {
      const key = `${issue.field}::${issue.outboundField}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const existing = counts.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        counts.set(key, { message: issue.message, field: issue.field, count: 1 });
      }
    }
  }

  return [...counts.values()].sort((a, b) => b.count - a.count);
}

export async function preflightBulkDelivery(
  tenantId: string,
  selector: BulkDeliverySelector
): Promise<PreflightResult> {
  const prisma = getPrismaClient();
  const { getInsuranceLeadMode, getAmeriquoteConfigProblem } = await import(
    './insurance-lead-config.js'
  );

  const where = buildWhere(tenantId, selector);

  const [rows, alreadyMatched, invalid] = await Promise.all([
    prisma.insuranceLeadSubmission.findMany({
      where: {
        ...where,
        validationStatus: 'VALID',
        postStatus: { in: [...SENDABLE_POST_STATUSES] },
      },
      select: SUBMISSION_SELECT,
    }) as unknown as Promise<SubmissionRow[]>,
    prisma.insuranceLeadSubmission.count({
      where: { ...where, postStatus: { in: ['MATCHED', 'MANUAL_REVIEW'] } },
    }),
    prisma.insuranceLeadSubmission.count({
      where: { ...where, validationStatus: { not: 'VALID' } },
    }),
  ]);

  const blockedIssues: ReadinessIssue[][] = [];
  const warningIssues: ReadinessIssue[][] = [];
  let ready = 0;

  for (const row of rows) {
    const report = readinessFor(row);
    if (report.ready) ready += 1;
    else blockedIssues.push(report.blockers);
    if (report.warnings.length) warningIssues.push(report.warnings);
  }

  return {
    configError: getAmeriquoteConfigProblem() ?? undefined,
    sendable: rows.length,
    ready,
    blocked: { count: blockedIssues.length, reasons: tallyIssues(blockedIssues) },
    warnings: { count: warningIssues.length, reasons: tallyIssues(warningIssues) },
    alreadyMatched,
    invalid,
    mode: getInsuranceLeadMode(),
  };
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

/** Run `worker` over `items` with at most `concurrency` in flight. */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  });

  await Promise.all(runners);
  return results;
}

export async function bulkDeliverInsuranceLeads(
  tenantId: string,
  options: BulkDeliveryOptions = {}
): Promise<BulkDeliveryResult> {
  const prisma = getPrismaClient();

  // Checked before a single row is read. Posting under a broken config cannot
  // succeed for any lead, and every attempt still increments attemptCount and
  // rewrites postStatus — so the run stops here rather than marking the batch
  // ERROR one lead at a time.
  const { getAmeriquoteConfigProblem } = await import('./insurance-lead-config.js');
  const configError = getAmeriquoteConfigProblem();
  if (configError) {
    log.error({ msg: 'Bulk insurance lead delivery refused', tenantId, configError });
    return {
      attempted: 0,
      matched: 0,
      unmatched: 0,
      manualReview: 0,
      errored: 0,
      notReady: 0,
      remaining: 0,
      nextCursor: null,
      failureReasons: [{ outcome: 'ERROR', message: configError, count: 0, examples: [] }],
      results: [],
    };
  }

  const where = buildWhere(tenantId, options);

  const requested = options.limit ?? DEFAULT_BATCH_SIZE;
  const batchSize = Math.max(1, Math.min(requested, MAX_BATCH_SIZE));

  const sendableWhere: Prisma.InsuranceLeadSubmissionWhereInput = {
    ...where,
    validationStatus: 'VALID',
    postStatus: { in: [...SENDABLE_POST_STATUSES] },
  };

  // Ordered by id so the cursor is stable: ids are uuids, so `id > cursor`
  // selects exactly the rows that sort after it.
  //
  // The cursor is AND-ed rather than spread in. `{ ...sendableWhere, id: {...} }`
  // *replaces* the `id: { in: submissionIds }` that buildWhere put there, so
  // the first batch was scoped to the caller's submissions and every batch
  // after it silently had no scope at all — a send of 241 walked the whole
  // tenant and posted 12,000 leads. A post is spent whether or not the lead
  // sells, so that is not a paging bug, it is a lead-destroying one.
  const pagedWhere: Prisma.InsuranceLeadSubmissionWhereInput = options.cursor
    ? { AND: [sendableWhere, { id: { gt: options.cursor } }] }
    : sendableWhere;

  const rows = (await prisma.insuranceLeadSubmission.findMany({
    where: pagedWhere,
    select: SUBMISSION_SELECT,
    orderBy: { id: 'asc' },
    take: batchSize,
  })) as unknown as SubmissionRow[];

  log.info({
    msg: 'Bulk insurance lead delivery starting',
    tenantId,
    listId: options.listId,
    batchSize: rows.length,
    force: Boolean(options.force),
  });

  const results = await mapWithConcurrency(
    rows,
    getConcurrency(),
    async (row): Promise<BulkDeliveryLeadResult> => {
      const base = {
        insuranceLeadId: row.insuranceLeadId,
        submissionId: row.id,
        phone: row.insuranceLead.phone,
        name: leadName(row),
      };

      const report = readinessFor(row);
      if (!report.ready && !options.force) {
        return {
          ...base,
          outcome: 'NOT_READY',
          message: 'Missing fields the buyer requires — fix the data or re-send with force',
          blockers: report.blockers,
        };
      }

      const delivery = await deliverInsuranceLeadSubmission(tenantId, row.insuranceLeadId, row.id, {
        trigger: 'RETRY',
      });

      if ('error' in delivery) {
        return { ...base, outcome: 'ERROR', message: delivery.error };
      }

      return {
        ...base,
        outcome: delivery.postStatus,
        ameriquoteLeadId: delivery.ameriquoteLeadId,
        ameriquotePrice: delivery.ameriquotePrice,
        message: delivery.errorMessage,
        ameriquoteStatus: delivery.ameriquoteStatus,
      };
    }
  );

  const nextCursor = rows.length === batchSize ? rows[rows.length - 1].id : null;

  // Counted past the cursor so a caller looping on `remaining` converges even
  // when every lead in the batch was held back as NOT_READY.
  // AND-ed for the same reason as pagedWhere above: spreading the cursor in
  // drops the caller's submission-id filter, and this count is what a looping
  // caller trusts to decide whether to ask for another batch. Overstated here,
  // it keeps the loop running long after the caller's own leads are exhausted.
  const remaining = nextCursor
    ? await prisma.insuranceLeadSubmission.count({
        where: { AND: [sendableWhere, { id: { gt: nextCursor } }] },
      })
    : 0;

  const summary: BulkDeliveryResult = {
    attempted: results.length,
    matched: results.filter(r => r.outcome === 'MATCHED').length,
    unmatched: results.filter(r => r.outcome === 'UNMATCHED').length,
    manualReview: results.filter(r => r.outcome === 'MANUAL_REVIEW').length,
    errored: results.filter(r => r.outcome === 'ERROR').length,
    notReady: results.filter(r => r.outcome === 'NOT_READY').length,
    remaining,
    nextCursor,
    failureReasons: groupFailureReasons(results),
    results,
  };

  log.info({
    msg: 'Bulk insurance lead delivery finished',
    tenantId,
    ...summaryCounts(summary),
    // Logged so a failing run can be diagnosed from the API logs alone,
    // without re-reading every submission row.
    failureReasons: summary.failureReasons.map(r => `${r.count}x ${r.outcome}: ${r.message}`),
  });

  return summary;
}

/**
 * Collapse per-lead failures into distinct reasons. Ids, phone numbers and
 * timestamps are masked so the same complaint about twenty different leads
 * groups as one line instead of twenty.
 */
function shapeReason(message: string): string {
  return message
    .replace(/\b\d{10,}\b/g, '<number>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>')
    .replace(/\b\d{4}-\d{2}-\d{2}[T ][\d:.]+/g, '<timestamp>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

const MAX_REASON_EXAMPLES = 5;

export function groupFailureReasons(
  results: BulkDeliveryLeadResult[]
): BulkDeliveryFailureReason[] {
  const groups = new Map<string, BulkDeliveryFailureReason>();

  for (const result of results) {
    if (result.outcome === 'MATCHED' || result.outcome === 'MANUAL_REVIEW') continue;

    // A NOT_READY lead never left the building; its blockers are the reason.
    const messages =
      result.outcome === 'NOT_READY' && result.blockers?.length
        ? result.blockers.map(blocker => blocker.message)
        : [result.message || `${result.outcome} with no reason recorded`];

    // One lead can be blocked on several fields; count it under each so the
    // list shows every field that needs fixing.
    for (const raw of new Set(messages)) {
      const message = shapeReason(raw);
      const key = `${result.outcome}::${message}`;
      const existing = groups.get(key);

      if (existing) {
        existing.count += 1;
        if (existing.examples.length < MAX_REASON_EXAMPLES) {
          existing.examples.push({
            name: result.name,
            phone: result.phone,
            submissionId: result.submissionId,
          });
        }
        continue;
      }

      groups.set(key, {
        outcome: result.outcome,
        message,
        count: 1,
        examples: [{ name: result.name, phone: result.phone, submissionId: result.submissionId }],
      });
    }
  }

  return [...groups.values()].sort((a, b) => b.count - a.count);
}

function summaryCounts(summary: BulkDeliveryResult) {
  const { attempted, matched, unmatched, manualReview, errored, notReady, remaining } = summary;
  return { attempted, matched, unmatched, manualReview, errored, notReady, remaining };
}
