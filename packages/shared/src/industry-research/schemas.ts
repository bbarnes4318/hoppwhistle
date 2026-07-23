import { z } from 'zod';

// Zod schemas used to validate user input on the server and to validate
// provider structured output before it is saved or rendered.

export const researchModeSchema = z.enum(['rapid_scan', 'full_due_diligence', 'forensic_max']);
export const riskToleranceSchema = z.enum(['low', 'moderate', 'high']);
export const providerIdSchema = z.enum(['google', 'perplexity', 'xai', 'anthropic']);
export const providerRoleSchema = z.enum([
  'primary',
  'independent',
  'social',
  'synthesis',
  'factual_verifier',
  'adversarial_verifier',
  'adjudicator',
]);
export const verificationVerdictSchema = z.enum([
  'pass',
  'pass_with_caveats',
  'repair_required',
  'reject',
]);

export const researchBriefInputSchema = z.object({
  industry: z.string().trim().min(2, 'Industry is required').max(200),
  geography: z.string().trim().max(200).optional(),
  customer: z.string().trim().max(300).optional(),
  businessModel: z.string().trim().max(300).optional(),
  startingCapital: z.string().trim().max(100).optional(),
  timeToFirstRevenue: z.string().trim().max(100).optional(),
  timeToProfit: z.string().trim().max(100).optional(),
  riskTolerance: riskToleranceSchema.optional(),
  constraints: z.string().trim().max(4000).optional(),
  capabilities: z.array(z.string().trim().max(120)).max(200).default([]),
  mode: researchModeSchema,
  maxBudgetUsd: z.number().positive().max(10000),
  maxRuntimeMin: z.number().int().positive().max(600).optional(),
  minSources: z.number().int().positive().max(500).optional(),
  includeDomains: z.array(z.string().trim().max(200)).max(100).optional(),
  excludeDomains: z.array(z.string().trim().max(200)).max(100).optional(),
  dateRangeFrom: z.string().trim().max(40).optional(),
  dateRangeTo: z.string().trim().max(40).optional(),
  language: z.string().trim().max(40).optional(),
  currency: z.string().trim().max(10).optional(),
  includeSocial: z.boolean().optional(),
  includeLegal: z.boolean().optional(),
  includeAcquisitions: z.boolean().optional(),
  includeTech: z.boolean().optional(),
  includeFirstCustomerPlan: z.boolean().optional(),
  outputDetail: z.enum(['standard', 'detailed', 'exhaustive']).optional(),
  providerOverrides: z.record(providerRoleSchema, providerIdSchema).optional(),
});

export type ResearchBriefInputParsed = z.infer<typeof researchBriefInputSchema>;

// --- Structured report validation ---------------------------------------

export const claimSchema = z.object({
  claimId: z.string(),
  text: z.string(),
  category: z.string(),
  classification: z.enum([
    'verified_fact',
    'reported_experience',
    'estimate',
    'inference',
    'hypothesis',
    'unverified_industry_claim',
  ]),
  supportingSourceIds: z.array(z.string()).default([]),
  contradictingSourceIds: z.array(z.string()).default([]),
  provider: providerIdSchema,
  geography: z.string().optional(),
  applicabilityPeriod: z.string().optional(),
  confidence: z.number().min(0).max(1),
  materiality: z.number().min(0).max(1),
  notes: z.string().optional(),
});

export const evidenceSourceSchema = z.object({
  sourceId: z.string(),
  title: z.string().optional(),
  url: z.string(),
  normalizedUrl: z.string(),
  publisher: z.string().optional(),
  publishedDate: z.string().optional(),
  sourceType: z.string().optional(),
  accessedDate: z.string().optional(),
  httpStatus: z.number().nullable().optional(),
  validated: z.boolean(),
  validationNote: z.string().optional(),
  provider: providerIdSchema,
});

