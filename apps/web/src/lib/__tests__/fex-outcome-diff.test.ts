import { describe, expect, it } from 'vitest';

import type { FexResult } from '../fex/api';
import { diffOutcomes, outcomeMap, premiumMaterial } from '../fex/outcome-diff';

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
  it('reports eligibility and class changes first, then material price moves', () => {
    const before = outcomeMap([
      result('a', {}),
      result('b', {}),
      result('c', { best: line('LEVEL', 'LEVEL', 'Level', 40) as never }),
      result('d', { eligible: false, best: null }),
    ]);
    const after = [
      result('c', { best: line('LEVEL', 'LEVEL', 'Level', 90) as never }),
      result('a', { best: line('GRADED', 'GRADED', 'Graded') as never }),
      result('b', { eligible: false, best: null }),
      result('d', { best: line('GUARANTEED_ISSUE', 'GI', 'Guaranteed') as never }),
      result('e', {}),
    ];
    expect(diffOutcomes(before, after)).toEqual([
      expect.objectContaining({
        productId: 'b',
        kind: 'eligibility',
        from: 'Level',
        to: 'Declined',
        direction: 'worse',
      }),
      expect.objectContaining({
        productId: 'd',
        kind: 'eligibility',
        from: 'Declined',
        to: 'Guaranteed',
        direction: 'better',
      }),
      expect.objectContaining({
        productId: 'a',
        kind: 'class',
        from: 'Level',
        to: 'Graded',
        direction: 'worse',
      }),
      expect.objectContaining({
        productId: 'c',
        kind: 'premium',
        premiumFrom: 40,
        premiumTo: 90,
        direction: 'worse',
      }),
    ]);
  });

  it('ignores rounding-sized premium moves', () => {
    expect(premiumMaterial(100, 100.4)).toBe(false); // under $0.50
    expect(premiumMaterial(200, 200.9)).toBe(false); // $0.90, but under 0.5%
    expect(premiumMaterial(100, 100.6)).toBe(true);
    expect(premiumMaterial(100, 99)).toBe(true);
    const before = outcomeMap([
      result('a', { best: line('LEVEL', 'LEVEL', 'Level', 50) as never }),
    ]);
    expect(
      diffOutcomes(before, [result('a', { best: line('LEVEL', 'LEVEL', 'Level', 50.3) as never })])
    ).toEqual([]);
    expect(
      diffOutcomes(before, [result('a', { best: line('LEVEL', 'LEVEL', 'Level', 47) as never })])
    ).toEqual([expect.objectContaining({ kind: 'premium', direction: 'better' })]);
  });

  it('reports a face change (a budget quote) ahead of the premium', () => {
    const before = outcomeMap([result('a', {})]);
    const after = [
      result('a', { best: { ...line('LEVEL', 'LEVEL', 'Level', 55), face: 8500 } as never }),
    ];
    expect(diffOutcomes(before, after)).toEqual([
      expect.objectContaining({ kind: 'face', faceFrom: 10000, faceTo: 8500, direction: 'worse' }),
    ]);
  });

  it('is empty when nothing moved', () => {
    const results = [result('a', {}), result('b', { eligible: false, best: null })];
    expect(diffOutcomes(outcomeMap(results), results)).toEqual([]);
  });
});
