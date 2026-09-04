/**
 * The question this report exists to answer is "which leads did Ameriquote
 * accept, and why did it refuse the rest" — so these cover the three ways that
 * answer used to come out wrong: an acceptance counted as a rejection, a
 * rejection exported with a blank reason, and a CSV that mangles the reason
 * text the moment it contains a comma or a quote.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockPrisma = {
  insuranceLeadSubmission: {
    findMany: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn(),
  },
};

vi.mock('../../lib/prisma.js', () => ({
  getPrismaClient: () => mockPrisma,
}));

import {
  deliveryReportToCsv,
  getDeliveryReport,
  leadsToCsv,
  outcomeForPostStatus,
  reasonForSubmission,
  reportFilename,
  toCsv,
} from '../insurance-lead-reports.js';

interface CapturedWhere {
  receivedAt?: { gte?: Date; lte?: Date };
  postStatus?: { in: string[] };
}

/** The `where` the report handed Prisma on its first read. */
function capturedWhere(): CapturedWhere {
  const call = mockPrisma.insuranceLeadSubmission.findMany.mock.calls[0] as unknown as [
    { where: CapturedWhere },
  ];
  return call[0].where;
}

function submissionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub-1',
    insuranceLeadId: 'lead-1',
    vertical: 'ACA',
    source: 'csv-import',
    receivedAt: new Date('2026-09-01T12:00:00.000Z'),
    postedAt: new Date('2026-09-01T12:00:05.000Z'),
    lastAttemptAt: new Date('2026-09-01T12:00:05.000Z'),
    attemptCount: 1,
    postMode: 'LIVE',
    postStatus: 'MATCHED',
    validationStatus: 'VALID',
    validationErrors: null,
    ameriquoteResponseStatus: 'Matched',
    ameriquoteLeadId: '987654',
    ameriquotePrice: '18.50',
    ameriquoteErrorMessage: null,
    insuranceLead: {
      firstName: 'Dana',
      lastName: 'Reyes',
      fullName: null,
      phone: '5551234567',
      email: 'dana@example.com',
      state: 'FL',
      zipCode: '33101',
      list: { name: 'September ACA' },
    },
    ...overrides,
  };
}

describe('classifying a delivery outcome', () => {
  it('counts a lead held for the buyer’s manual approval as accepted, not rejected', () => {
    // Ameriquote has the lead and issued an id for it. Filing it under
    // "not accepted" both understates the sale and invites a re-send, which
    // comes back as a 90-day duplicate.
    expect(outcomeForPostStatus('MANUAL_REVIEW')).toBe('ACCEPTED');
    expect(outcomeForPostStatus('MATCHED')).toBe('ACCEPTED');
  });

  it('separates a refusal from a lead that was never sent', () => {
    expect(outcomeForPostStatus('UNMATCHED')).toBe('NOT_ACCEPTED');
    expect(outcomeForPostStatus('ERROR')).toBe('NOT_ACCEPTED');
    expect(outcomeForPostStatus('HOLD')).toBe('NOT_SENT');
    expect(outcomeForPostStatus('SKIPPED')).toBe('NOT_SENT');
    expect(outcomeForPostStatus('PENDING')).toBe('NOT_SENT');
  });
});

