import { describe, expect, it } from 'vitest';

import type { FexResult } from '../fex/api';
import { diffOutcomes, outcomeMap } from '../fex/outcome-diff';

const line = (benefit: string, classCode: string, classLabel: string, premium = 50) => ({
  classCode,
  classLabel,
  uwClass: classCode,
  benefit,
  db: null,
  face: 10000,
  premium,
  annual: premium * 12,
  mode: 'monthly',
  modeLabel: 'Monthly',
  basis: 'ANNUAL_PER_1000',
  faceAdjusted: null,
  premiumNote: null,
  payPeriod: null,
});

const result = (productId: string, patch: Partial<FexResult>): FexResult =>
  ({
    productId,
    family: `Carrier ${productId}`,
    product: `Plan ${productId}`,
    eligible: true,
    outcomeLabel: '',
    best: line('LEVEL', 'LEVEL', 'Level'),
    ...patch,
  }) as unknown as FexResult;

describe('diffOutcomes', () => {
  it('reports class and eligibility changes, not premium changes', () => {
    const before = outcomeMap([
      result('a', {}),
      result('b', {}),
      result('c', { best: line('LEVEL', 'LEVEL', 'Level', 40) as never }),
      result('d', { eligible: false, best: null }),
    ]);
    const after = [
      result('a', { best: line('GRADED', 'GRADED', 'Graded') as never }),
      result('b', { eligible: false, best: null }),
      result('c', { best: line('LEVEL', 'LEVEL', 'Level', 90) as never }),
      result('d', { best: line('GUARANTEED_ISSUE', 'GI', 'Guaranteed') as never }),
      result('e', {}),
    ];
    expect(diffOutcomes(before, after)).toEqual([
      expect.objectContaining({ productId: 'a', from: 'Level', to: 'Graded', direction: 'worse' }),
      expect.objectContaining({
        productId: 'b',
        from: 'Level',
        to: 'Declined',
        direction: 'worse',
      }),
      expect.objectContaining({
        productId: 'd',
        from: 'Declined',
        to: 'Guaranteed',
        direction: 'better',
      }),
    ]);
  });

  it('is empty when nothing moved', () => {
    const results = [result('a', {}), result('b', { eligible: false, best: null })];
    expect(diffOutcomes(outcomeMap(results), results)).toEqual([]);
  });
});
