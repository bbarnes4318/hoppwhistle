import { describe, it, expect } from 'vitest';

import * as sharedIndex from '../index.js';
import {
  SCHEMA_VERSION,
  buildProviderRegistry,
  canonicalizeUrl,
  computeActualCost,
  estimateRunCost,
  budgetFits,
  isValidHttpUrl,
  normalizeBrief,
  preflightRun,
  researchBriefInputSchema,
  resolveAssignments,
  resolveCapabilityLabels,
  roleFallbacks,
  structuredReportSchema,
  RESEARCH_MODES,
  type ResearchBriefInput,
  type StructuredReport,
} from '../index.js';

const LIVE = {
  GEMINI_API_KEY: 'k',
  PERPLEXITY_API_KEY: 'k',
  XAI_API_KEY: 'k',
  ANTHROPIC_API_KEY: 'k',
  OPENAI_API_KEY: 'k',
};

const baseInput: ResearchBriefInput = {
  industry: 'Commercial HVAC service',
  capabilities: ['ai-development-and-integration', 'cold-calling'],
  mode: 'full_due_diligence',
  maxBudgetUsd: 40,
};

describe('no mock symbols reachable from the runtime barrel', () => {
  it('does not export any mock/fixture research generators', () => {
    const names = Object.keys(sharedIndex);
    expect(names.filter(n => /mock|fixture|fake|demo/i.test(n))).toEqual([]);
  });
});

describe('researchBriefInputSchema', () => {
  it('accepts a minimal valid brief', () => {
    expect(researchBriefInputSchema.safeParse(baseInput).success).toBe(true);
  });
  it('rejects a missing/short industry', () => {
    expect(researchBriefInputSchema.safeParse({ ...baseInput, industry: 'x' }).success).toBe(false);
  });
  it('rejects a non-positive budget', () => {
    expect(researchBriefInputSchema.safeParse({ ...baseInput, maxBudgetUsd: 0 }).success).toBe(
      false
    );
  });
});

describe('normalizeBrief — blank-field assumptions', () => {
  const brief = normalizeBrief(baseInput, {
    researchBriefId: 'b',
    now: new Date('2026-07-18T00:00:00Z'),
  });
  it('generates explicit assumptions for blank fields', () => {
    const fields = brief.assumptions.map(a => a.field);
    expect(fields).toContain('Geographic market');
    expect(fields).toContain('Risk tolerance');
  });
  it('resolves capability ids to labels', () => {
    expect(brief.capabilityLabels).toContain('AI development and integration');
  });
  it('applies mode source targets', () => {
    expect(brief.sourceTargets.totalSources).toBe(
      RESEARCH_MODES.full_due_diligence.sourceTargets.totalSources
    );
  });
});

describe('resolveCapabilityLabels', () => {
  it('maps ids and passes custom entries through, deduping', () => {
    const out = resolveCapabilityLabels(['voice-ai', 'My Custom Skill', 'my custom skill']);
    expect(out).toContain('Voice AI');
    expect(out).toContain('My Custom Skill');
    expect(out).toHaveLength(2);
  });
});

describe('provider registry (real-only, four providers, no OpenAI)', () => {
  it('contains exactly four real providers and no mock/openai', () => {
    const reg = buildProviderRegistry(LIVE);
    expect(reg.map(p => p.id).sort()).toEqual(['anthropic', 'google', 'perplexity', 'xai']);
    expect(reg.some(p => (p.id as string) === 'openai')).toBe(false);
  });
  it('anthropic performs synthesis only (never verification)', () => {
    const anthropic = buildProviderRegistry(LIVE).find(p => p.id === 'anthropic')!;
    expect(anthropic.roles).toEqual(['synthesis']);
  });
  it('reflects presence of a key without exposing it', () => {
    const reg = buildProviderRegistry({ GEMINI_API_KEY: 'secret' });
    expect(reg.find(p => p.id === 'google')?.hasKey).toBe(true);
    expect(JSON.stringify(reg)).not.toContain('secret');
  });
});