export const executiveVerdictSchema = z.object({
  verdict: z.enum(['GO', 'CONDITIONAL_GO', 'DO_NOT_ENTER']),
  overallScore: z.number().min(0).max(100),
  confidence: z.number().min(0).max(1),
  bestSegment: z.string(),
  bestCustomer: z.string(),
  bestBusinessModel: z.string(),
  timeToFirstRevenue: z.string(),
  initialCapital: z.string(),
  biggestOpportunity: z.string(),
  biggestRisk: z.string(),
  oneSentenceConclusion: z.string(),
});

export const rankedOpportunitySchema = z.object({
  rank: z.number(),
  opportunity: z.string(),
  customer: z.string().optional(),
  offer: z.string().optional(),
  revenueModel: z.string().optional(),
  price: z.string().optional(),
  startupCost: z.string().optional(),
  timeToMvp: z.string().optional(),
  timeToFirstRevenue: z.string().optional(),
  grossMarginRange: z.string().optional(),
  salesDifficulty: z.string().optional(),
  regulatoryRisk: z.string().optional(),
  defensibility: z.string().optional(),
  opportunityScore: z.number().min(0).max(100),
});

export const competitorSchema = z.object({
  name: z.string(),
  targetCustomer: z.string().optional(),
  offer: z.string().optional(),
  pricing: z.string().optional(),
  strengths: z.string().optional(),
  weaknesses: z.string().optional(),
  vulnerability: z.string().optional(),
});

export const unitEconomicsScenarioSchema = z.object({
  name: z.enum(['conservative', 'base', 'aggressive']),
  asp: z.string().optional(),
  grossMargin: z.string().optional(),
  cac: z.string().optional(),
  paybackPeriod: z.string().optional(),
  ltv: z.string().optional(),
  notes: z.string().optional(),
});

export const contradictionSchema = z.object({
  topic: z.string(),
  positionA: z.string(),
  positionB: z.string(),
  cause: z.enum([
    'definition',
    'date',
    'geography',
    'segment',
    'methodology',
    'vendor_bias',
    'sample_bias',
    'genuine_uncertainty',
  ]),
  resolution: z.string().optional(),
});

export const researchGapSchema = z.object({
  topic: z.string(),
  whyItMatters: z.string(),
  howToObtain: z.string(),
});

export const reportSectionSchema = z.object({
  key: z.string(),
  title: z.string(),
  markdown: z.string(),
});

export const assumptionSchema = z.object({
  field: z.string(),
  value: z.string(),
  rationale: z.string(),
});

export const structuredReportSchema = z.object({
  reportMetadata: z.object({
    researchRunId: z.string(),
    researchBriefId: z.string(),
    industry: z.string(),
    geography: z.string(),
    mode: researchModeSchema,
    generatedAt: z.string(),
    synthesisProvider: providerIdSchema,
    synthesisModel: z.string(),
    schemaVersion: z.string(),
  }),
  executiveVerdict: executiveVerdictSchema,
  assumptions: z.array(assumptionSchema).default([]),
  sections: z.array(reportSectionSchema).default([]),
  competitors: z.array(competitorSchema).default([]),
  unitEconomicsScenarios: z.array(unitEconomicsScenarioSchema).default([]),
  rankedOpportunities: z.array(rankedOpportunitySchema).default([]),
  killCriteria: z.array(z.string()).default([]),
  contradictions: z.array(contradictionSchema).default([]),
  unknowns: z.array(researchGapSchema).default([]),
  evidenceLedger: z.array(claimSchema).default([]),
  sources: z.array(evidenceSourceSchema).default([]),
  confidenceAssessment: z.string(),
});

// A structured, patchable defect emitted by a verifier. All fields except the
// human-readable problem/change are optional so a verifier that only fills the
// legacy string arrays still validates.
export const repairDefectSchema = z.object({
  defectId: z.string().default(''),
  severity: z.enum(['blocking', 'major', 'minor']).default('major'),
  claimId: z.string().optional(),
  sectionKey: z.string().optional(),
  problem: z.string(),
  requiredChange: z.string().default(''),
  affectedSourceIds: z.array(z.string()).default([]),
  recommendationChanging: z.boolean().default(false),
});

