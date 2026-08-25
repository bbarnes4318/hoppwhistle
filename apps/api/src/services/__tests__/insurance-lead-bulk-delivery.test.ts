/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
// Same allowance the sibling delivery suite makes: vitest types mock call
// records as `any`, so asserting on them trips the unsafe-any rules.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPrisma, mockDeliver } = vi.hoisted(() => ({
  mockPrisma: {
    insuranceLeadSubmission: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
  mockDeliver: vi.fn(),
}));

vi.mock('../../lib/prisma.js', () => ({
  getPrismaClient: () => mockPrisma,
}));

vi.mock('../../lib/logger.js', () => ({
  createServiceLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('../insurance-lead-config.js', () => ({
  getInsuranceLeadMode: () => 'TEST',
}));

vi.mock('../insurance-lead-delivery.js', () => ({
  deliverInsuranceLeadSubmission: mockDeliver,
}));

import {
  bulkDeliverInsuranceLeads,
  preflightBulkDelivery,
} from '../insurance-lead-bulk-delivery.js';

/** Normalized payload that clears every FE post requirement. */
const READY_PAYLOAD = {
  firstName: 'Jane',
  lastName: 'Doe',
  phone: '3125556085',
  email: 'jane.doe@example.com',
  address: '123 Main St',
  city: 'Chicago',
  state: 'IL',
  zipCode: '60610',
  birthDate: '09/16/1980',
  age: 45,
  gender: 'Female',
  ipAddress: '75.2.92.149',
  trustedFormUrl: 'https://cert.trustedform.com/abc',
  datePosted: '7/14/2026 09:12:00',
};

function submission(id: string, payload: Record<string, unknown> = READY_PAYLOAD) {
  return {
    id,
    insuranceLeadId: `lead-${id}`,
    vertical: 'FE',
    postStatus: 'HOLD',
    normalizedPayload: payload,
    insuranceLead: { phone: '3125556085', firstName: 'Jane', lastName: 'Doe' },
  };
}

describe('bulkDeliverInsuranceLeads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.insuranceLeadSubmission.count.mockResolvedValue(0);
    mockDeliver.mockResolvedValue({
      success: true,
      postStatus: 'MATCHED',
      postMode: 'TEST',
      ameriquoteStatus: 'Matched',
      ameriquoteLeadId: '9001',
      ameriquotePrice: '12.50',
    });
  });

  it('delivers every ready submission and totals the outcomes', async () => {
    mockPrisma.insuranceLeadSubmission.findMany.mockResolvedValue([
      submission('a'),
      submission('b'),
    ]);

    const result = await bulkDeliverInsuranceLeads('tenant-1', { listId: 'list-1', limit: 10 });

    expect(mockDeliver).toHaveBeenCalledTimes(2);
    expect(result.attempted).toBe(2);
    expect(result.matched).toBe(2);
    expect(result.notReady).toBe(0);
    expect(result.results[0].ameriquoteLeadId).toBe('9001');
  });

  it('holds back a lead the buyer would reject instead of burning a post on it', async () => {
    const missingGender = { ...READY_PAYLOAD, gender: undefined };
    mockPrisma.insuranceLeadSubmission.findMany.mockResolvedValue([
      submission('a'),
      submission('b', missingGender),
    ]);

    const result = await bulkDeliverInsuranceLeads('tenant-1', { listId: 'list-1', limit: 10 });

    expect(mockDeliver).toHaveBeenCalledTimes(1);
    expect(result.notReady).toBe(1);

    const held = result.results.find(r => r.outcome === 'NOT_READY');
    expect(held?.blockers?.map(b => b.outboundField)).toEqual(['Gender']);
  });

  it('posts an unready lead when the caller forces it', async () => {
    mockPrisma.insuranceLeadSubmission.findMany.mockResolvedValue([
      submission('a', { ...READY_PAYLOAD, gender: undefined }),
    ]);

    const result = await bulkDeliverInsuranceLeads('tenant-1', {
      listId: 'list-1',
      force: true,
    });

    expect(mockDeliver).toHaveBeenCalledTimes(1);
    expect(result.notReady).toBe(0);
  });

  it('never selects a submission that already matched, so a re-run cannot double-sell', async () => {
    mockPrisma.insuranceLeadSubmission.findMany.mockResolvedValue([]);

    await bulkDeliverInsuranceLeads('tenant-1', { listId: 'list-1' });

    const where = mockPrisma.insuranceLeadSubmission.findMany.mock.calls[0][0].where;
    expect(where.postStatus.in).not.toContain('MATCHED');
    expect(where.validationStatus).toBe('VALID');
    expect(where.insuranceLead).toEqual({ listId: 'list-1' });
  });

  it('returns a cursor while a full batch came back, and none on the last batch', async () => {
    mockPrisma.insuranceLeadSubmission.findMany.mockResolvedValue([
      submission('a'),
      submission('b'),
    ]);
    mockPrisma.insuranceLeadSubmission.count.mockResolvedValue(7);

    const full = await bulkDeliverInsuranceLeads('tenant-1', { listId: 'list-1', limit: 2 });
    expect(full.nextCursor).toBe('b');
    expect(full.remaining).toBe(7);

    mockPrisma.insuranceLeadSubmission.findMany.mockResolvedValue([submission('c')]);
    const last = await bulkDeliverInsuranceLeads('tenant-1', { listId: 'list-1', limit: 2 });
    expect(last.nextCursor).toBeNull();
    expect(last.remaining).toBe(0);
  });

  it('pages past leads it held back, so a caller looping on the cursor terminates', async () => {
    const notReady = { ...READY_PAYLOAD, gender: undefined };
    mockPrisma.insuranceLeadSubmission.findMany.mockResolvedValue([submission('a', notReady)]);
    mockPrisma.insuranceLeadSubmission.count.mockResolvedValue(0);

    const first = await bulkDeliverInsuranceLeads('tenant-1', { listId: 'list-1', limit: 1 });
    expect(first.nextCursor).toBe('a');

    await bulkDeliverInsuranceLeads('tenant-1', {
      listId: 'list-1',
      limit: 1,
      cursor: first.nextCursor!,
    });

    const where = mockPrisma.insuranceLeadSubmission.findMany.mock.calls[1][0].where;
    expect(where.id).toEqual({ gt: 'a' });
  });

  it('caps an oversized limit rather than trying to post the whole backlog at once', async () => {
    mockPrisma.insuranceLeadSubmission.findMany.mockResolvedValue([]);

    await bulkDeliverInsuranceLeads('tenant-1', { listId: 'list-1', limit: 100000 });

    expect(mockPrisma.insuranceLeadSubmission.findMany.mock.calls[0][0].take).toBe(250);
  });

  it('records a delivery error against the lead instead of failing the batch', async () => {
    mockPrisma.insuranceLeadSubmission.findMany.mockResolvedValue([submission('a')]);
    mockDeliver.mockResolvedValue({ error: 'Ameriquote timed out' });

    const result = await bulkDeliverInsuranceLeads('tenant-1', { listId: 'list-1' });

    expect(result.errored).toBe(1);
    expect(result.results[0].message).toBe('Ameriquote timed out');
  });
});

