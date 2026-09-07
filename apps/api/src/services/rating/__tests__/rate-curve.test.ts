import { describe, it, expect } from 'vitest';

import { rateFor, toRateCurve } from '../rate-curve.js';
import type { RateCurve } from '../rate-curve.js';

/**
 * The launch curve, exactly as the 20260908000000_add_rating_engine migration
 * seeds it. Written out here rather than read from the database so this suite
 * pins the arithmetic and needs no services to run.
 */
const LAUNCH_CURVE: RateCurve = toRateCurve({
  id: 'curve-v1',
  version: 1,
  minimumClosingPct: 5,
  flatFromClosingPct: 15,
  introductoryRate: 159,
  introductoryApplications: 5,
  anchors: [
    { closingPct: 5, rate: 264 },
    { closingPct: 6, rate: 234 },
    { closingPct: 7, rate: 204 },
    { closingPct: 8, rate: 184 },
    { closingPct: 9, rate: 169 },
    { closingPct: 10, rate: 159 },
    { closingPct: 11, rate: 159 },
    { closingPct: 12, rate: 149 },
    { closingPct: 13, rate: 144 },
    { closingPct: 14, rate: 139 },
    { closingPct: 15, rate: 134 },
  ],
});

function rate(pct: number): number | null {
  const verdict = rateFor(LAUNCH_CURVE, pct);
  return verdict.kind === 'RATE' ? verdict.rate : null;
}

describe('rate curve', () => {
  it('returns each anchor point exactly', () => {
    expect(rate(5)).toBe(264);
    expect(rate(6)).toBe(234);
    expect(rate(7)).toBe(204);
    expect(rate(8)).toBe(184);
    expect(rate(9)).toBe(169);
    expect(rate(10)).toBe(159);
    expect(rate(11)).toBe(159);
    expect(rate(12)).toBe(149);
    expect(rate(13)).toBe(144);
    expect(rate(14)).toBe(139);
    expect(rate(15)).toBe(134);
  });

  it('interpolates between two anchors', () => {
    // Halfway from 9% ($169) to 10% ($159).
    expect(rate(9.5)).toBe(164);
    // Halfway from 5% ($264) to 6% ($234).
    expect(rate(5.5)).toBe(249);
    // A quarter of the way from 12% ($149) to 13% ($144): 149 - 1.25 = 147.75,
    // which rounds to 148.
    expect(rate(12.25)).toBe(148);
  });

  it('is flat between two equal anchors', () => {
    // 10% and 11% are both $159, so everything between them is too. This is the
    // one place a step scale and the curve agree, and it is worth pinning
    // because it is the segment an agency is most likely to sit in.
    expect(rate(10.3)).toBe(159);
    expect(rate(10.7)).toBe(159);
  });

  it('is continuous: a hundredth of a point never moves the rate by a dollar step', () => {
    // The property the continuous curve exists for. On a step scale, 9.995 and
    // 10.005 land in different bands and differ by ten dollars.
    const below = rate(9.995);
    const above = rate(10.005);
    expect(Math.abs((below as number) - (above as number))).toBeLessThanOrEqual(1);
  });

  it('is flat at and above 15%, never extrapolated', () => {
    expect(rate(15)).toBe(134);
    expect(rate(15.1)).toBe(134);
    expect(rate(20)).toBe(134);
    expect(rate(100)).toBe(134);
  });

  it('has no rate below 5% and says so distinctly', () => {
    const verdict = rateFor(LAUNCH_CURVE, 4.9);
    expect(verdict.kind).toBe('BELOW_MINIMUM');
    // Not zero, and not the result of extending the 5-6% segment downward,
    // which would quote $294 at 4% with nothing behind it.
    expect(rate(4.9)).toBeNull();
    expect(rate(0)).toBeNull();
  });

  it('prices exactly 5.0% rather than treating the floor as excluded', () => {
    expect(rateFor(LAUNCH_CURVE, 5).kind).toBe('RATE');
    expect(rate(5)).toBe(264);
    expect(rate(4.999)).toBeNull();
  });

  it('rounds to the nearest whole dollar', () => {
    for (let pct = 5; pct <= 15; pct += 0.01) {
      const value = rate(Number(pct.toFixed(2)));
      expect(value).not.toBeNull();
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it('never returns a rate outside the anchors it was given', () => {
    for (let pct = 0; pct <= 30; pct += 0.05) {
      const value = rate(Number(pct.toFixed(2)));
      if (value === null) continue;
      expect(value).toBeLessThanOrEqual(264);
      expect(value).toBeGreaterThanOrEqual(134);
    }
  });

  it('is monotonically non-increasing: closing more never pays less per application', () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let pct = 5; pct <= 20; pct += 0.05) {
      const value = rate(Number(pct.toFixed(2))) as number;
      expect(value).toBeLessThanOrEqual(previous + 1); // +1 absorbs rounding
      previous = value;
    }
  });

  it('prices a past settlement from its own curve version, not the current one', () => {
    // A later version moves every anchor. The old version still resolves, which
    // is the whole reason the curve is versioned data rather than constants.
    const v2 = toRateCurve({
      id: 'curve-v2',
      version: 2,
      minimumClosingPct: 5,
      flatFromClosingPct: 15,
      introductoryRate: 159,
      introductoryApplications: 5,
      anchors: [
        { closingPct: 5, rate: 200 },
        { closingPct: 15, rate: 100 },
      ],
    });

    expect(rateFor(LAUNCH_CURVE, 10).kind === 'RATE' && rateFor(LAUNCH_CURVE, 10)).toEqual({
      kind: 'RATE',
      rate: 159,
    });
    expect(rateFor(v2, 10)).toEqual({ kind: 'RATE', rate: 150 });
  });

  it('refuses to price against a curve with no anchors', () => {
    const empty = { ...LAUNCH_CURVE, anchors: [] };
    expect(() => rateFor(empty, 10)).toThrow(/no anchor points/);
  });

  it('refuses a non-finite closing percentage rather than inventing a rate', () => {
    expect(() => rateFor(LAUNCH_CURVE, Number.NaN)).toThrow(/finite/);
    expect(() => rateFor(LAUNCH_CURVE, Number.POSITIVE_INFINITY)).toThrow(/finite/);
  });
});