export const factualVerificationSchema = z.object({
  verdict: verificationVerdictSchema,
  confidence: z.number().min(0).max(1).default(0.5),
  claimsChecked: z.number().default(0),
  claimsSupported: z.number().default(0),
  claimsPartiallySupported: z.number().default(0),
  claimsUnsupported: z.number().default(0),
  citationFailures: z.array(z.string()).default([]),
  unsupportedClaims: z.array(z.string()).default([]),
  misleadingClaims: z.array(z.string()).default([]),
  outdatedSources: z.array(z.string()).default([]),
  calculationErrors: z.array(z.string()).default([]),
  missingEvidence: z.array(z.string()).default([]),
  requiredRepairs: z.array(z.string()).default([]),
  blockingDefects: z.array(z.string()).default([]),
  defects: z.array(repairDefectSchema).default([]),
});

export const adversarialVerificationSchema = z.object({
  verdict: verificationVerdictSchema,
  confidence: z.number().min(0).max(1).default(0.5),
  webSearchUsed: z.boolean().default(false),
  xSearchUsed: z.boolean().default(false),
  codeExecutionUsed: z.boolean().default(false),
  missingRisks: z.array(z.string()).default([]),
  contradictoryEvidence: z.array(z.string()).default([]),
  overconfidentConclusions: z.array(z.string()).default([]),
  operatorWarnings: z.array(z.string()).default([]),
  customerWarnings: z.array(z.string()).default([]),
  competitorResponses: z.array(z.string()).default([]),
  economicWeaknesses: z.array(z.string()).default([]),
  regulatoryWeaknesses: z.array(z.string()).default([]),
  requiredRepairs: z.array(z.string()).default([]),
  blockingDefects: z.array(z.string()).default([]),
  defects: z.array(repairDefectSchema).default([]),
});

export const adjudicationResultSchema = z.object({
  verdict: verificationVerdictSchema,
  disputesReviewed: z.array(z.string()).default([]),
  resolvedFindings: z.array(z.string()).default([]),
  additionalEvidence: z.array(z.string()).default([]),
  requiredRepairs: z.array(z.string()).default([]),
  blockingDefects: z.array(z.string()).default([]),
});

// --- Patch-based targeted repair ----------------------------------------

export const sectionPatchSchema = z.object({
  key: z.string(),
  title: z.string().optional(),
  markdown: z.string(),
});

export const claimPatchSchema = z.object({
  claimId: z.string(),
  text: z.string().optional(),
  classification: z
    .enum([
      'verified_fact',
      'reported_experience',
      'estimate',
      'inference',
      'hypothesis',
      'unverified_industry_claim',
    ])
    .optional(),
  confidence: z.number().min(0).max(1).optional(),
  materiality: z.number().min(0).max(1).optional(),
  supportingSourceIds: z.array(z.string()).optional(),
  contradictingSourceIds: z.array(z.string()).optional(),
  notes: z.string().optional(),
  remove: z.boolean().optional(),
});

export const verdictPatchSchema = z.object({
  verdict: z.enum(['GO', 'CONDITIONAL_GO', 'DO_NOT_ENTER']).optional(),
  overallScore: z.number().min(0).max(100).optional(),
  confidence: z.number().min(0).max(1).optional(),
  bestSegment: z.string().optional(),
  bestCustomer: z.string().optional(),
  bestBusinessModel: z.string().optional(),
  timeToFirstRevenue: z.string().optional(),
  initialCapital: z.string().optional(),
  biggestOpportunity: z.string().optional(),
  biggestRisk: z.string().optional(),
  oneSentenceConclusion: z.string().optional(),
});

export const repairPatchSetSchema = z.object({
  sectionPatches: z.array(sectionPatchSchema).default([]),
  claimPatches: z.array(claimPatchSchema).default([]),
  verdictPatch: verdictPatchSchema.nullable().default(null),
  reasonForVerdictChange: z.string().nullable().default(null),
});
