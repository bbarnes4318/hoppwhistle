import type { AdversarialVerification, EvidenceSource, StructuredReport } from '@hopwhistle/shared';
import { describe, expect, it } from 'vitest';

import {
  buildRiskRegister,
  buildSourcePreview,
  collectSearchableRegions,
  deriveEconomicVerdict,
  deriveProbability,
  domainOf,
  firstSectionSentence,
  NOT_ESTABLISHED,
  regionMatches,
  splitHighlight,
  stepIndex,
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
      bestCustomer: 'Property managers',
      bestBusinessModel: 'Managed service',
      timeToFirstRevenue: '30d',
      initialCapital: '$20k',
      biggestOpportunity: 'Recurring maintenance automation',
      biggestRisk: 'Technician shortage is a common constraint for growth',
      oneSentenceConclusion: 'Enter narrow.',
    },
    assumptions: [],
    sections: [
      {
        key: 'thesis',
        title: 'Recommended Entry Thesis',
        markdown:
          'Launch a recurring maintenance service targeting property managers with 5-100 locations.',
      },
      {
        key: 'execution',
        title: '90-Day Execution Plan',
        markdown:
          'We will require ACH deposit terms to reduce collections risk and manage working-capital pressure. Build an apprenticeship pipeline for technicians.',
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
        ltv: '$6,500',
        notes: 'Viable only if recurring contracts exceed 55% of revenue.',
      },
    ],
    rankedOpportunities: [
      {
        rank: 1,
        opportunity: 'Recurring maintenance contracts',
        customer: 'Property managers',
        offer: 'Managed service',
        revenueModel: 'Subscription',
        startupCost: '$20k',
        timeToFirstRevenue: '30d',
        salesDifficulty: 'Moderate',
        opportunityScore: 72,
      },
    ],
    killCriteria: ['Technician fill rate stays below 70% after month four'],
    contradictions: [],
    unknowns: [],
    evidenceLedger: [],
    sources: [],
    confidenceAssessment: 'moderate',
    ...over,
  } as StructuredReport;
}

const adversarial = {
  economicWeaknesses: [
    'Slow collections raise working-capital needs',
    'Recurring revenue depends on retention and could fall if churn rises',
  ],
  regulatoryWeaknesses: [],
  operatorWarnings: ['Scheduling is often chaotic in peak season'],
  customerWarnings: [],
  blockingDefects: [],
} as unknown as AdversarialVerification;

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

describe('deriveEconomicVerdict — economics-driven, not verdict-driven', () => {
  it('Not established when too few economic signals and no notes', () => {
    const rep = makeReport({
      unitEconomicsScenarios: [{ name: 'base', grossMargin: '39%' }],
    });
    expect(deriveEconomicVerdict(rep).label).toBe('Not established');
  });
  it('Conditional when base notes are conditional (only if…)', () => {
    const ev = deriveEconomicVerdict(makeReport());
    expect(ev.label).toBe('Conditional');
    expect(ev.sentence).toContain('recurring contracts exceed 55%');
  });
  it('Attractive from strong economics EVEN IF the overall verdict is DO_NOT_ENTER', () => {
    const rep = makeReport({
      unitEconomicsScenarios: [
        {
          name: 'base',
          grossMargin: '50%',
          paybackPeriod: '3 months',
          cac: '$1,000',
          ltv: '$8,000',
        },
      ],
    });
    rep.executiveVerdict.verdict = 'DO_NOT_ENTER';
    expect(deriveEconomicVerdict(rep).label).toBe('Attractive');
  });
  it('Unattractive from weak economics EVEN IF the overall verdict is GO', () => {
    const rep = makeReport({
      unitEconomicsScenarios: [{ name: 'base', grossMargin: '18%', paybackPeriod: '20 months' }],
    });
    rep.executiveVerdict.verdict = 'GO';
    expect(deriveEconomicVerdict(rep).label).toBe('Unattractive');
  });
});

