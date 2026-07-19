import { adversarialVerificationSchema, type StructuredReport } from '@hopwhistle/shared';
import { describe, expect, it } from 'vitest';

import {
  applyPatchSet,
  decideReverifyScope,
  gatherDefects,
  sanitizeSourceRefs,
} from '../orchestrator';
import { jsonFromText, safeJson } from '../providers';

// A tiny but schema-shaped report for deterministic patch tests.
function makeReport(): StructuredReport {
  return {
    reportMetadata: {
      researchRunId: 'run-1',
      researchBriefId: 'brief-1',
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
      bestCustomer: 'Owner-operators',
      bestBusinessModel: 'Productized service',
      timeToFirstRevenue: '30d',
      initialCapital: '$25k',
      biggestOpportunity: 'Automation',
      biggestRisk: 'CAC',
      oneSentenceConclusion: 'Enter narrow.',
    },
    assumptions: [],
    sections: [
      { key: 'overview', title: 'Overview', markdown: 'Original overview.' },
      { key: 'economics', title: 'Economics', markdown: 'Margins ~45%.' },
      { key: 'risk', title: 'Risk', markdown: 'Some risk.' },
      { key: 'competition', title: 'Competition', markdown: 'Crowded.' },
    ],
    competitors: [],
    unitEconomicsScenarios: [],
    rankedOpportunities: [],
    killCriteria: [],
    contradictions: [],
    unknowns: [],
    evidenceLedger: [
      {
        claimId: 'c1',
        text: 'Market is $10B',
        category: 'market',
        classification: 'estimate',
        supportingSourceIds: [],
        contradictingSourceIds: [],
        provider: 'google',
        confidence: 0.5,
        materiality: 0.5,
      },
      {
        claimId: 'c2',
        text: 'Fabricated stat',
        category: 'market',
        classification: 'unverified_industry_claim',
        supportingSourceIds: [],
        contradictingSourceIds: [],
        provider: 'xai',
        confidence: 0.3,
        materiality: 0.4,
      },
    ],
    sources: [
      {
        sourceId: 'google-src-1',
        url: 'https://sec.gov/a',
        normalizedUrl: 'sec.gov/a',
        validated: true,
        provider: 'google',
      },
    ],
    confidenceAssessment: 'moderate',
  };
}

describe('gatherDefects', () => {
  it('passes through structured verifier defects and dedupes by id', () => {
    const defects = gatherDefects(
      {
        verdict: 'repair_required',
        confidence: 0.5,
        claimsChecked: 1,
        claimsSupported: 0,
        claimsPartiallySupported: 0,
        claimsUnsupported: 1,
        citationFailures: [],
        unsupportedClaims: [],
        misleadingClaims: [],
        outdatedSources: [],
        calculationErrors: [],
        missingEvidence: [],
        requiredRepairs: [],
        blockingDefects: [],
        defects: [
          {
            defectId: 'F1',
            severity: 'major',
            claimId: 'c2',
            problem: 'unsupported',
            requiredChange: 'remove it',
            affectedSourceIds: [],
            recommendationChanging: false,
          },
        ],
      },
      null,
      null
    );
    expect(defects).toHaveLength(1);
    expect(defects[0].claimId).toBe('c2');
  });

  it('synthesizes defects from legacy string arrays when structured defects are absent', () => {
    const defects = gatherDefects(
      {
        verdict: 'repair_required',
        confidence: 0.5,
        claimsChecked: 0,
        claimsSupported: 0,
        claimsPartiallySupported: 0,
        claimsUnsupported: 0,
        citationFailures: [],
        unsupportedClaims: [],
        misleadingClaims: [],
        outdatedSources: [],
        calculationErrors: [],
        missingEvidence: [],
        requiredRepairs: ['fix the CAC math'],
        blockingDefects: ['fabricated source'],
        defects: [],
      },
      null,
      null
    );
    expect(defects.length).toBe(2);
    expect(defects.some(d => d.severity === 'blocking')).toBe(true);
    expect(defects.some(d => d.problem === 'fix the CAC math')).toBe(true);
  });
});

