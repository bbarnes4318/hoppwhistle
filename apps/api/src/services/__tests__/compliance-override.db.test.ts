import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { announceSkip, databaseGate } from '../../__tests__/helpers/live-services.js';
import { getPrismaClient } from '../../lib/prisma.js';
import { complianceService } from '../compliance-service.js';

/*
 * A compliance override granted for one call must let only that call through.
 * The lookup used to put its "which call" and "not expired" conditions under
 * two `OR` keys of one object; the second replaced the first, so an override
 * for one call waved through every call to the number.
 */
const gate = databaseGate();
announceSkip('Compliance override scoping (database-backed)', gate);

describe.skipIf(!gate.available)('complianceService.checkOverride', () => {
  const prisma = getPrismaClient();
  const tenantId = randomUUID();
  const scopedNumber = '+15555550101';
  const openNumber = '+15555550102';
  const expiredNumber = '+15555550103';

  beforeAll(async () => {
    await prisma.tenant.create({
      data: { id: tenantId, name: 'Override Scope Tenant', slug: `override-scope-${tenantId}` },
    });
    await prisma.complianceOverride.createMany({
      data: [
        { tenantId, phoneNumber: scopedNumber, reason: 'one call', callId: 'call-granted' },
        { tenantId, phoneNumber: openNumber, reason: 'every call' },
        {
          tenantId,
          phoneNumber: expiredNumber,
          reason: 'expired',
          expiresAt: new Date(Date.now() - 60_000),
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
  });

  it('applies a call-scoped override to the call it was granted for', async () => {
    const result = await complianceService.checkOverride(tenantId, scopedNumber, 'call-granted');
    expect(result.hasOverride).toBe(true);
  });

  it('does not apply a call-scoped override to a different call', async () => {
    const result = await complianceService.checkOverride(tenantId, scopedNumber, 'call-other');
    expect(result.hasOverride).toBe(false);
  });

  it('does not apply a call-scoped override when no call is named', async () => {
    const result = await complianceService.checkOverride(tenantId, scopedNumber);
    expect(result.hasOverride).toBe(false);
  });

  it('applies an override that names no call to every call to the number', async () => {
    expect((await complianceService.checkOverride(tenantId, openNumber, 'call-x')).hasOverride).toBe(true);
    expect((await complianceService.checkOverride(tenantId, openNumber)).hasOverride).toBe(true);
  });

  it('ignores an expired override', async () => {
    const result = await complianceService.checkOverride(tenantId, expiredNumber, 'call-x');
    expect(result.hasOverride).toBe(false);
  });
});
