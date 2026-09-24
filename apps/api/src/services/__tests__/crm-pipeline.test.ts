import { describe, expect, it } from 'vitest';

import { lastTenDigits, notConvertedWhere } from '../crm-pipeline.js';

describe('lastTenDigits', () => {
  it('reduces any written form of a US number to the ten digits leads store', () => {
    expect(lastTenDigits('(555) 123-4567')).toBe('5551234567');
    expect(lastTenDigits('15551234567')).toBe('5551234567');
    expect(lastTenDigits('+1 555.123.4567')).toBe('5551234567');
  });

  it('answers null rather than matching on a fragment', () => {
    expect(lastTenDigits('555-1234')).toBeNull();
    expect(lastTenDigits('')).toBeNull();
    expect(lastTenDigits(null)).toBeNull();
  });
});

describe('notConvertedWhere', () => {
  it('leaves out leads linked by id or by phone', () => {
    expect(notConvertedWhere({ leadIds: ['lead-1'], phones: ['5551234567'] })).toEqual({
      NOT: { OR: [{ id: { in: ['lead-1'] } }, { phone: { in: ['5551234567'] } }] },
    });
  });

  it('adds nothing when the agency has no submitted applications', () => {
    // `NOT: { OR: [] }` would be a Prisma error, not "everything".
    expect(notConvertedWhere({ leadIds: [], phones: [] })).toEqual({});
  });
});
