import type { StageInfo } from '@hopwhistle/shared';

// Six human-facing phases that group the 13 internal stages. First-time users
// see these; the underlying provider stages live under Technical details.
export const PHASES: Array<{
  key: string;
  label: string;
  blurb: string;
  stages: string[];
}> = [
  {
    key: 'planning',
    label: 'Planning',
    blurb: 'Framing the question',
    stages: ['normalize', 'plan'],
  },
  {
    key: 'researching',
    label: 'Researching',
    blurb: 'Three independent investigations',
    stages: ['primary', 'independent', 'social'],
  },
  {
    key: 'evidence',
    label: 'Combining evidence',
    blurb: 'Reconciling and validating sources',
    stages: ['evidence', 'validation', 'contradictions'],
  },
  {
    key: 'report',
    label: 'Building the report',
    blurb: 'Writing the decision',
    stages: ['synthesis'],
  },
  {
    key: 'verification',
    label: 'Independent verification',
    blurb: 'Fact-checked and stress-tested',
    stages: ['verify_factual', 'verify_adversarial', 'adjudicate'],
  },
  {
    key: 'finalizing',
    label: 'Finalizing',
    blurb: 'Validating and publishing',
    stages: ['publish'],
  },
];

// Plain-English names for the three concurrent research streams (no provider IDs).
export const RESEARCH_STREAMS: Record<string, string> = {
  primary: 'Comprehensive market investigation',
  independent: 'Independent second investigation',
  social: 'Operator & customer intelligence',
};

// Friendly, provider-free label for any stage (used outside Technical details).
export const FRIENDLY_STAGE: Record<string, string> = {
  normalize: 'Framing the question',
  plan: 'Research plan',
  primary: 'Comprehensive market investigation',
  independent: 'Independent second investigation',
  social: 'Operator & customer intelligence',
  evidence: 'Combining the evidence',
  validation: 'Validating sources',
  contradictions: 'Reconciling conflicts',
  synthesis: 'Writing the decision report',
  verify_factual: 'Independent fact-check',
  verify_adversarial: 'Adversarial stress-test',
  adjudicate: 'Resolving disagreements',
  publish: 'Validating & publishing',
};

export type PhaseStatus = 'pending' | 'active' | 'complete' | 'failed' | 'skipped';

export interface PhaseState {
  key: string;
  label: string;
  blurb: string;
  status: PhaseStatus;
  stages: StageInfo[];
}

/** Roll the 13 internal stages up into the 6 user-facing phases with a status. */
export function computePhases(stages: StageInfo[]): PhaseState[] {
  const byKey = new Map(stages.map(s => [s.key as string, s]));
  return PHASES.map(p => {
    const included = p.stages.map(k => byKey.get(k)).filter(Boolean) as StageInfo[];
    const active = included.some(s => s.status === 'running');
    const failed = included.some(s => s.status === 'failed');
    const relevant = included.filter(s => s.status !== 'skipped');
    const allDone =
      relevant.length > 0 &&
      relevant.every(s => s.status === 'completed' || s.status === 'fallback');
    const status: PhaseStatus = failed
      ? 'failed'
      : active
        ? 'active'
        : relevant.length === 0
          ? 'skipped'
          : allDone
            ? 'complete'
            : 'pending';
    return { key: p.key, label: p.label, blurb: p.blurb, status, stages: included };
  });
}
