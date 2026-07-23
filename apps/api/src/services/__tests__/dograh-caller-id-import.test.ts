/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = {
  tenant: { findUnique: vi.fn() },
  callerIdPool: { findFirst: vi.fn(), create: vi.fn() },
  callerIdPoolPhoneNumber: { upsert: vi.fn(), count: vi.fn() },
  phoneNumber: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
};

vi.mock('../../lib/prisma.js', () => ({
  getPrismaClient: () => prismaMock,
}));

import { DOGRAH_CALLER_ID_POOL_NAME, planImport, runImport } from '../dograh-caller-id-import.js';

const TENANT = 'tenant-1';

function resetMocks() {
  vi.clearAllMocks();
  prismaMock.tenant.findUnique.mockResolvedValue({ id: TENANT });
  prismaMock.callerIdPool.findFirst.mockResolvedValue({
    id: 'pool-1',
    name: DOGRAH_CALLER_ID_POOL_NAME,
  });
  prismaMock.callerIdPool.create.mockResolvedValue({ id: 'pool-1' });
  prismaMock.phoneNumber.findMany.mockResolvedValue([]);
  prismaMock.phoneNumber.create.mockImplementation(({ data }: any) =>
    Promise.resolve({ id: `pn-${data.number}`, ...data })
  );
  prismaMock.phoneNumber.update.mockResolvedValue({});
  prismaMock.callerIdPoolPhoneNumber.upsert.mockResolvedValue({});
  prismaMock.callerIdPoolPhoneNumber.count.mockResolvedValue(0);
}

describe('planImport (pure validation)', () => {
  it('normalizes all valid input formats to E.164', () => {
    const plan = planImport([
      { number: '8392000722', state: 'SC' },
      { number: '1 (423) 644-4347', state: 'TN' },
      { number: '+12166777926', state: 'OH' },
    ]);
    expect(plan.rejected).toEqual([]);
    expect(plan.valid.map(v => v.e164)).toEqual(['+18392000722', '+14236444347', '+12166777926']);
    expect(plan.valid.map(v => v.state)).toEqual(['SC', 'TN', 'OH']);
  });

  it('rejects malformed, toll-free, unknown-NPA, and state-mismatched rows', () => {
    const plan = planImport([
      { number: '55512' },
      { number: '8005551212' },
      { number: '7875551212' },
      { number: '8392000722', state: 'TN' }, // 839 is SC, not TN
    ]);
    expect(plan.valid).toEqual([]);
    expect(plan.rejected.map(r => r.reason)).toEqual([
      'MALFORMED_OR_NON_US',
      'TOLL_FREE_OR_NON_GEOGRAPHIC',
      'UNKNOWN_OR_UNSUPPORTED_AREA_CODE',
      'STATE_MISMATCH declared=TN canonical=SC',
    ]);
    expect(plan.unknownState).toEqual(['+17875551212']);
  });

  it('reports duplicates once and keeps the first occurrence', () => {
    const plan = planImport([
      { number: '8392000722', state: 'SC' },
      { number: '+1 839 200 0722', state: 'SC' },
    ]);
    expect(plan.valid).toHaveLength(1);
    expect(plan.duplicates).toEqual(['+18392000722']);
  });
});