describe('applyPatchSet — deterministic, targeted (no full regeneration)', () => {
  it('replaces only the patched section and leaves the rest byte-identical', () => {
    const r = makeReport();
    const { next, sectionsRepaired } = applyPatchSet(r, {
      sectionPatches: [{ key: 'economics', markdown: 'Corrected margins ~38%.' }],
      claimPatches: [],
      verdictPatch: null,
      reasonForVerdictChange: null,
    });
    expect(sectionsRepaired).toEqual(['economics']);
    expect(next.sections.find(s => s.key === 'economics')!.markdown).toBe(
      'Corrected margins ~38%.'
    );
    // Untouched sections are preserved.
    expect(next.sections.find(s => s.key === 'overview')!.markdown).toBe('Original overview.');
    expect(next.sections).toHaveLength(4);
  });

  it('edits a claim and removes a fabricated claim', () => {
    const r = makeReport();
    const { next, claimsRepaired } = applyPatchSet(r, {
      sectionPatches: [],
      claimPatches: [
        { claimId: 'c1', text: 'Market is $6B (revised)', confidence: 0.7 },
        { claimId: 'c2', remove: true },
      ],
      verdictPatch: null,
      reasonForVerdictChange: null,
    });
    expect(claimsRepaired).toContain('c1');
    expect(claimsRepaired).toContain('c2');
    expect(next.evidenceLedger).toHaveLength(1);
    expect(next.evidenceLedger[0].text).toBe('Market is $6B (revised)');
    expect(next.evidenceLedger[0].confidence).toBe(0.7);
  });

  it('never invents a claim for an unknown claimId', () => {
    const r = makeReport();
    const { next, claimsRepaired } = applyPatchSet(r, {
      sectionPatches: [],
      claimPatches: [{ claimId: 'does-not-exist', text: 'ghost' }],
      verdictPatch: null,
      reasonForVerdictChange: null,
    });
    expect(claimsRepaired).toHaveLength(0);
    expect(next.evidenceLedger).toHaveLength(2);
  });

  it('applies a verdict patch and flags the change', () => {
    const r = makeReport();
    const { next, verdictChanged } = applyPatchSet(r, {
      sectionPatches: [],
      claimPatches: [],
      verdictPatch: { verdict: 'DO_NOT_ENTER', overallScore: 30 },
      reasonForVerdictChange: 'Economics do not support entry',
    });
    expect(verdictChanged).toBe(true);
    expect(next.executiveVerdict.verdict).toBe('DO_NOT_ENTER');
    expect(next.executiveVerdict.overallScore).toBe(30);
  });
});

describe('sanitizeSourceRefs — strips dangling citations, never invents', () => {
  it('removes a supportingSourceId that is not present in the sources ledger', () => {
    const r = makeReport();
    r.evidenceLedger[0].supportingSourceIds = ['google-src-1', 'xai-src-22']; // 2nd is dangling
    r.evidenceLedger[1].contradictingSourceIds = ['ghost-9'];
    const clean = sanitizeSourceRefs(r);
    expect(clean.evidenceLedger[0].supportingSourceIds).toEqual(['google-src-1']);
    expect(clean.evidenceLedger[1].contradictingSourceIds).toEqual([]);
  });

  it('is a no-op when every citation resolves', () => {
    const r = makeReport();
    r.evidenceLedger[0].supportingSourceIds = ['google-src-1'];
    expect(sanitizeSourceRefs(r)).toBe(r); // same reference — unchanged
  });
});