describe('preflight (independent verification architecture)', () => {
  it('fails when required provider keys are missing', () => {
    const pf = preflightRun({}, { mode: 'full_due_diligence' });
    expect(pf.ok).toBe(false);
    expect(pf.errors.length).toBeGreaterThan(0);
  });
  it('full DD assigns independent verifiers (perplexity factual, xai adversarial, gemini adjudicator)', () => {
    const pf = preflightRun(LIVE, { mode: 'full_due_diligence' });
    expect(pf.ok).toBe(true);
    expect(pf.assignments.primary).toBe('google');
    expect(pf.assignments.synthesis).toBe('anthropic');
    expect(pf.assignments.factual_verifier).toBe('perplexity');
    expect(pf.assignments.adversarial_verifier).toBe('xai');
    expect(pf.assignments.adjudicator).toBe('google');
  });
  it('rapid_scan requires primary + synthesis + a non-Anthropic factual verifier (Perplexity)', () => {
    expect(
      preflightRun({ GEMINI_API_KEY: 'k', ANTHROPIC_API_KEY: 'k' }, { mode: 'rapid_scan' }).ok
    ).toBe(false);
    expect(
      preflightRun(
        { GEMINI_API_KEY: 'k', ANTHROPIC_API_KEY: 'k', PERPLEXITY_API_KEY: 'k' },
        { mode: 'rapid_scan' }
      ).ok
    ).toBe(true);
  });
});

describe('assignments & real fallback', () => {
  it('honors a usable override', () => {
    const a = resolveAssignments(LIVE, {
      mode: 'full_due_diligence',
      providerOverrides: { primary: 'perplexity' },
    });
    expect(a.primary).toBe('perplexity');
  });
  it('roleFallbacks returns only real providers (never mock/openai; anthropic cannot do primary)', () => {
    const fb = roleFallbacks(LIVE, 'primary', 'google');
    expect(fb).not.toContain('google');
    expect(fb).not.toContain('openai');
    expect(fb).not.toContain('anthropic'); // anthropic is synthesis-only
    expect(fb.every(id => ['perplexity', 'xai'].includes(id))).toBe(true);
  });
});

describe('cost', () => {
  it('estimates a positive band for real assignments', () => {
    const a = resolveAssignments(LIVE, { mode: 'forensic_max' });
    const est = estimateRunCost('forensic_max', a);
    expect(est.highUsd).toBeGreaterThan(est.lowUsd);
    expect(budgetFits(est, 1000)).toBe(true);
  });
  it('computes actual cost from real token usage', () => {
    const c = computeActualCost('anthropic', { inputTokens: 1_000_000, outputTokens: 0 });
    expect(c).toBe(5); // $5 / 1M input tokens
  });
  it('returns null when usage tokens are unavailable', () => {
    expect(computeActualCost('anthropic', {})).toBeNull();
  });
});

describe('URL canonicalization & validation', () => {
  it('strips tracking params, www, hash, and trailing slash', () => {
    expect(canonicalizeUrl('https://www.Example.com/path/?utm_source=x&b=2#frag')).toBe(
      'https://example.com/path?b=2'
    );
  });
  it('validates http/https only', () => {
    expect(isValidHttpUrl('https://example.com')).toBe(true);
    expect(isValidHttpUrl('ftp://example.com')).toBe(false);
  });
});

describe('structured report schema', () => {
  it('accepts a well-formed report and rejects an incomplete one', () => {
    const brief = normalizeBrief(baseInput, {
      researchBriefId: 'b',
      now: new Date('2026-07-18T00:00:00Z'),
    });
    const good: StructuredReport = {
      reportMetadata: {
        researchRunId: 'run-1',
        researchBriefId: brief.researchBriefId,
        industry: brief.industry,
        geography: 'United States',
        mode: 'full_due_diligence',
        generatedAt: brief.researchDate,
        synthesisProvider: 'anthropic',
        synthesisModel: 'claude-opus-4-8',
        schemaVersion: SCHEMA_VERSION,
      },
      executiveVerdict: {
        verdict: 'CONDITIONAL_GO',
        overallScore: 64,
        confidence: 0.55,
        bestSegment: 's',
        bestCustomer: 'c',
        bestBusinessModel: 'm',
        timeToFirstRevenue: '45 days',
        initialCapital: '$10k',
        biggestOpportunity: 'o',
        biggestRisk: 'r',
        oneSentenceConclusion: 'Enter narrowly.',
      },
      assumptions: [],
      sections: [],
      competitors: [],
      unitEconomicsScenarios: [],
      rankedOpportunities: [],
      killCriteria: [],
      contradictions: [],
      unknowns: [],
      evidenceLedger: [],
      sources: [],
      confidenceAssessment: 'moderate',
    };
    expect(structuredReportSchema.safeParse(good).success).toBe(true);
    // missing executiveVerdict → invalid
    const bad = { ...good } as Record<string, unknown>;
    delete bad.executiveVerdict;
    expect(structuredReportSchema.safeParse(bad).success).toBe(false);
  });
});
