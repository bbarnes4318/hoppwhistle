import type { AdversarialVerification, StructuredReport } from '@hopwhistle/shared';
import { describe, expect, it } from 'vitest';

import {
  buildRiskRegister,
  deriveEconomicVerdict,
  deriveProbability,
  firstSectionSentence,
  NOT_ESTABLISHED,
  splitHighlight,
} from '../report-helpers';

function makeReport(over: Partial<StructuredReport> = {}): StructuredReport {
  return {
    reportMetadata: {
      researchRunId: 'r',
      researchBriefId: 'b',
      industry: 'HVAC',
      geography: 'US',
      mode: 'full_due_diligence',
      generatedAt: '2026-07-19',
      synthesisProvider: 'anthropic',
      synthesisModel: 'claude-opus-4-8',
      schemaVersion: '2.0.0',
    },
    executiveVerdict: {
      verdict: 'CONDITIONAL_GO',
      overallScore: 60,
      confidence: 0.6,
      bestSegment: 'SMB',
      bestCustomer: 'Owners',
      bestBusinessModel: 'Service',
      timeToFirstRevenue: '30d',
      initialCapital: '$25k',
      biggestOpportunity: 'Automation',
      biggestRisk: 'Technician shortage is a common constraint for growth',
      oneSentenceConclusion: 'Enter narrow.',
    },
    assumptions: [],
    sections: [
      {
        key: 'economics',
        title: 'Economics',
        markdown: 'Margins around 40%. Payback in 6 months.',
      },
      {
        key: 'execution',
        title: '90-Day Execution Plan',
        markdown: 'Build an apprenticeship pipeline to keep technicians available and utilized.',
      },
    ],
    competitors: [],
    unitEconomicsScenarios: [
      {
        name: 'base',
        asp: '$7,200',
        grossMargin: '39%',
        cac: '$1,300',
        paybackPeriod: '5 months',
        notes: 'Viable only if recurring contracts exceed 55% of revenue.',
      },
    ],
    rankedOpportunities: [],
    killCriteria: ['Technician fill rate stays below 70% after month four'],
    contradictions: [],
    unknowns: [],
    evidenceLedger: [],
    sources: [],
    confidenceAssessment: 'moderate',
    ...over,
  } as StructuredReport;
}

describe('deriveProbability', () => {
  it('reads explicit likelihood language', () => {
    expect(deriveProbability('This is a common and recurring problem')).toBe('Likely');
    expect(deriveProbability('This rarely happens')).toBe('Low');
    expect(deriveProbability('Occasional seasonal dips')).toBe('Possible');
  });
  it('returns Not established when no likelihood is stated', () => {
    expect(deriveProbability('Margins may compress over time')).toBe(NOT_ESTABLISHED);
  });
});

describe('deriveEconomicVerdict', () => {
  it('Unattractive for DO_NOT_ENTER', () => {
    const rep = makeReport();
    rep.executiveVerdict.verdict = 'DO_NOT_ENTER';
    expect(deriveEconomicVerdict(rep).label).toBe('Unattractive');
  });
  it('Attractive for GO with high score', () => {
    const rep = makeReport();
    rep.executiveVerdict.verdict = 'GO';
    rep.executiveVerdict.overallScore = 78;
    expect(deriveEconomicVerdict(rep).label).toBe('Attractive');
  });
  it('Conditional otherwise, and uses base scenario notes as the sentence', () => {
    const rep = makeReport();
    const ev = deriveEconomicVerdict(rep);
    expect(ev.label).toBe('Conditional');
    expect(ev.sentence).toContain('recurring contracts exceed 55%');
  });
});

describe('buildRiskRegister', () => {
  const adversarial = {
    economicWeaknesses: ['Working-capital demands may rise faster than collections'],
    regulatoryWeaknesses: [],
    operatorWarnings: ['Scheduling is often chaotic in peak season'],
    customerWarnings: [],
    blockingDefects: [],
  } as unknown as AdversarialVerification;

  it('produces six-field rows grounded in evidence or Not established', () => {
    const rows = buildRiskRegister(makeReport(), adversarial);
    expect(rows.length).toBeGreaterThan(0);
    const row = rows[0];
    // every field exists
    for (const k of ['risk', 'probability', 'impact', 'ability', 'mitigation', 'trigger'] as const)
      expect(typeof row[k]).toBe('string');
    // biggestRisk is impact High and reads as Likely (contains "common")
    expect(row.impact).toBe('High');
    expect(row.probability).toBe('Likely');
    // trigger pulled from a matching kill criterion (shares "technician")
    expect(row.trigger.toLowerCase()).toContain('technician');
    // ability is honestly Not established (no data)
    expect(row.ability).toBe(NOT_ESTABLISHED);
  });

  it('softer warnings get Not established impact, not an invented value', () => {
    const rows = buildRiskRegister(makeReport(), adversarial);
    const opWarn = rows.find(r => r.risk.includes('Scheduling'));
    expect(opWarn?.impact).toBe(NOT_ESTABLISHED);
  });
});

describe('firstSectionSentence', () => {
  it('returns the first readable sentence of a matching section', () => {
    expect(firstSectionSentence(makeReport(), /execution/i)).toContain('apprenticeship');
  });
  it('returns null when no section matches', () => {
    expect(firstSectionSentence(makeReport(), /nonexistent-section/i)).toBeNull();
  });
});

describe('splitHighlight', () => {
  it('marks case-insensitive matches and leaves the rest plain', () => {
    const parts = splitHighlight('Hello WORLD world', 'world');
    expect(parts.filter(p => p.mark).length).toBe(2);
    expect(parts.map(p => p.text).join('')).toBe('Hello WORLD world');
  });
  it('returns a single plain part for an empty query', () => {
    const parts = splitHighlight('anything', '');
    expect(parts).toEqual([{ text: 'anything', mark: false }]);
  });
});
