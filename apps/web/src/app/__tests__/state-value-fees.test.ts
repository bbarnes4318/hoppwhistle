import { describe, expect, it } from 'vitest';

import {
  FEES,
  NIPR_TRANSACTION_FEE,
  RETALIATORY_CODES,
  RETALIATORY_SCHEDULES,
  daysSince,
  isStale,
  resolveFee,
} from '../state-value/fees';
import { STATES } from '../state-value/state-data';

const AS_OF = new Date('2026-09-08T00:00:00Z');

describe('NIPR transaction fee', () => {
  it('is 5.60, not the 5.00 the original spreadsheet carried', () => {
    expect(NIPR_TRANSACTION_FEE).toBe(5.6);
  });

  it('is added exactly once regardless of lines of authority', () => {
    const one = resolveFee('OH', 'FL', { loaCount: 1, asOf: AS_OF });
    const four = resolveFee('OH', 'FL', { loaCount: 4, asOf: AS_OF });
    expect(one.niprFee).toBe(5.6);
    expect(four.niprFee).toBe(5.6);
  });
});

describe('posted (non-retaliatory) states', () => {
  it('charges the posted fee plus NIPR, regardless of resident state', () => {
    const fromFlorida = resolveFee('OH', 'FL', { asOf: AS_OF });
    const fromTexas = resolveFee('OH', 'TX', { asOf: AS_OF });

    expect(fromFlorida.basis).toBe('posted');
    expect(fromFlorida.stateFee).toBe(10);
    expect(fromFlorida.total).toBeCloseTo(15.6, 10);
    expect(fromFlorida.verified).toBe(true);
    expect(fromTexas.total).toBe(fromFlorida.total);
  });
});

describe('retaliatory states', () => {
  it('every confirmed retaliatory jurisdiction is flagged in the fee table', () => {
    // NY has no posted fee yet, so it is absent from FEES by design.
    for (const code of RETALIATORY_CODES.filter(c => c !== 'NY')) {
      expect(FEES[code]?.retaliatory, `${code} should be marked retaliatory`).toBe(true);
    }
    expect(FEES.NY).toBeUndefined();
  });

  it('falls back to the posted fee and reports itself UNVERIFIED with no schedule row', () => {
    const r = resolveFee('IN', 'FL', { asOf: AS_OF });
    expect(r.basis).toBe('retaliatory-fallback');
    expect(r.verified).toBe(false);
    expect(r.stateFee).toBe(FEES.IN.postedFee);
    expect(r.note).toMatch(/retaliatory/i);
  });

  it('uses the published schedule row when one is loaded', () => {
    RETALIATORY_SCHEDULES.IN = {
      sourceUrl: 'https://example.test/schedule',
      verifiedOn: '2026-09-08',
      provenance: 'source-verified',
      fees: { FL: 137 },
    };
    try {
      const scheduled = resolveFee('IN', 'FL', { asOf: AS_OF });
      expect(scheduled.basis).toBe('retaliatory-schedule');
      expect(scheduled.verified).toBe(true);
      expect(scheduled.stateFee).toBe(137);
      expect(scheduled.total).toBeCloseTo(142.6, 10);

      // A resident state absent from the schedule still falls back.
      const missing = resolveFee('IN', 'TX', { asOf: AS_OF });
      expect(missing.basis).toBe('retaliatory-fallback');
      expect(missing.verified).toBe(false);
    } finally {
      delete RETALIATORY_SCHEDULES.IN;
    }
  });

  it('ships no schedules, so no retaliatory figure is presented as confirmed', () => {
    expect(Object.keys(RETALIATORY_SCHEDULES)).toHaveLength(0);
    for (const code of RETALIATORY_CODES) {
      expect(resolveFee(code, 'FL', { asOf: AS_OF }).verified).toBe(false);
    }
  });

  it('never derives retaliation from a max() of the two states', () => {
    // Ohio posts 10 and Vermont 215. A max() rule would charge an Ohio
    // resident 215 in Vermont and a Vermont resident 215 in Ohio. The second
    // is plainly wrong: Ohio is not retaliatory and charges everyone 10.
    expect(resolveFee('OH', 'VT', { asOf: AS_OF }).stateFee).toBe(10);
  });
});

