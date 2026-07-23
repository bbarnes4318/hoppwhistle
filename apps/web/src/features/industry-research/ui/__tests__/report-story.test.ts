import type { StructuredReport } from '@hopwhistle/shared';
import { describe, expect, it } from 'vitest';

import {
  buildBriefingScript,
  capitalVsSpeed,
  opportunityBars,
  riskMatrixCells,
  verdictPhrase,
} from '../report-story';

function makeReport(): StructuredReport {
  return {
    reportMetadata: {
      researchRunId: 'r',
      researchBriefId: 'b',
      industry: 'Commercial HVAC service',
      geography: 'Tennessee',
      mode: 'full_due_diligence',
      generatedAt: '2026-07-19',
      synthesisProvider: 'anthropic',
      synthesisModel: 'claude-opus-4-8',
      schemaVersion: '2.0.0',
    },
    executiveVerdict: {
      verdict: 'CONDITIONAL_GO',
      overallScore: 62,
      confidence: 0.78,
      bestSegment: 'property managers',
      bestCustomer: 'property managers with 5-100 locations',
      bestBusinessModel: 'recurring maintenance contracts',
      timeToFirstRevenue: '30-60 days',
      initialCapital: '$15k-$25k',
      biggestOpportunity: 'managed maintenance service',
      biggestRisk: 'Technician availability may restrict growth',
      oneSentenceConclusion: 'Enter via a tightly defined territory.',
    },
    assumptions: [],
    sections: [
      {
        key: 'execution',
        title: '90-Day Execution Plan',
        markdown: 'Validate demand by signing three pilot maintenance agreements before hiring.',
      },
    ],
    competitors: [],
    unitEconomicsScenarios: [{ name: 'base', grossMargin: '39%', paybackPeriod: '5 months' }],
    rankedOpportunities: [
      {
        rank: 1,
        opportunity: 'Recurring maintenance contracts',
        customer: 'Property managers',
        revenueModel: 'Subscription',
        offer: 'Managed service',
        price: '$7,200/yr',
        startupCost: '$20k',
        timeToFirstRevenue: '30 days',
        salesDifficulty: 'Moderate',
        opportunityScore: 72,
      },
      {
        rank: 2,
        opportunity: 'Emergency repair on-call',
        customer: 'Facilities',
        revenueModel: 'Per-job',
        startupCost: '$8k',
        timeToFirstRevenue: '60 days',
        salesDifficulty: 'Hard',
        opportunityScore: 55,
      },
    ],
    killCriteria: ['Customer acquisition cost remains above $2,000 after the first 20 accounts'],
    contradictions: [],
    unknowns: [],
    evidenceLedger: [],
    sources: [],
    confidenceAssessment: 'moderate',
  } as StructuredReport;
}

describe('verdictPhrase', () => {
  it('maps verdicts to spoken phrases', () => {
    expect(verdictPhrase('GO')).toBe('a GO');
    expect(verdictPhrase('DO_NOT_ENTER')).toBe('a DO-NOT-ENTER');
    expect(verdictPhrase('CONDITIONAL_GO')).toBe('a CONDITIONAL GO');
  });
});

describe('buildBriefingScript — real data, tight, no filler', () => {
  const rep = makeReport();

  it('executive briefing uses the verdict, score, and best opportunity', () => {
    const s = buildBriefingScript(rep, 'executive');
    expect(s).toContain('Commercial HVAC service');
    expect(s).toContain('CONDITIONAL GO');
    expect(s).toContain('62 out of 100');
    expect(s).toContain('78 percent');
    expect(s).toContain('managed maintenance service');
    // tight: roughly 40–230 words
    const words = s.split(/\s+/).length;
    expect(words).toBeGreaterThan(35);
    expect(words).toBeLessThan(240);
  });

  it('opportunity briefing centers the #1 opportunity and its economics', () => {
    const s = buildBriefingScript(rep, 'opportunity');
    expect(s).toContain('Recurring maintenance contracts');
    expect(s).toContain('72');
    expect(s.toLowerCase()).toContain('property managers');
  });

  it('risk briefing surfaces the biggest risk and a kill criterion', () => {
    const s = buildBriefingScript(rep, 'risk');
    expect(s.toLowerCase()).toContain('technician availability');
    expect(s.toLowerCase()).toContain('walk away');
  });

  it('execution briefing gives a first action and 30/60/90 arc', () => {
    const s = buildBriefingScript(rep, 'execution');
    expect(s).toContain('First,');
    expect(s).toContain('30 days');
    expect(s).toContain('day 90');
  });

  it('contains no AI disclaimers', () => {
    for (const m of ['executive', 'opportunity', 'risk', 'execution'] as const)
      expect(buildBriefingScript(rep, m).toLowerCase()).not.toMatch(
        /as an ai|language model|i cannot/
      );
  });
});

describe('chart data derivations — only when supported', () => {
  it('opportunityBars returns ranked scores when ≥2 opportunities', () => {
    const bars = opportunityBars(makeReport());
    expect(bars.length).toBe(2);
    expect(bars[0].value).toBe(72);
  });
  it('opportunityBars is empty with <2 opportunities', () => {
    const rep = makeReport();
    rep.rankedOpportunities = rep.rankedOpportunities.slice(0, 1);
    expect(opportunityBars(rep)).toHaveLength(0);
  });
  it('capitalVsSpeed parses capital + months, requires ≥2 parseable points', () => {
    const pts = capitalVsSpeed(makeReport());
    expect(pts.length).toBe(2);
    expect(pts[0].capital).toBe(20000);
    expect(pts[0].months).toBeCloseTo(1, 0); // 30 days ≈ 1 month
  });
  it('riskMatrixCells returns one cell per risk row', () => {
    const cells = riskMatrixCells(makeReport(), null);
    expect(cells.length).toBeGreaterThan(0);
    expect(cells[0]).toHaveProperty('probability');
    expect(cells[0]).toHaveProperty('impact');
  });
});
