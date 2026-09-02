/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
// Same allowance the sibling delivery suite makes: vitest types mock call
// records as `any`, so asserting on them trips the unsafe-any rules.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

// Only the mode is faked. getAmeriquoteConfigProblem has to be the real one:
// what it reads from the environment is the thing under test below.
vi.mock('../insurance-lead-config.js', async () => ({
  ...(await vi.importActual<typeof import('../insurance-lead-config.js')>(
    '../insurance-lead-config.js'
  )),
  getInsuranceLeadMode: () => 'TEST',
}));

// Every case except the config suite assumes delivery is configured.
process.env.AMERIQUOTE_API_KEY = process.env.AMERIQUOTE_API_KEY || 'test-key';

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

    // Asserted by content rather than by position: the cursor is AND-ed with
    // the selector now, so a top-level `where.id` would mean the selector had
    // been overwritten — which is the bug that posted 12,000 leads.
    const where = mockPrisma.insuranceLeadSubmission.findMany.mock.calls[1][0].where;
    expect(JSON.stringify(where)).toContain('"gt":"a"');
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

describe('a broken config stops the run before it starts', () => {
  // A real send marked 18 leads ERROR, one per lead, for one empty env var.
  // Each had spent an attempt on a post that could not have worked.
  const KEY = 'AMERIQUOTE_API_KEY';
  const original = process.env[KEY];

  beforeEach(() => {
    mockPrisma.insuranceLeadSubmission.findMany.mockClear();
    mockDeliver.mockClear();
  });

  afterEach(() => {
    if (original === undefined) delete process.env[KEY];
    else process.env[KEY] = original;
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
    // docker-compose.dev.yml passes ${AMERIQUOTE_API_KEY:-}, so a container
    // started without it holds an empty string, not an absent variable.
    ['whitespace', '   '],
  ])('refuses to post when the key is %s', async (_label, value) => {
    if (value === undefined) delete process.env[KEY];
    else process.env[KEY] = value;

    const result = await bulkDeliverInsuranceLeads('tenant-1');

    expect(result.attempted).toBe(0);
    expect(mockDeliver).not.toHaveBeenCalled();
    // Not a single row read: no attemptCount incremented, no postStatus rewritten.
    expect(mockPrisma.insuranceLeadSubmission.findMany).not.toHaveBeenCalled();
    expect(result.failureReasons[0].message).toContain(KEY);
  });

  it('sends normally once the key is there', async () => {
    process.env[KEY] = 'a-real-key';
    mockPrisma.insuranceLeadSubmission.findMany.mockResolvedValue([]);
    mockPrisma.insuranceLeadSubmission.count.mockResolvedValue(0);

    const result = await bulkDeliverInsuranceLeads('tenant-1');

    expect(mockPrisma.insuranceLeadSubmission.findMany).toHaveBeenCalled();
    expect(result.failureReasons).toEqual([]);
  });
});

/**
 * A caller loops on `nextCursor` until it comes back null. Every request after
 * the first carries a cursor — so if the cursor drops the caller's scope, the
 * scope only holds for batch one and every batch after it is unbounded.
 *
 * That is what happened in production: a send of 241 leads posted 12,000. The
 * object spread `{ ...sendableWhere, id: { gt: cursor } }` replaced the
 * `id: { in: submissionIds }` filter instead of narrowing it. A post is spent
 * whether or not the lead sells, so this destroyed leads rather than merely
 * paginating badly.
 */
describe('cursor paging keeps the caller scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.insuranceLeadSubmission.count.mockResolvedValue(0);
    mockPrisma.insuranceLeadSubmission.findMany.mockResolvedValue([]);
    mockDeliver.mockResolvedValue({
      success: true,
      postStatus: 'MATCHED',
      postMode: 'TEST',
      ameriquoteStatus: 'Matched',
      ameriquoteLeadId: '9001',
    });
  });

  /** Every `id` constraint anywhere in a where clause, however nested. */
  function idFilters(where: unknown): unknown[] {
    if (!where || typeof where !== 'object') return [];
    const node = where as Record<string, unknown>;
    const found: unknown[] = [];
    if (node.id !== undefined) found.push(node.id);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(v => found.push(...idFilters(v)));
      else if (value && typeof value === 'object') found.push(...idFilters(value));
    }
    return found;
  }

  it('still restricts to the requested submissions on a later batch', async () => {
    await bulkDeliverInsuranceLeads('tenant-1', {
      submissionIds: ['s1', 's2', 's3'],
      cursor: 's1',
    });

    const { where } = mockPrisma.insuranceLeadSubmission.findMany.mock.calls[0][0];
    const filters = idFilters(where);

    // The `in` list must survive alongside the cursor, not be replaced by it.
    expect(filters).toContainEqual({ in: ['s1', 's2', 's3'] });
    expect(filters).toContainEqual({ gt: 's1' });
  });

  it('counts what remains within the caller scope, not the whole tenant', async () => {
    // A full batch is what produces a nextCursor, and therefore a count.
    mockPrisma.insuranceLeadSubmission.findMany.mockResolvedValue([submission('s2')]);

    await bulkDeliverInsuranceLeads('tenant-1', {
      submissionIds: ['s1', 's2', 's3'],
      limit: 1,
    });

    const { where } = mockPrisma.insuranceLeadSubmission.count.mock.calls[0][0];
    const filters = idFilters(where);

    // An overstated remaining count is what keeps a looping caller going long
    // after its own leads are exhausted.
    expect(filters).toContainEqual({ in: ['s1', 's2', 's3'] });
    expect(filters).toContainEqual({ gt: 's2' });
  });

  it('scopes by tenant on every batch', async () => {
    await bulkDeliverInsuranceLeads('tenant-1', { submissionIds: ['s1'], cursor: 's0' });

    const { where } = mockPrisma.insuranceLeadSubmission.findMany.mock.calls[0][0];
    expect(JSON.stringify(where)).toContain('tenant-1');
  });
});
