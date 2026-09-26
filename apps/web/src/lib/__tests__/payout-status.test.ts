import { describe, expect, it } from 'vitest';

import { DEFAULT_TONE, resolveTone } from '@/components/domain/status-tones';
import { CLAWED_BACK, CLAWED_BACK_BADGE, CLAWED_BACK_LABEL } from '@/lib/payout-status';

/**
 * CLAWED_BACK is a publisher payout status written as a string, not a Prisma
 * enum, so check:status-tones cannot see it; this pins its tone instead.
 */
describe('CLAWED_BACK payout status', () => {
  it('has a tone, in the dropped family', () => {
    expect(DEFAULT_TONE[CLAWED_BACK]).toBe('dropped');
    expect(resolveTone(CLAWED_BACK)).toBe('dropped');
  });

  it('is labelled and badged as a return deducted from the next payment', () => {
    expect(CLAWED_BACK_LABEL).toBe('Returned, deducted from next payment');
    expect(CLAWED_BACK_BADGE).toContain('text-dropped-ink');
  });
});