describe('runImport (database interaction)', () => {
  beforeEach(resetMocks);

  it('dry-run performs no writes', async () => {
    const result = await runImport([{ number: '8392000722', state: 'SC' }], {
      tenantId: TENANT,
      dryRun: true,
    });
    expect(result.dryRun).toBe(true);
    expect(result.inserted).toBe(1);
    expect(prismaMock.phoneNumber.create).not.toHaveBeenCalled();
    expect(prismaMock.phoneNumber.update).not.toHaveBeenCalled();
    expect(prismaMock.callerIdPool.create).not.toHaveBeenCalled();
    expect(prismaMock.callerIdPoolPhoneNumber.upsert).not.toHaveBeenCalled();
  });

  it('inserts new numbers with state metadata and links them to the pool', async () => {
    prismaMock.callerIdPoolPhoneNumber.count.mockResolvedValue(1);
    const result = await runImport([{ number: '8392000722', state: 'SC' }], {
      tenantId: TENANT,
      dryRun: false,
    });
    expect(result.inserted).toBe(1);
    expect(result.linkedToPool).toBe(1);
    expect(result.dbConfirmedPoolTotal).toBe(1);
    const createArg = prismaMock.phoneNumber.create.mock.calls[0][0].data;
    expect(createArg.number).toBe('+18392000722');
    expect(createArg.tenantId).toBe(TENANT);
    expect(createArg.provider).toBe('fractel');
    expect(createArg.metadata).toMatchObject({
      npa: '839',
      state: 'SC',
      dograhCallerId: true,
    });
  });

  it('is idempotent: an already-correct number is unchanged, not duplicated', async () => {
    prismaMock.phoneNumber.findMany.mockResolvedValue([
      {
        id: 'pn-1',
        tenantId: TENANT,
        userId: null,
        status: 'ACTIVE',
        metadata: { npa: '839', state: 'SC', dograhCallerId: true },
      },
    ]);
    const result = await runImport([{ number: '8392000722', state: 'SC' }], {
      tenantId: TENANT,
      dryRun: false,
    });
    expect(result.alreadyCorrect).toBe(1);
    expect(result.inserted).toBe(0);
    expect(prismaMock.phoneNumber.create).not.toHaveBeenCalled();
    expect(prismaMock.phoneNumber.update).not.toHaveBeenCalled();
    // still (re-)linked to the pool idempotently via upsert
    expect(prismaMock.callerIdPoolPhoneNumber.upsert).toHaveBeenCalledTimes(1);
  });

  it('updates missing metadata on an existing row without duplicating it', async () => {
    prismaMock.phoneNumber.findMany.mockResolvedValue([
      { id: 'pn-1', tenantId: TENANT, userId: null, status: 'ACTIVE', metadata: {} },
    ]);
    const result = await runImport([{ number: '8392000722', state: 'SC' }], {
      tenantId: TENANT,
      dryRun: false,
    });
    expect(result.updated).toBe(1);
    expect(prismaMock.phoneNumber.create).not.toHaveBeenCalled();
    const updateArg = prismaMock.phoneNumber.update.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: 'pn-1' });
    expect(updateArg.data.metadata).toMatchObject({ state: 'SC', dograhCallerId: true });
  });

  it('rejects numbers owned by another tenant', async () => {
    prismaMock.phoneNumber.findMany.mockResolvedValue([
      { id: 'pn-x', tenantId: 'other-tenant', userId: null, status: 'ACTIVE', metadata: {} },
    ]);
    const result = await runImport([{ number: '8392000722', state: 'SC' }], {
      tenantId: TENANT,
      dryRun: false,
    });
    expect(result.inserted + result.updated + result.alreadyCorrect).toBe(0);
    expect(result.rejected).toContainEqual({
      number: '+18392000722',
      reason: 'OWNED_BY_OTHER_TENANT',
    });
    expect(prismaMock.phoneNumber.create).not.toHaveBeenCalled();
  });

  it('rejects numbers assigned to a user (agent DIDs stay out of the AI pool)', async () => {
    prismaMock.phoneNumber.findMany.mockResolvedValue([
      { id: 'pn-1', tenantId: TENANT, userId: 'user-9', status: 'ACTIVE', metadata: {} },
    ]);
    const result = await runImport([{ number: '8392000722', state: 'SC' }], {
      tenantId: TENANT,
      dryRun: false,
    });
    expect(result.rejected).toContainEqual({
      number: '+18392000722',
      reason: 'NUMBER_ASSIGNED_TO_USER',
    });
    expect(prismaMock.phoneNumber.update).not.toHaveBeenCalled();
  });

  it('builds per-state inventory for accepted numbers', async () => {
    const result = await runImport(
      [
        { number: '8392000722', state: 'SC' },
        { number: '8392000720', state: 'SC' },
        { number: '4236444347', state: 'TN' },
      ],
      { tenantId: TENANT, dryRun: true }
    );
    expect(result.stateInventory).toEqual({ SC: 2, TN: 1 });
  });
});
