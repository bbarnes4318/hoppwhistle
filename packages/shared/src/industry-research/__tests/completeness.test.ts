import { describe, expect, it } from 'vitest';

import { formatCompleteness, scoreStructuredCompleteness } from '../completeness';
import type { StructuredReport } from '../types';

/** Minimal report shell — only the fields the scorer reads matter here. */
function report(partial: Partial<StructuredReport>): StructuredReport {
  return {
    rankedOpportunities: [],
    unitEconomicsScenarios: [],
    competitors: [],
    ...partial,
  } as unknown as StructuredReport;
}

describe('scoreStructuredCompleteness', () => {
  it('reports 0 with nothing to score', () => {
    const c = scoreStructuredCompleteness(report({}));
    expect(c.score).toBe(0);
    expect(c.total).toBe(0);
    expect(c.missing).toEqual([]);
  });

  it('counts a names-only object as almost entirely missing (the real-world bug)', () => {
    const c = scoreStructuredCompleteness(
      report({
        rankedOpportunities: [{ rank: 1, opportunity: 'Recurring cleaning', opportunityScore: 72 }],
        unitEconomicsScenarios: [{ name: 'base' }],
        competitors: [{ name: 'Austin Gutter King' }],
      } as unknown as Partial<StructuredReport>)
    );
    // 11 opportunity + 6 scenario + 6 competitor detail fields, none filled.
    expect(c.total).toBe(23);
    expect(c.filled).toBe(0);
    expect(c.score).toBe(0);
    expect(c.missing).toContain('rankedOpportunities[0].startupCost');
    expect(c.missing).toContain('unitEconomicsScenarios[0].grossMargin');
    expect(c.missing).toContain('competitors[0].vulnerability');
  });

  it('counts filled detail and tracks explicit unknowns separately', () => {
    const c = scoreStructuredCompleteness(
      report({
        unitEconomicsScenarios: [
          {
            name: 'base',
            asp: '$180',
            grossMargin: '55-65%',
            cac: '$40',
            paybackPeriod: '1 job',
            ltv: '$900',
            notes: 'unknown - churn not established',
          },
        ],
      } as unknown as Partial<StructuredReport>)
    );
    expect(c.filled).toBe(6);
    expect(c.total).toBe(6);
    expect(c.score).toBe(1);
    expect(c.unknowns).toBe(1);
    expect(c.missing).toEqual([]);
  });

  it('treats blank and whitespace-only values as missing', () => {
    const c = scoreStructuredCompleteness(
      report({
        competitors: [
          {
            name: 'X',
            targetCustomer: '   ',
            offer: '',
            pricing: 'from $150',
            strengths: 'brand',
            weaknesses: 'slow',
            vulnerability: 'no weekend service',
          },
        ],
      } as unknown as Partial<StructuredReport>)
    );
    expect(c.filled).toBe(4);
    expect(c.missing).toContain('competitors[0].targetCustomer');
    expect(c.missing).toContain('competitors[0].offer');
  });

  it('formats a readable one-line summary', () => {
    const c = scoreStructuredCompleteness(
      report({
        competitors: [{ name: 'X', targetCustomer: 'homeowners' }],
      } as unknown as Partial<StructuredReport>)
    );
    expect(formatCompleteness(c)).toMatch(/structured completeness \d+%/);
  });
});