describe('buildRiskRegister — six fields, strict mitigation', () => {
  it('maps probability/impact/trigger from evidence', () => {
    const rows = buildRiskRegister(makeReport(), adversarial);
    const tech = rows.find(r => r.risk.startsWith('Technician shortage'))!;
    for (const k of ['risk', 'probability', 'impact', 'ability', 'mitigation', 'trigger'] as const)
      expect(typeof tech[k]).toBe('string');
    expect(tech.impact).toBe('High');
    expect(tech.probability).toBe('Likely');
    expect(tech.trigger.toLowerCase()).toContain('technician');
    expect(tech.ability).toBe(NOT_ESTABLISHED);
    // no action+overlap sentence for the technician risk → honest Not established
    expect(tech.mitigation).toBe(NOT_ESTABLISHED);
  });
  it('only populates Mitigation with real action language + ≥2 shared terms', () => {
    const rows = buildRiskRegister(makeReport(), adversarial);
    const collections = rows.find(r => r.risk.startsWith('Slow collections'))!;
    expect(collections.mitigation).toContain('ACH'); // require/reduce/manage + collections/working/capital
  });
  it('softer warnings get Not established impact, never invented', () => {
    const rows = buildRiskRegister(makeReport(), adversarial);
    const opWarn = rows.find(r => r.risk.includes('Scheduling'))!;
    expect(opWarn.impact).toBe(NOT_ESTABLISHED);
  });
});

describe('comprehensive report search — found and navigable', () => {
  it('matches "recurring" across decision, economics, opportunity, and risk regions', () => {
    const regions = collectSearchableRegions(makeReport(), adversarial);
    const matches = regionMatches(regions, 'recurring');
    expect(matches.length).toBeGreaterThan(0);
    const hitRegions = new Set(matches.map(m => m.region));
    for (const region of ['decision', 'economics', 'opportunity', 'risk'] as const)
      expect(hitRegions.has(region)).toBe(true);
  });
  it('Previous/Next navigation wraps around the full match list', () => {
    const regions = collectSearchableRegions(makeReport(), adversarial);
    const total = regionMatches(regions, 'recurring').length;
    expect(total).toBeGreaterThan(1);
    expect(stepIndex(total, 0, 1)).toBe(1);
    expect(stepIndex(total, total - 1, 1)).toBe(0); // Next wraps to first
    expect(stepIndex(total, 0, -1)).toBe(total - 1); // Previous wraps to last
  });
  it('no query yields no matches', () => {
    expect(regionMatches(collectSearchableRegions(makeReport(), adversarial), '')).toHaveLength(0);
  });
});

describe('firstSectionSentence', () => {
  it('returns the first readable sentence of a matching section', () => {
    expect(firstSectionSentence(makeReport(), /execution/i)).toContain('require ACH');
  });
  it('returns null when no section matches', () => {
    expect(firstSectionSentence(makeReport(), /nonexistent-section/i)).toBeNull();
  });
});

describe('source preview — only available metadata, honest fallbacks', () => {
  it('maps available fields and reports no preview text', () => {
    const s = {
      sourceId: 'x',
      title: 'SEC filing',
      url: 'https://www.sec.gov/edgar/x',
      publisher: 'SEC',
      publishedDate: '2026-02-01',
      sourceType: 'regulatory',
      validated: true,
      validationNote: 'URL syntactically valid',
      provider: 'google',
      normalizedUrl: 'sec.gov/edgar/x',
    } as EvidenceSource;
    const p = buildSourcePreview(s);
    expect(p.title).toBe('SEC filing');
    expect(p.domain).toBe('SEC');
    expect(p.publishedDate).toBe('2026-02-01');
    expect(p.sourceType).toBe('regulatory');
    expect(p.validation).toContain('Validated');
    expect(p.provider).toBe('google');
    expect(p.previewText).toBeNull();
  });
  it('uses Not established for missing metadata and the domain when no publisher', () => {
    const s = {
      sourceId: 'y',
      url: 'https://www.example.com/a',
      validated: false,
      provider: 'xai',
      normalizedUrl: 'example.com/a',
    } as EvidenceSource;
    const p = buildSourcePreview(s);
    expect(p.title).toBe(NOT_ESTABLISHED);
    expect(p.publishedDate).toBe(NOT_ESTABLISHED);
    expect(p.sourceType).toBe(NOT_ESTABLISHED);
    expect(p.domain).toBe('example.com');
    expect(p.validation).toBe('Unverified');
  });
  it('domainOf strips protocol and www', () => {
    expect(domainOf('https://www.sec.gov/x')).toBe('sec.gov');
  });
});

describe('splitHighlight', () => {
  it('marks case-insensitive matches and leaves the rest plain', () => {
    const parts = splitHighlight('Hello WORLD world', 'world');
    expect(parts.filter(p => p.mark).length).toBe(2);
    expect(parts.map(p => p.text).join('')).toBe('Hello WORLD world');
  });
  it('returns a single plain part for an empty query', () => {
    expect(splitHighlight('anything', '')).toEqual([{ text: 'anything', mark: false }]);
  });
});
