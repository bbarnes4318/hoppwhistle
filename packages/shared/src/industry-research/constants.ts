import type { ResearchMode, StageKey, ProviderRole, SourceTargets } from './types.js';

export const SCHEMA_VERSION = '2.0.0';

export interface ModeDefinition {
  id: ResearchMode;
  label: string;
  description: string;
  /** Pipeline roles actually executed in this mode. */
  roles: ProviderRole[];
  sourceTargets: SourceTargets;
  defaultBudgetUsd: number;
  expectedRuntimeMin: [number, number];
}

export const RESEARCH_MODES: Record<ResearchMode, ModeDefinition> = {
  rapid_scan: {
    id: 'rapid_scan',
    label: 'Rapid Scan',
    description:
      'Early screening. Gemini grounded rapid research + Anthropic synthesis + one independent (non-Anthropic) Perplexity factual verification + deterministic validation. Not exhaustive Deep Research.',
    roles: ['primary', 'synthesis', 'factual_verifier'],
    sourceTargets: {
      totalSources: 15,
      primarySources: 4,
      firsthandSignals: 5,
      competitors: 4,
      pricingExamples: 2,
    },
    defaultBudgetUsd: 1.5,
    expectedRuntimeMin: [3, 12],
  },
  full_due_diligence: {
    id: 'full_due_diligence',
    label: 'Full Due Diligence',
    description:
      'Gemini Deep Research + Perplexity async Sonar Deep Research + xAI Web & X intelligence → Anthropic synthesis → independent Perplexity factual + xAI adversarial verification → Gemini adjudication when they disagree → deterministic validation.',
    roles: [
      'primary',
      'independent',
      'social',
      'synthesis',
      'factual_verifier',
      'adversarial_verifier',
      'adjudicator',
    ],
    sourceTargets: {
      totalSources: 50,
      primarySources: 15,
      firsthandSignals: 20,
      competitors: 10,
      pricingExamples: 5,
    },
    defaultBudgetUsd: 7,
    expectedRuntimeMin: [20, 75],
  },
  forensic_max: {
    id: 'forensic_max',
    label: 'Forensic Maximum Depth',
    description:
      'Gemini Deep Research MAX + Perplexity async Sonar Deep Research + xAI maximum Web & X → Anthropic synthesis → independent Perplexity + xAI verification → MANDATORY Gemini adjudication → deterministic validation → one bounded repair + re-verification.',
    roles: [
      'primary',
      'independent',
      'social',
      'synthesis',
      'factual_verifier',
      'adversarial_verifier',
      'adjudicator',
    ],
    sourceTargets: {
      totalSources: 80,
      primarySources: 25,
      firsthandSignals: 30,
      competitors: 15,
      pricingExamples: 8,
    },
    // Forensic requires an explicit user-chosen budget (no safe default) — the UI
    // must not pre-fill this; treated as "require explicit selection".
    defaultBudgetUsd: 15,
    expectedRuntimeMin: [40, 150],
  },
};

export interface StageDefinition {
  key: StageKey;
  label: string;
  role?: ProviderRole;
  activity: string[];
}

export const STAGE_DEFINITIONS: StageDefinition[] = [
  {
    key: 'normalize',
    label: 'Normalize the brief',
    activity: ['Normalizing brief', 'Generating assumptions'],
  },
  {
    key: 'plan',
    label: 'Build research plan',
    activity: ['Building research plan', 'Mapping industry segments'],
  },
  {
    key: 'primary',
    label: 'Primary research (Gemini)',
    role: 'primary',
    activity: ['Submitting Gemini research', 'Waiting for Gemini', 'Reconstructing unit economics'],
  },
  {
    key: 'independent',
    label: 'Independent research (Perplexity)',
    role: 'independent',
    activity: [
      'Submitting Perplexity Deep Research',
      'Waiting for Perplexity',
      'Validating competitor evidence',
    ],
  },
  {
    key: 'social',
    label: 'Operator intelligence (xAI Web + X)',
    role: 'social',
    activity: [
      'Searching web + X',
      'Reviewing complaints and reviews',
      'Grouping recurring themes',
    ],
  },
  {
    key: 'evidence',
    label: 'Evidence normalization',
    activity: ['Normalizing claims', 'Deduplicating URLs'],
  },
  {
    key: 'validation',
    label: 'Citation validation',
    activity: ['Validating citations', 'Flagging dead links'],
  },
  {
    key: 'contradictions',
    label: 'Contradiction & gap analysis',
    activity: ['Preparing evidence for adjudication', 'Identifying research gaps'],
  },
  {
    key: 'synthesis',
    label: 'Synthesis (Anthropic)',
    role: 'synthesis',
    activity: ['Adjudicating evidence', 'Writing the decision report'],
  },
  {
    key: 'verify_factual',
    label: 'Factual verification (Perplexity)',
    role: 'factual_verifier',
    activity: ['Auditing claims against citations', 'Checking source dates and quality'],
  },
  {
    key: 'verify_adversarial',
    label: 'Adversarial verification (xAI Web + X)',
    role: 'adversarial_verifier',
    activity: ['Attempting to disprove the thesis', 'Searching for missing risks'],
  },
  {
    key: 'adjudicate',
    label: 'Conflict adjudication (Gemini)',
    role: 'adjudicator',
    activity: ['Adjudicating verifier disputes'],
  },
  {
    key: 'publish',
    label: 'Validate & publish',
    activity: ['Deterministic validation', 'Publishing report'],
  },
];

/** Stages that always run regardless of mode (non provider-role stages). */
export const ALWAYS_STAGES: StageKey[] = [
  'normalize',
  'plan',
  'evidence',
  'validation',
  'contradictions',
  'publish',
];

export const REQUIRED_REPORT_SECTIONS: { key: string; title: string }[] = [
  { key: 'what_outsiders_get_wrong', title: 'What Outsiders Get Wrong' },
  { key: 'industry_structure', title: 'Industry Structure' },
  { key: 'market_evidence', title: 'Market Evidence' },
  { key: 'customer_truth', title: 'Customer Truth' },
  { key: 'operator_truth', title: 'Operator Truth' },
  { key: 'competitive_intelligence', title: 'Competitive Intelligence' },
  { key: 'economics', title: 'Economics' },
  { key: 'sales_distribution', title: 'Sales & Distribution' },
  { key: 'regulation_risk', title: 'Regulation & Risk' },
  { key: 'ranked_opportunities', title: 'Ranked Entry Opportunities' },
  { key: 'recommended_thesis', title: 'Recommended Entry Thesis' },
  { key: 'first_customer_plan', title: 'First-Customer Plan' },
  { key: 'execution_plan_90_days', title: '90-Day Execution Plan' },
  { key: 'validation_tests', title: 'Validation Tests' },
  { key: 'kill_criteria', title: 'Kill Criteria' },
];

export const PROVIDER_ROLE_LABELS: Record<ProviderRole, string> = {
  primary: 'Primary research',
  independent: 'Independent research',
  social: 'Operator intelligence (Web + X)',
  synthesis: 'Synthesis & adjudication of evidence',
  factual_verifier: 'Independent factual verification',
  adversarial_verifier: 'Independent adversarial verification',
  adjudicator: 'Conflict adjudication',
};