describe('preflightBulkDelivery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.insuranceLeadSubmission.count.mockResolvedValue(0);
  });

  it('splits the batch into ready and blocked, and tallies each reason once per lead', async () => {
    mockPrisma.insuranceLeadSubmission.findMany.mockResolvedValue([
      submission('a'),
      submission('b', { ...READY_PAYLOAD, gender: undefined }),
      submission('c', { ...READY_PAYLOAD, gender: undefined }),
    ]);

    const result = await preflightBulkDelivery('tenant-1', { listId: 'list-1' });

    expect(result.sendable).toBe(3);
    expect(result.ready).toBe(1);
    expect(result.blocked.count).toBe(2);
    expect(result.blocked.reasons).toEqual([
      expect.objectContaining({ field: 'gender', count: 2 }),
    ]);
  });

  it('sorts blocked reasons worst-first so the biggest data gap leads', async () => {
    mockPrisma.insuranceLeadSubmission.findMany.mockResolvedValue([
      submission('a', { ...READY_PAYLOAD, gender: undefined }),
      submission('b', { ...READY_PAYLOAD, gender: undefined }),
      submission('c', { ...READY_PAYLOAD, email: undefined }),
    ]);

    const result = await preflightBulkDelivery('tenant-1', { listId: 'list-1' });

    expect(result.blocked.reasons.map(r => r.field)).toEqual(['gender', 'email']);
  });

  it('surfaces the current post mode so a TEST-mode send is never a surprise', async () => {
    mockPrisma.insuranceLeadSubmission.findMany.mockResolvedValue([]);

    const result = await preflightBulkDelivery('tenant-1', { listId: 'list-1' });

    expect(result.mode).toBe('TEST');
  });
});