describe('Nebraska effective date', () => {
  it('is not retaliatory the day before 17 July 2026', () => {
    const r = resolveFee('NE', 'FL', { asOf: new Date('2026-07-16T00:00:00Z') });
    expect(r.basis).toBe('posted');
    expect(r.verified).toBe(true);
  });

  it('is retaliatory on and after 17 July 2026', () => {
    for (const day of ['2026-07-17', '2026-09-08']) {
      const r = resolveFee('NE', 'FL', { asOf: new Date(`${day}T00:00:00Z`) });
      expect(r.basis, day).toBe('retaliatory-fallback');
      expect(r.verified, day).toBe(false);
    }
  });
});

describe('unsourced jurisdictions', () => {
  it('resolves to null rather than a placeholder number', () => {
    for (const code of ['AK', 'HI', 'MO', 'NV', 'NY']) {
      const r = resolveFee(code, 'FL', { asOf: AS_OF });
      expect(r.basis, code).toBe('unsourced');
      expect(r.stateFee, code).toBeNull();
      expect(r.total, code).toBeNull();
      expect(r.verified, code).toBe(false);
    }
  });
});

describe('per-line-of-authority states', () => {
  it('multiplies only the state portion', () => {
    FEES.__TEST__ = {
      postedFee: 100,
      perLoa: true,
      sourceUrl: 'https://example.test',
      verifiedOn: '2026-09-08',
      provenance: 'owner-supplied',
    };
    try {
      const two = resolveFee('__TEST__', 'FL', { loaCount: 2, asOf: AS_OF });
      expect(two.stateFee).toBe(200);
      expect(two.niprFee).toBe(5.6);
      expect(two.total).toBeCloseTo(205.6, 10);
    } finally {
      delete FEES.__TEST__;
    }
  });

  it('does not multiply a per-licence state', () => {
    expect(resolveFee('OH', 'FL', { loaCount: 3, asOf: AS_OF }).stateFee).toBe(10);
  });
});

describe('Illinois', () => {
  it('is flagged variable because the fee prorates to expiration', () => {
    const r = resolveFee('IL', 'FL', { asOf: AS_OF });
    expect(r.variable).toBe(true);
    expect(r.note).toMatch(/prorat/i);
    expect(r.stateFee).toBe(331.07);
  });
});

describe('staleness', () => {
  it('counts days and trips only past 180', () => {
    expect(daysSince('2026-09-08', AS_OF)).toBe(0);
    expect(isStale('2026-09-08', AS_OF)).toBe(false);
    expect(isStale('2026-03-12', AS_OF)).toBe(false); // exactly 180
    expect(isStale('2026-03-11', AS_OF)).toBe(true); // 181
  });
});

describe('dataset integrity', () => {
  it('covers all 51 jurisdictions, Wyoming included', () => {
    expect(STATES).toHaveLength(51);
    const wy = STATES.find(s => s.code === 'WY');
    expect(wy?.population).toBeGreaterThan(0);
    expect(wy?.seniors).toBeGreaterThan(0);
  });

  it('has a fee record or a deliberate gap for every state, and no orphans', () => {
    const codes = new Set(STATES.map(s => s.code));
    for (const code of Object.keys(FEES)) {
      expect(codes.has(code), `${code} in FEES but not in STATES`).toBe(true);
    }
    const missing = STATES.filter(s => !FEES[s.code])
      .map(s => s.code)
      .sort();
    expect(missing).toEqual(['AK', 'HI', 'MO', 'NV', 'NY']);
  });

  it('carries a source URL and verification date on every fee', () => {
    for (const [code, rec] of Object.entries(FEES)) {
      expect(rec.sourceUrl, code).toMatch(/^https:\/\//);
      expect(rec.verifiedOn, code).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
