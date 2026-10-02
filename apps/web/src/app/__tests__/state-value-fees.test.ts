import { describe, expect, it } from 'vitest';

import {
  DATA,
  JURISDICTIONS,
  NIPR_TRANSACTION_FEE,
  STALE_AFTER_DAYS,
  daysSince,
  isStale,
  jurisdiction,
  resolveFee,
} from '../state-value/fees';
import { REGION_BY_CODE } from '../state-value/regions';

const AS_OF = new Date('2026-09-08T00:00:00Z');
const CODES = JURISDICTIONS.map(j => j.code);
const RETALIATORY = ['IN', 'NE', 'NY', 'TN', 'VT'];

describe('the data drop', () => {
  it('covers 51 jurisdictions with unique codes', () => {
    expect(JURISDICTIONS).toHaveLength(51);
    expect(new Set(CODES).size).toBe(51);
  });

  it('is retaliatory in exactly the five stated jurisdictions', () => {
    expect(
      JURISDICTIONS.filter(j => j.isRetaliatory)
        .map(j => j.code)
        .sort()
    ).toEqual(RETALIATORY);
  });

  it('has no fallback fee anywhere — nothing is pending', () => {
    expect(JURISDICTIONS.some(j => j.feeIsFallback)).toBe(false);
  });

  it('carries a source URL and verification date on every record', () => {
    for (const j of JURISDICTIONS) {
      expect(j.sourceUrl, j.code).toMatch(/^https:\/\//);
      expect(j.lastVerified, j.code).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('leaves flatFee null only for the retaliatory five, which resolve by schedule', () => {
    expect(
      JURISDICTIONS.filter(j => j.flatFee === null)
        .map(j => j.code)
        .sort()
    ).toEqual(RETALIATORY);
    for (const j of JURISDICTIONS.filter(x => !x.isRetaliatory)) {
      expect(j.flatFee, j.code).toBeGreaterThan(0);
    }
  });

  it('assigns a census region to every jurisdiction', () => {
    for (const code of CODES) expect(REGION_BY_CODE[code], code).toBeDefined();
    expect(Object.keys(REGION_BY_CODE).sort()).toEqual([...CODES].sort());
  });
});

describe('retaliatory schedules', () => {
  it('exist for exactly the retaliatory jurisdictions', () => {
    expect(Object.keys(DATA.retaliatorySchedules).sort()).toEqual(RETALIATORY);
  });

  /**
   * The load-bearing one. resolveFee throws on a schedule miss rather than
   * falling back, so a single absent row is a crash in the agent's face.
   */
  it('each carry a row for all 50 other jurisdictions, and none for themselves', () => {
    for (const target of RETALIATORY) {
      const schedule = DATA.retaliatorySchedules[target];
      const expected = CODES.filter(c => c !== target).sort();
      expect(Object.keys(schedule).sort(), target).toEqual(expected);
      expect(schedule[target], `${target} should not price itself`).toBeUndefined();
      for (const [resident, fee] of Object.entries(schedule)) {
        expect(Number.isFinite(fee), `${target}/${resident}`).toBe(true);
        expect(fee, `${target}/${resident}`).toBeGreaterThan(0);
      }
    }
  });

  it('resolves every (target, resident) pair without throwing', () => {
    let pairs = 0;
    for (const target of CODES) {
      for (const resident of CODES) {
        if (target === resident) continue;
        expect(() => resolveFee(target, resident), `${target} from ${resident}`).not.toThrow();
        pairs++;
      }
    }
    expect(pairs).toBe(51 * 50);
  });
});

describe('NIPR transaction fee', () => {
  it('is 5.60, read from the drop', () => {
    expect(NIPR_TRANSACTION_FEE).toBe(5.6);
  });

  it('is added exactly once regardless of lines of authority', () => {
    expect(resolveFee('OH', 'FL', { loaCount: 1 }).niprFee).toBe(5.6);
    expect(resolveFee('CA', 'FL', { loaCount: 4 }).niprFee).toBe(5.6);
  });
});

describe('flat jurisdictions', () => {
  it('charge the posted fee whoever is asking', () => {
    const fromFL = resolveFee('OH', 'FL');
    const fromTX = resolveFee('OH', 'TX');
    expect(fromFL.basis).toBe('flat');
    expect(fromFL.stateFee).toBe(10);
    expect(fromFL.total).toBeCloseTo(15.6, 10);
    expect(fromTX.total).toBe(fromFL.total);
  });

  it('treats Iowa and South Dakota as flat — not retaliatory on new applications', () => {
    expect(jurisdiction('IA')?.isRetaliatory).toBe(false);
    expect(jurisdiction('SD')?.isRetaliatory).toBe(false);
    expect(resolveFee('IA', 'CA').stateFee).toBe(50);
    expect(resolveFee('IA', 'OH').stateFee).toBe(50);
    expect(resolveFee('SD', 'CA').stateFee).toBe(30);
    expect(resolveFee('SD', 'OH').stateFee).toBe(30);
  });
});

describe('retaliatory jurisdictions', () => {
  it('charge by the applicant home state, so the same target varies', () => {
    const fromOH = resolveFee('VT', 'OH');
    const fromIL = resolveFee('VT', 'IL');
    expect(fromOH.basis).toBe('retaliatory');
    expect(fromOH.stateFee).toBe(60);
    expect(fromIL.stateFee).toBe(380);
    expect(fromIL.stateFee).toBeGreaterThan(fromOH.stateFee);
  });

  it('never derives a fee from max() of the two states', () => {
    // Ohio posts 10 and Vermont's schedule charges an Ohio resident 60.
    // A max() rule would say 10 in Ohio's direction and 10-vs-null here.
    expect(resolveFee('OH', 'VT').stateFee).toBe(10);
    expect(resolveFee('VT', 'OH').stateFee).toBe(60);
  });

  it('honours the Tennessee $50 floor', () => {
    expect(Math.min(...Object.values(DATA.retaliatorySchedules.TN))).toBe(50);
    expect(resolveFee('TN', 'OH').stateFee).toBe(50); // Ohio posts only 10
  });

  it('honours the Nebraska $100 floor and has dropped the old $50 base', () => {
    const ne = DATA.retaliatorySchedules.NE;
    expect(Math.min(...Object.values(ne))).toBe(100);
    expect(Object.values(ne)).not.toContain(50);
    expect(jurisdiction('NE')?.flatFee).toBeNull();
    expect(resolveFee('NE', 'OH').stateFee).toBe(100);
  });

  it('prices Indiana from its schedule, which folds in the $90 base', () => {
    expect(jurisdiction('IN')?.flatFee).toBeNull();
    expect(resolveFee('IN', 'OH').stateFee).toBe(90);
    expect(resolveFee('IN', 'CA').stateFee).toBe(188);
  });
});

describe('resolveFee refuses to guess', () => {
  it('throws on an unknown jurisdiction', () => {
    expect(() => resolveFee('ZZ', 'FL')).toThrow(/No licensing record/);
  });

  it('throws when asked for the resident state itself', () => {
    expect(() => resolveFee('FL', 'FL')).toThrow(/resident state/);
  });

  it('throws on a schedule miss rather than falling back to a base rate', () => {
    const original = DATA.retaliatorySchedules.VT.OH;
    delete (DATA.retaliatorySchedules.VT as Record<string, number>).OH;
    try {
      expect(() => resolveFee('VT', 'OH')).toThrow(/no row for resident state OH/);
    } finally {
      DATA.retaliatorySchedules.VT.OH = original;
    }
  });
});

describe('per line of authority', () => {
  it('is set on exactly the seven stated jurisdictions', () => {
    expect(
      JURISDICTIONS.filter(j => j.perLineOfAuthority)
        .map(j => j.code)
        .sort()
    ).toEqual(['CA', 'CO', 'GA', 'KY', 'MN', 'NC', 'WI']);
    expect(jurisdiction('HI')?.perLineOfAuthority).toBe(false);
    expect(jurisdiction('WY')?.perLineOfAuthority).toBe(false);
  });

  it('multiplies the state portion only', () => {
    const two = resolveFee('CA', 'FL', { loaCount: 2 });
    expect(two.stateFee).toBe(376); // 188 x 2
    expect(two.niprFee).toBe(5.6);
    expect(two.total).toBeCloseTo(381.6, 10);
  });

  it('leaves a per-licence jurisdiction alone', () => {
    expect(resolveFee('OH', 'FL', { loaCount: 3 }).stateFee).toBe(10);
  });
});

describe('variable jurisdictions', () => {
  it('are exactly Illinois and New York', () => {
    expect(
      JURISDICTIONS.filter(j => j.prorated)
        .map(j => j.code)
        .sort()
    ).toEqual(['IL', 'NY']);
  });

  it('surface both the same way, through the prorated flag', () => {
    expect(resolveFee('IL', 'FL').prorated).toBe(true);
    expect(resolveFee('NY', 'FL').prorated).toBe(true);
    expect(resolveFee('OH', 'FL').prorated).toBe(false);
  });

  it('carries Illinois at its full-term upper bound', () => {
    expect(jurisdiction('IL')?.flatFee).toBe(380);
    expect(DATA.notes.illinois).toMatch(/331\.07/);
  });

  it('documents the New York per-LOA add-on states in notes', () => {
    expect(DATA.notes.newYork).toMatch(/CO, MN, MS, OK and WI/);
  });
});

describe('staleness', () => {
  it('counts days and trips only past 180', () => {
    expect(daysSince('2026-09-08', AS_OF)).toBe(0);
    expect(isStale('2026-09-08', AS_OF)).toBe(false);
    expect(isStale('2026-03-12', AS_OF)).toBe(false); // exactly 180
    expect(isStale('2026-03-11', AS_OF)).toBe(true); // 181
    expect(STALE_AFTER_DAYS).toBe(180);
  });
});

describe('Wyoming', () => {
  it('carries the ACS-derived senior figure and its own DOI source', () => {
    const wy = jurisdiction('WY');
    expect(wy?.seniorPopulation55to80).toBe(155000);
    expect(wy?.flatFee).toBe(150);
    expect(wy?.sourceUrl).toContain('doi.wyo.gov');
  });
});