describe('decideReverifyScope — targeted vs full re-verification', () => {
  it('targeted when a single non-core section changed', () => {
    const r = makeReport();
    const d = decideReverifyScope(r, ['competition'], ['c1'], false);
    expect(d.full).toBe(false);
    expect(d.scope.changedSections).toEqual(['competition']);
    expect(d.scope.changedClaims).toEqual(['c1']);
  });

  it('full when the verdict changed', () => {
    const r = makeReport();
    expect(decideReverifyScope(r, ['competition'], [], true).full).toBe(true);
  });

  it('full when a core economics section changed', () => {
    const r = makeReport();
    expect(decideReverifyScope(r, ['economics'], [], false).full).toBe(true);
  });

  it('full when more than 25% of sections changed', () => {
    const r = makeReport(); // 4 sections → 2 changed = 50%
    expect(decideReverifyScope(r, ['overview', 'competition'], [], false).full).toBe(true);
  });
});

// The custom JSON extractor is a defensive fallback; native structured output is
// primary. These assert the fallback parser handles the messy cases robustly.
describe('xAI adversarial verification parsing (defensive extractor + zod)', () => {
  const base = {
    verdict: 'pass_with_caveats',
    confidence: 0.7,
    webSearchUsed: true,
    xSearchUsed: true,
    codeExecutionUsed: false,
    missingRisks: ['churn'],
    contradictoryEvidence: [],
    overconfidentConclusions: [],
    operatorWarnings: [],
    customerWarnings: [],
    competitorResponses: [],
    economicWeaknesses: [],
    regulatoryWeaknesses: [],
    requiredRepairs: [],
    blockingDefects: [],
  };

  it('parses a clean JSON schema response', () => {
    const parsed = adversarialVerificationSchema.safeParse(safeJson(JSON.stringify(base)));
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.verdict).toBe('pass_with_caveats');
  });

  it('parses JSON embedded in analysis prose', () => {
    const text = `Here is my adversarial analysis. After searching, my verdict:\n${JSON.stringify(base)}\nThat concludes the review.`;
    const parsed = adversarialVerificationSchema.safeParse(safeJson(text));
    expect(parsed.success).toBe(true);
  });

  it('parses JSON with nested braces (a <think> block and inner objects)', () => {
    const withNested = {
      ...base,
      defects: [
        {
          defectId: 'A1',
          severity: 'major',
          problem: 'nested { braces } inside string',
          requiredChange: 'x',
          affectedSourceIds: [],
          recommendationChanging: false,
        },
      ],
    };
    const text = `<think>The report claims { margins } are high; I should verify.</think>\n\`\`\`json\n${JSON.stringify(withNested)}\n\`\`\``;
    const parsed = adversarialVerificationSchema.safeParse(safeJson(text));
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.defects?.[0].problem).toContain('braces');
  });

  it('fills defaults for a response missing optional fields (only verdict present)', () => {
    const parsed = adversarialVerificationSchema.safeParse(safeJson('{"verdict":"pass"}'));
    expect(parsed.success).toBe(true);
    // arrays default to []
    expect(parsed.success && parsed.data.missingRisks).toEqual([]);
    expect(parsed.success && parsed.data.webSearchUsed).toBe(false);
  });

  it('rejects a wrong field type (verdict not in enum)', () => {
    const bad = { ...base, verdict: 'looks_fine' };
    const parsed = adversarialVerificationSchema.safeParse(safeJson(JSON.stringify(bad)));
    expect(parsed.success).toBe(false);
  });

  it('safeJson returns {} for a truncated response, which fails schema validation', () => {
    const truncated = `{"verdict":"pass_with_caveats","missingRisks":["a","b`;
    const obj = safeJson(truncated);
    const parsed = adversarialVerificationSchema.safeParse(obj);
    // No complete object → {} → missing required verdict → invalid (caller throws).
    expect(parsed.success).toBe(false);
  });

  it('throws (via jsonFromText) on a provider refusal with no JSON at all', () => {
    expect(() => jsonFromText('I cannot complete this request.')).toThrow();
    // and safeJson degrades to {} which fails validation
    expect(adversarialVerificationSchema.safeParse(safeJson('I refuse.')).success).toBe(false);
  });
});