describe('the reason column', () => {
  const base = {
    validationStatus: 'VALID',
    ameriquoteResponseStatus: null,
    ameriquoteErrorMessage: null,
    ameriquoteLeadId: null,
    validationErrors: null,
    attemptCount: 1,
  };

  it("quotes the buyer's own words on a rejection", () => {
    expect(
      reasonForSubmission({
        ...base,
        postStatus: 'ERROR',
        ameriquoteErrorMessage: 'Filter failure: Primary_Phone is on the DNC list',
      })
    ).toContain('DNC list');
  });

  it('still says why on an Unmatched that carried no message', () => {
    const reason = reasonForSubmission({ ...base, postStatus: 'UNMATCHED' });
    expect(reason).not.toBe('');
    expect(reason.toLowerCase()).toContain('unmatched');
  });

  it('reports the failed fields for a lead that never passed validation', () => {
    const reason = reasonForSubmission({
      ...base,
      postStatus: 'SKIPPED',
      validationStatus: 'INVALID',
      validationErrors: [
        { path: 'zipCode', message: 'Must be 5 digits' },
        { path: 'birthDate', message: 'Required' },
      ],
    });

    expect(reason).toContain('zipCode: Must be 5 digits');
    expect(reason).toContain('birthDate: Required');
  });

  it('names the Ameriquote lead id on an acceptance', () => {
    expect(
      reasonForSubmission({ ...base, postStatus: 'MATCHED', ameriquoteLeadId: '987654' })
    ).toContain('987654');
  });

  it('never returns a blank reason for any recorded status', () => {
    for (const postStatus of [
      'MATCHED',
      'MANUAL_REVIEW',
      'UNMATCHED',
      'ERROR',
      'SKIPPED',
      'HOLD',
      'PENDING',
    ]) {
      expect(reasonForSubmission({ ...base, postStatus }).trim()).not.toBe('');
    }
  });
});

