import type { QuoteLine } from '@hopwhistle/fex-engine/types';
import { describe, expect, it } from 'vitest';

import type { FexResult } from '../fex/api';
import {
  activeFilterChips,
  DEFAULT_FILTERS,
  groupResults,
  assumedAnswers,
  needsReview,
  rateNeedsVerify,
  reviewReasons,
  sortResults,
} from '../fex/results-view';

const line = (benefit: string, premium: number | null, face = 10000): QuoteLine =>
  ({
    classCode: benefit,
    classLabel: benefit,
    uwClass: benefit,
    benefit,
    db: null,
    face,
    premium,
    annual: premium == null ? null : premium * 12,
    mode: 'monthly',
    modeLabel: 'Monthly',
    basis: 'ANNUAL_PER_1000',
    faceAdjusted: null,
    premiumNote: null,
    payPeriod: null,
  }) as unknown as QuoteLine;

const result = (productId: string, patch: Partial<FexResult> = {}): FexResult =>
  ({
    productId,
    carrier: `Carrier ${productId}`,
    family: `Carrier ${productId}`,
    product: `Plan ${productId}`,
    eligible: true,
    appointed: true,
    uwLoaded: true,
    refer: false,
    needsIndication: [],
    ratesStatus: 'CURRENT_2026',
    facts: null,
    reasons: [],
    best: line('LEVEL', 50),
    ...patch,
  }) as FexResult;

const RESULTS = [
  result('a', { best: line('LEVEL', 40) }),
  result('b', { best: line('GRADED', 30, 15000) }),
  result('c', { uwLoaded: false, best: line('LEVEL', 20) }),
  result('d', { appointed: false, best: line('LEVEL', 10) }),
  result('e', { eligible: false, best: null }),
  result('f', { eligible: false, appointed: false, best: null }),
  result('g', { refer: true, best: line('LEVEL', 45) }),
];

describe('groupResults', () => {
  it('puts every carrier in one category', () => {
    const g = groupResults(RESULTS, DEFAULT_FILTERS, null);
    expect(g.qualified.map(r => r.productId)).toEqual(['a', 'b', 'g']);
    expect(g.priceOnly.map(r => r.productId)).toEqual(['c']);
    expect(g.notAppointed).toEqual([]);
    // A not-appointed decline is hidden unless asked for.
    expect(g.declined.map(r => r.productId)).toEqual(['e']);
    expect(g.review.map(r => r.productId)).toEqual(['g']);
  });

  it('shows carriers the agent is not appointed with only on request', () => {
    const g = groupResults(RESULTS, { ...DEFAULT_FILTERS, showNotAppointed: true }, null);
    expect(g.notAppointed.map(r => r.productId)).toEqual(['d']);
    expect(g.declined.map(r => r.productId)).toEqual(['e', 'f']);
  });

  it('prices the best of the qualified, overall and Level', () => {
    const g = groupResults(RESULTS, DEFAULT_FILTERS, null);
    expect(g.lowestAny).toBe(30);
    expect(g.lowestLevel).toBe(40);
  });

  it('filters by benefit and counts what it hid', () => {
    const g = groupResults(RESULTS, { ...DEFAULT_FILTERS, benefit: 'level' }, null);
    expect(g.qualified.map(r => r.productId)).toEqual(['a', 'g']);
    expect(g.hiddenByFilters).toBe(1);
    const graded = groupResults(RESULTS, { ...DEFAULT_FILTERS, benefit: 'graded' }, null);
    expect(graded.qualified.map(r => r.productId)).toEqual(['b']);
  });

  it('filters by rate status', () => {
    const stale = [
      result('x', { ratesStatus: 'STALE_VERIFY' }),
      result('y', {
        facts: { ratesStatus: { label: 'Older', tone: 'warn' } } as FexResult['facts'],
      }),
      result('z'),
    ];
    expect(rateNeedsVerify(stale[0])).toBe(true);
    expect(rateNeedsVerify(stale[1])).toBe(true);
    const current = groupResults(stale, { ...DEFAULT_FILTERS, rate: 'current' }, null);
    expect(current.qualified.map(r => r.productId)).toEqual(['z']);
    const verify = groupResults(stale, { ...DEFAULT_FILTERS, rate: 'verify' }, null);
    expect(verify.qualified.map(r => r.productId)).toEqual(['x', 'y']);
    // A rate book to verify is an operational status, never a review item.
    expect(verify.review).toEqual([]);
  });

  it('searches carrier and product names in every category', () => {
    const g = groupResults(RESULTS, { ...DEFAULT_FILTERS, search: 'plan e' }, null);
    expect(g.qualified).toEqual([]);
    expect(g.declined.map(r => r.productId)).toEqual(['e']);
  });
});

describe('sortResults', () => {
  const list = [
    result('b', { family: 'Beta', best: line('LEVEL', 30, 5000) }),
    result('a', { family: 'Alpha', best: line('LEVEL', 50, 20000) }),
    result('c', { family: 'Gamma', best: line('LEVEL', null, 10000) }),
  ];
  it('keeps the API order when no sort is chosen', () => {
    expect(sortResults(list, null).map(r => r.productId)).toEqual(['b', 'a', 'c']);
  });
  it('sorts by price (unpriced last), coverage, and carrier', () => {
    expect(sortResults(list, 'price').map(r => r.productId)).toEqual(['b', 'a', 'c']);
    expect(sortResults(list, 'face').map(r => r.productId)).toEqual(['a', 'c', 'b']);
    expect(sortResults(list, 'carrier').map(r => r.productId)).toEqual(['a', 'b', 'c']);
  });
});

describe('needsReview and the filter chips', () => {
  it('flags a referral, an unconfirmed medication, or an assumed health answer', () => {
    const assumed = result('a', {
      reasons: [
        { kind: 'rule', outcome: 'GRADED', text: 'x', assumed: ['diagnosis date not given'] },
      ] as FexResult['reasons'],
    });
    expect(reviewReasons(assumed)).toEqual(['Health answers assumed']);
    expect(assumedAnswers(assumed)).toEqual(['diagnosis date not given']);
    // The result's general notes and an unconfirmed indication are not "assumed answers".
    expect(
      reviewReasons(
        result('b', {
          assumptions: ['Height/weight not entered — build chart not checked'],
          reasons: [
            { kind: 'rx', outcome: 'GRADED', text: 'y', assumed: ['indication not confirmed'] },
          ] as FexResult['reasons'],
        })
      )
    ).toEqual([]);
    expect(reviewReasons(result('c', { refer: true }))).toEqual(['Referral required']);
    expect(needsReview(result('a', { refer: true }))).toBe(true);
    expect(
      needsReview(result('a', { needsIndication: [{ drugId: 'x', name: 'x', options: [] }] }))
    ).toBe(true);
    expect(needsReview(result('a'))).toBe(false);
    expect(needsReview(result('a', { eligible: false, refer: true }))).toBe(false);
  });

  it('names each active filter', () => {
    expect(activeFilterChips(DEFAULT_FILTERS)).toEqual([]);
    expect(
      activeFilterChips({
        benefit: 'level',
        rate: 'current',
        showNotAppointed: true,
        search: ' x ',
      }).map(c => c.label)
    ).toEqual(['Level only', 'Current rates only', 'Including not appointed', '“x”']);
  });
});
