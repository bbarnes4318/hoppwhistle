import { resolveCapabilityLabels } from './capabilities.js';
import { REQUIRED_REPORT_SECTIONS, RESEARCH_MODES } from './constants.js';
import type { Assumption, CanonicalBrief, ResearchBriefInput } from './types.js';

interface NormalizeOptions {
  researchBriefId: string;
  now: Date;
  timezone?: string;
}

// Fields that, when blank, get an explicit documented assumption instead of
// blocking the run (per spec: "Blank fields must not block the run").
const ASSUMPTION_DEFAULTS: {
  field: keyof ResearchBriefInput;
  label: string;
  value: string;
  rationale: string;
}[] = [
  {
    field: 'geography',
    label: 'Geographic market',
    value: 'United States',
    rationale: 'No market specified; defaulting to the largest English-language commercial market.',
  },
  {
    field: 'customer',
    label: 'Potential customer',
    value: 'Open — analyze multiple customer types',
    rationale: 'No target customer specified; the report will evaluate several personas.',
  },
  {
    field: 'businessModel',
    label: 'Business model',
    value: 'Open to any model',
    rationale: 'No model specified; the report will compare multiple entry models.',
  },
  {
    field: 'startingCapital',
    label: 'Starting capital',
    value: 'Under $25,000 (bootstrapped)',
    rationale: 'No capital specified; assuming a lean, service-first budget.',
  },
  {
    field: 'timeToFirstRevenue',
    label: 'Time to first revenue',
    value: '90 days',
    rationale: 'No timeframe specified; assuming a fast validation horizon.',
  },
  {
    field: 'timeToProfit',
    label: 'Time to meaningful profit',
    value: '12 months',
    rationale: 'No timeframe specified; assuming a standard early-stage horizon.',
  },
  {
    field: 'riskTolerance',
    label: 'Risk tolerance',
    value: 'moderate',
    rationale: 'No risk tolerance specified; assuming a balanced posture.',
  },
];

/**
 * Stage 0 — produce a deterministic canonical brief from raw user input,
 * generating explicit assumptions for any blank fields.
 */
export function normalizeBrief(input: ResearchBriefInput, opts: NormalizeOptions): CanonicalBrief {
  const assumptions: Assumption[] = [];

  for (const def of ASSUMPTION_DEFAULTS) {
    const current = input[def.field];
    if (current === undefined || current === null || String(current).trim() === '') {
      assumptions.push({ field: def.label, value: def.value, rationale: def.rationale });
    }
  }

  const modeDef = RESEARCH_MODES[input.mode];
  const capabilityLabels = resolveCapabilityLabels(input.capabilities ?? []);
  if (capabilityLabels.length === 0) {
    assumptions.push({
      field: 'Team capabilities',
      value: 'Generalist software + sales team',
      rationale: 'No capabilities selected; assuming a broadly capable small team.',
    });
  }

  const requiredSections = REQUIRED_REPORT_SECTIONS.map(s => s.title);

  return {
    ...input,
    researchBriefId: opts.researchBriefId,
    researchDate: opts.now.toISOString(),
    timezone: opts.timezone ?? 'UTC',
    capabilityLabels,
    assumptions,
    requiredSections,
    sourceTargets: {
      ...modeDef.sourceTargets,
      totalSources: input.minSources ?? modeDef.sourceTargets.totalSources,
    },
    // resolved effective values
    geography: input.geography?.trim() || 'United States',
    riskTolerance: input.riskTolerance ?? 'moderate',
    currency: input.currency || 'USD',
    language: input.language || 'English',
  };
}