describe('the delivery report', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('counts accepted, not accepted and not sent over the whole range, not the page', async () => {
    mockPrisma.insuranceLeadSubmission.findMany
      .mockResolvedValueOnce([
        submissionRow(),
        submissionRow({
          id: 'sub-2',
          postStatus: 'ERROR',
          ameriquoteResponseStatus: 'Error',
          ameriquoteLeadId: null,
          ameriquotePrice: null,
          ameriquoteErrorMessage: 'Filter failure: state not purchased',
        }),
      ])
      // The accepted-price read.
      .mockResolvedValueOnce([{ ameriquotePrice: '18.50' }, { ameriquotePrice: '12.00' }])
      // The reason-grouping read over the whole range.
      .mockResolvedValueOnce([]);
    mockPrisma.insuranceLeadSubmission.count.mockResolvedValue(2);
    mockPrisma.insuranceLeadSubmission.groupBy.mockResolvedValue([
      { postStatus: 'MATCHED', _count: { _all: 40 } },
      { postStatus: 'MANUAL_REVIEW', _count: { _all: 5 } },
      { postStatus: 'UNMATCHED', _count: { _all: 12 } },
      { postStatus: 'ERROR', _count: { _all: 3 } },
      { postStatus: 'HOLD', _count: { _all: 7 } },
    ]);

    const report = await getDeliveryReport('tenant-1', { limit: 2 });

    expect(report.summary.accepted).toBe(45);
    expect(report.summary.notAccepted).toBe(15);
    expect(report.summary.notSent).toBe(7);
    expect(report.summary.acceptedRevenue).toBe('30.50');
    // 45 accepted out of the 60 actually sent — the 7 held leads are not
    // failures and must not drag the rate down.
    expect(report.summary.acceptanceRate).toBeCloseTo(45 / 60);
  });

  it('gives every row an outcome and a reason', async () => {
    mockPrisma.insuranceLeadSubmission.findMany
      .mockResolvedValueOnce([
        submissionRow({
          id: 'sub-3',
          postStatus: 'UNMATCHED',
          ameriquoteResponseStatus: 'Unmatched',
          ameriquoteLeadId: null,
          ameriquotePrice: null,
        }),
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    mockPrisma.insuranceLeadSubmission.count.mockResolvedValue(1);
    mockPrisma.insuranceLeadSubmission.groupBy.mockResolvedValue([
      { postStatus: 'UNMATCHED', _count: { _all: 1 } },
    ]);

    const report = await getDeliveryReport('tenant-1', {});

    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].outcome).toBe('NOT_ACCEPTED');
    expect(report.rows[0].outcomeLabel).toBe('Not accepted');
    expect(report.rows[0].leadName).toBe('Dana Reyes');
    expect(report.rows[0].listName).toBe('September ACA');
    expect(report.rows[0].reason).toBeTruthy();
  });

  it('groups the refusals by reason over the whole range, not just the page', async () => {
    // A page-scoped breakdown put a "105 not accepted" tile above a list of
    // reasons summing to 59 — two numbers on one screen that cannot both be
    // right. The page here holds one row; the range holds four.
    mockPrisma.insuranceLeadSubmission.findMany
      .mockResolvedValueOnce([submissionRow({ id: 'a', postStatus: 'ERROR' })])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        submissionRow({ id: 'a', postStatus: 'ERROR', ameriquoteErrorMessage: 'On the DNC list' }),
        submissionRow({ id: 'b', postStatus: 'ERROR', ameriquoteErrorMessage: 'On the DNC list' }),
        submissionRow({ id: 'c', postStatus: 'ERROR', ameriquoteErrorMessage: 'Duplicate lead' }),
        submissionRow({ id: 'd', postStatus: 'MATCHED' }),
      ]);
    mockPrisma.insuranceLeadSubmission.count.mockResolvedValue(4);
    mockPrisma.insuranceLeadSubmission.groupBy.mockResolvedValue([]);

    const report = await getDeliveryReport('tenant-1', { limit: 1 });

    expect(report.rows).toHaveLength(1);
    expect(report.reasons[0].reason).toBe('On the DNC list');
    expect(report.reasons[0].count).toBe(2);
    // An acceptance is never a "reason not accepted".
    expect(report.reasons.map(r => r.reason)).not.toContain('Accepted — Ameriquote lead id 987654');
    // Three refusals in the range; only one of them is on the page.
    expect(report.reasons.reduce((sum, r) => sum + r.count, 0)).toBe(3);
  });

  it('does not report accepted revenue when narrowed to the refusals', async () => {
    // `{ ...where, postStatus }` REPLACES the outcome filter's postStatus
    // instead of narrowing it, so "Accepted 0" sat beside a four-figure
    // accepted value. The accepted-price read has to be ANDed.
    mockPrisma.insuranceLeadSubmission.findMany.mockResolvedValue([]);
    mockPrisma.insuranceLeadSubmission.count.mockResolvedValue(0);
    mockPrisma.insuranceLeadSubmission.groupBy.mockResolvedValue([]);

    const report = await getDeliveryReport('tenant-1', { outcome: 'NOT_ACCEPTED' });

    const priceRead = mockPrisma.insuranceLeadSubmission.findMany.mock.calls[1] as unknown as [
      { where: { AND: Array<{ postStatus?: unknown }> } },
    ];
    const clauses = priceRead[0].where.AND;
    // Both survive: the caller's refusal filter AND the accepted-only filter.
    // Together they match nothing, which is the correct $0.00.
    expect(clauses).toHaveLength(2);
    expect(clauses[0].postStatus).toEqual({ in: ['UNMATCHED', 'ERROR'] });
    expect(clauses[1].postStatus).toEqual({ in: ['MATCHED', 'MANUAL_REVIEW'] });
    expect(report.summary.acceptedRevenue).toBe('0.00');
  });

  it('reads a bare end date as the end of that day', async () => {
    mockPrisma.insuranceLeadSubmission.findMany.mockResolvedValue([]);
    mockPrisma.insuranceLeadSubmission.count.mockResolvedValue(0);
    mockPrisma.insuranceLeadSubmission.groupBy.mockResolvedValue([]);

    await getDeliveryReport('tenant-1', { startDate: '2026-09-01', endDate: '2026-09-04' });

    const where = capturedWhere();
    expect(where.receivedAt?.gte?.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    // Without this, everything sent on the 4th falls outside the report.
    expect(where.receivedAt?.lte?.toISOString()).toBe('2026-09-04T23:59:59.999Z');
  });

  it('narrows to the refusals when asked for one outcome', async () => {
    mockPrisma.insuranceLeadSubmission.findMany.mockResolvedValue([]);
    mockPrisma.insuranceLeadSubmission.count.mockResolvedValue(0);
    mockPrisma.insuranceLeadSubmission.groupBy.mockResolvedValue([]);

    await getDeliveryReport('tenant-1', { outcome: 'NOT_ACCEPTED' });

    expect(capturedWhere().postStatus).toEqual({ in: ['UNMATCHED', 'ERROR'] });
  });
});

