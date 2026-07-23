import 'dotenv-flow/config';

import {
  buildProviderRegistry,
  normalizeBrief,
  structuredReportSchema,
  type ProviderReport,
  type ResearchBriefInput,
} from '@hopwhistle/shared';

import { RealAdapter } from '../services/industry-research/providers.js';

// Cheap isolated test of the REAL Anthropic synthesis (schema adherence + repair
// + timeout). Small synthetic evidence => fast + low cost. No Gemini call.

async function main() {
  const cfg = buildProviderRegistry(process.env).find(c => c.id === 'anthropic')!;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY missing');

  const input: ResearchBriefInput = {
    industry: 'Commercial HVAC maintenance services',
    geography: 'United States',
    capabilities: ['cold-calling', 'saas-development'],
    mode: 'rapid_scan',
    maxBudgetUsd: 25,
  };
  const brief = normalizeBrief(input, { researchBriefId: 'probe-brief', now: new Date() });

  const primary: ProviderReport = {
    role: 'primary',
    provider: 'google',
    model: 'gemini-flash-latest',
    status: 'completed',
    markdown:
      'Commercial HVAC maintenance in the US is fragmented; SMB operators struggle with scheduling, quoting and after-hours calls. Contracts are typically annual with per-visit pricing. Common complaints: slow response, opaque pricing. Gross margins ~35-55% before CAC.',
    claims: [],
    sources: [
      {
        sourceId: 'g1',
        url: 'https://www.bls.gov/ooh/hvac',
        normalizedUrl: 'https://bls.gov/ooh/hvac',
        provider: 'google',
        validated: true,
        title: 'BLS HVAC',
      },
      {
        sourceId: 'g2',
        url: 'https://www.energy.gov/hvac-commercial',
        normalizedUrl: 'https://energy.gov/hvac-commercial',
        provider: 'google',
        validated: true,
        title: 'DOE',
      },
      {
        sourceId: 'g3',
        url: 'https://www.reddit.com/r/HVAC/comments/x',
        normalizedUrl: 'https://reddit.com/r/HVAC/comments/x',
        provider: 'google',
        validated: false,
        title: 'r/HVAC',
      },
    ],
    usage: { inputTokens: 100, outputTokens: 400 },
    costUsd: 0,
    usedFallback: false,
  };

  const adapter = new RealAdapter('anthropic', key);
  console.log(
    'Synthesizing with',
    cfg.model,
    '(max_tokens',
    process.env.ANTHROPIC_MAX_OUTPUT_TOKENS || 'default',
    ')…'
  );
  const t0 = Date.now();
  const result = await adapter.runSynthesis(
    {
      brief,
      runId: 'probe-run',
      plan: null,
      reports: [primary],
      claims: [],
      sources: primary.sources,
      contradictionsNote: '',
    },
    { model: cfg.model, timeoutMs: cfg.timeoutMs, maxRetries: cfg.maxRetries }
  );
  const dur = Math.round((Date.now() - t0) / 1000);

  const valid = structuredReportSchema.safeParse(result.structured);
  console.log(`Done in ${dur}s. provider=${result.provider} model=${result.model}`);
  console.log('Schema valid:', valid.success);
  console.log(
    'Verdict:',
    result.structured.executiveVerdict.verdict,
    '| score:',
    result.structured.executiveVerdict.overallScore
  );
  console.log(
    'Sections:',
    result.structured.sections.length,
    '| evidence:',
    result.structured.evidenceLedger.length,
    '| sources:',
    result.structured.sources.length
  );
  console.log('Usage:', JSON.stringify(result.usage));
  if (!valid.success) {
    console.log(
      'Errors:',
      valid.error.errors.slice(0, 8).map(e => `${e.path.join('.')}: ${e.message}`)
    );
    process.exit(1);
  }
  process.exit(0);
}

main().catch(e => {
  console.error('Probe failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