describe('CSV rendering', () => {
  it('survives a reason containing commas, quotes and newlines', () => {
    const csv = toCsv(
      ['Reason'],
      [['Filter failure: "Primary_Phone" is on the DNC list, per buyer\nrule 4']]
    );

    expect(csv).toBe(
      'Reason\r\n"Filter failure: ""Primary_Phone"" is on the DNC list, per buyer\nrule 4"'
    );
  });

  it('leads a delivery export with the outcome and the reason', () => {
    const csv = deliveryReportToCsv([
      {
        submissionId: 'sub-1',
        insuranceLeadId: 'lead-1',
        leadName: 'Dana Reyes',
        phone: '5551234567',
        email: 'dana@example.com',
        state: 'FL',
        zipCode: '33101',
        vertical: 'ACA',
        listName: 'September ACA',
        source: 'csv-import',
        sentAt: '2026-09-01T12:00:05.000Z',
        receivedAt: '2026-09-01T12:00:00.000Z',
        lastAttemptAt: '2026-09-01T12:00:05.000Z',
        attemptCount: 1,
        postMode: 'LIVE',
        postStatus: 'UNMATCHED',
        validationStatus: 'VALID',
        outcome: 'NOT_ACCEPTED',
        outcomeLabel: 'Not accepted',
        ameriquoteStatus: 'Unmatched',
        ameriquoteLeadId: null,
        ameriquotePrice: null,
        reason: 'Unmatched — no buyer filter matched',
      },
    ]);

    const [header, row] = csv.split('\r\n');
    expect(header.startsWith('Outcome,Reason,')).toBe(true);
    expect(row.startsWith('Not accepted,Unmatched — no buyer filter matched,Dana Reyes,')).toBe(
      true
    );
  });

  it('carries the last delivery outcome onto a CRM lead export', () => {
    const csv = leadsToCsv([
      {
        id: 'lead-1',
        vertical: 'FE',
        firstName: 'Dana',
        lastName: 'Reyes',
        fullName: null,
        phone: '5551234567',
        email: null,
        state: 'FL',
        zipCode: '33101',
        source: null,
        status: 'NEW',
        leadStage: null,
        nextFollowUpAt: null,
        createdAt: '2026-09-01T12:00:00.000Z',
        latestSubmission: {
          id: 'sub-1',
          receivedAt: '2026-09-01T12:00:00.000Z',
          validationStatus: 'VALID',
          postStatus: 'MANUAL_REVIEW',
          postMode: 'LIVE',
          ameriquoteResponseStatus: 'ManualReview',
          source: null,
        },
      },
      {
        id: 'lead-2',
        vertical: 'ACA',
        firstName: null,
        lastName: null,
        fullName: 'Never Sent',
        phone: '5559876543',
        email: null,
        state: null,
        zipCode: null,
        source: null,
        status: 'NEW',
        leadStage: null,
        nextFollowUpAt: null,
        createdAt: '2026-09-02T12:00:00.000Z',
        latestSubmission: null,
      },
    ]);

    const rows = csv.split('\r\n');
    expect(rows[1]).toContain('Accepted');
    expect(rows[2]).toContain('Not sent');
  });
});

describe('the export filename', () => {
  it('carries the range it covers and stays filesystem-safe', () => {
    expect(reportFilename('ameriquote_delivery_report', '2026-09-01', '2026-09-04')).toBe(
      'ameriquote_delivery_report_2026-09-01_to_2026-09-04.csv'
    );
  });
});
