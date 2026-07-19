// Core domain types for the multi-provider Industry Research pipeline.
// Kept free of any Node-only / browser-only dependencies so they can be shared
// by the API (Fastify), the worker, and the web (Next.js) apps.

export type ResearchMode = 'rapid_scan' | 'full_due_diligence' | 'forensic_max';

export type RiskTolerance = 'low' | 'moderate' | 'high';

export type OutputDetail = 'standard' | 'detailed' | 'exhaustive';

/**
 * Role a provider plays in the pipeline. Verification is performed by
 * INDEPENDENT providers — never by the synthesis model (Anthropic) verifying
 * its own report:
 *  - factual_verifier  → Perplexity (citation/factual audit)
 *  - adversarial_verifier → xAI (adversarial risk audit, web + X)
 *  - adjudicator       → Gemini (conflict adjudication when verifiers disagree)
 */
export type ProviderRole =
  | 'primary'
  | 'independent'
  | 'social'
  | 'synthesis'
  | 'factual_verifier'
  | 'adversarial_verifier'
  | 'adjudicator';

/** Configurable REAL provider identifiers. There is no mock provider and no OpenAI. */
export type ProviderId = 'google' | 'perplexity' | 'xai' | 'anthropic';

/** Normalized pipeline/provider status. */
export type RunStatus =
  | 'queued'
  | 'planning'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'timed_out'
  | 'budget_exceeded';

export type StageStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'canceled'
  | 'fallback';

/** Canonical stage keys, in pipeline order. */
export type StageKey =
  | 'normalize'
  | 'plan'
  | 'primary'
  | 'independent'
  | 'social'
  | 'evidence'
  | 'validation'
  | 'contradictions'
  | 'synthesis'
  | 'verify_factual'
  | 'verify_adversarial'
  | 'adjudicate'
  | 'publish';

export type Verdict = 'GO' | 'CONDITIONAL_GO' | 'DO_NOT_ENTER';

export type ClaimClassification =
  | 'verified_fact'
  | 'reported_experience'
  | 'estimate'
  | 'inference'
  | 'hypothesis'
  | 'unverified_industry_claim';

// ---------------------------------------------------------------------------
// Brief (user input + normalized/canonical form)
// ---------------------------------------------------------------------------

export interface ResearchBriefInput {
  industry: string;
  geography?: string;
  customer?: string;
  businessModel?: string;
  startingCapital?: string;
  timeToFirstRevenue?: string;
  timeToProfit?: string;
  riskTolerance?: RiskTolerance;
  constraints?: string;

  /** Capability ids from the taxonomy and/or free-text custom entries. */
  capabilities: string[];

  mode: ResearchMode;

  // Research controls
  maxBudgetUsd: number;
  maxRuntimeMin?: number;
  minSources?: number;
  includeDomains?: string[];
  excludeDomains?: string[];
  dateRangeFrom?: string;
  dateRangeTo?: string;
  language?: string;
  currency?: string;
  includeSocial?: boolean;
  includeLegal?: boolean;
  includeAcquisitions?: boolean;
  includeTech?: boolean;
  includeFirstCustomerPlan?: boolean;
  outputDetail?: OutputDetail;

  /** Advanced per-role provider overrides. */
  providerOverrides?: Partial<Record<ProviderRole, ProviderId>>;
}

export interface Assumption {
  field: string;
  value: string;
  rationale: string;
}

export interface SourceTargets {
  totalSources: number;
  primarySources: number;
  firsthandSignals: number;
  competitors: number;
  pricingExamples: number;
}

/** Output of Stage 0. A deterministic, auditable version of the brief. */
export interface CanonicalBrief extends ResearchBriefInput {
  researchBriefId: string;
  researchDate: string; // ISO date
  timezone: string;
  capabilityLabels: string[];
  assumptions: Assumption[];
  requiredSections: string[];
  sourceTargets: SourceTargets;
}

// ---------------------------------------------------------------------------
// Provider configuration & assignments
// ---------------------------------------------------------------------------

export interface ProviderConfig {
  id: ProviderId;
  label: string;
  enabled: boolean;
  /** Env var name that holds the API key (never the key itself). */
  apiKeyEnv: string;
  hasKey: boolean;
  model: string;
  fallbackModel?: string;
  timeoutMs: number;
  maxRetries: number;
  roles: ProviderRole[];
}

export type ProviderAssignments = Record<ProviderRole, ProviderId>;

// ---------------------------------------------------------------------------
// Stages, plan, progress
// ---------------------------------------------------------------------------

export interface StageInfo {
  key: StageKey;
  label: string;
  status: StageStatus;
  role?: ProviderRole;
  provider?: ProviderId;
  model?: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  sourcesFound?: number;
  searches?: number;
  costUsd?: number;
  usedFallback?: boolean;
  error?: string | null;
}

export interface ResearchPlanWorkstream {
  key: string;
  title: string;
  objective: string;
  queryFamilies: string[];
  preferredSources: string[];
  evidenceTypes: string[];
  stoppingCriteria: string;
}

export interface ResearchPlan {
  summary: string;
  workstreams: ResearchPlanWorkstream[];
}

export interface ProgressEvent {
  ts: string;
  stage: StageKey;
  message: string;
}

// ---------------------------------------------------------------------------
// Evidence, sources, contradictions
// ---------------------------------------------------------------------------

export interface EvidenceSource {
  sourceId: string;
  title?: string;
  url: string;
  normalizedUrl: string;
  publisher?: string;
  publishedDate?: string;
  sourceType?: string;
  accessedDate?: string;
  httpStatus?: number | null;
  validated: boolean;
  validationNote?: string;
  provider: ProviderId;
}

export interface Claim {
  claimId: string;
  text: string;
  category: string;
  classification: ClaimClassification;
  supportingSourceIds: string[];
  contradictingSourceIds: string[];
  provider: ProviderId;
  geography?: string;
  applicabilityPeriod?: string;
  confidence: number; // 0..1
  materiality: number; // 0..1
  notes?: string;
}

export interface Contradiction {
  topic: string;
  positionA: string;
  positionB: string;
  cause:
    | 'definition'
    | 'date'
    | 'geography'
    | 'segment'
    | 'methodology'
    | 'vendor_bias'
    | 'sample_bias'
    | 'genuine_uncertainty';
  resolution?: string;
}

export interface ResearchGap {
  topic: string;
  whyItMatters: string;
  howToObtain: string;
}

// ---------------------------------------------------------------------------
// Provider execution result (normalized)
// ---------------------------------------------------------------------------

export interface ProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  citationTokens?: number;
  searches?: number;
  toolCalls?: number;
  webSearchCalls?: number;
  xSearchCalls?: number;
  codeExecutionCalls?: number;
  requests?: number;
  /** Authoritative dollar cost when the provider reports one (Perplexity). */
  providerReportedCostUsd?: number;
}

export interface ProviderReport {
  role: ProviderRole;
  provider: ProviderId;
  model: string;
  status: 'completed' | 'failed';
  markdown: string;
  claims: Claim[];
  sources: EvidenceSource[];
  usage: ProviderUsage;
  costUsd: number;
  usedFallback: boolean;
  error?: string | null;
  requestId?: string;
  suspectedPromptInjection?: string[];
}

// ---------------------------------------------------------------------------
// Final structured report (the output contract)
// ---------------------------------------------------------------------------

export interface Competitor {
  name: string;
  targetCustomer?: string;
  offer?: string;
  pricing?: string;
  strengths?: string;
  weaknesses?: string;
  vulnerability?: string;
}

export interface UnitEconomicsScenario {
  name: 'conservative' | 'base' | 'aggressive';
  asp?: string;
  grossMargin?: string;
  cac?: string;
  paybackPeriod?: string;
  ltv?: string;
  notes?: string;
}

export interface RankedOpportunity {
  rank: number;
  opportunity: string;
  customer?: string;
  offer?: string;
  revenueModel?: string;
  price?: string;
  startupCost?: string;
  timeToMvp?: string;
  timeToFirstRevenue?: string;
  grossMarginRange?: string;
  salesDifficulty?: string;
  regulatoryRisk?: string;
  defensibility?: string;
  opportunityScore: number; // 0..100
}

export interface ExecutiveVerdict {
  verdict: Verdict;
  overallScore: number; // 0..100
  confidence: number; // 0..1
  bestSegment: string;
  bestCustomer: string;
  bestBusinessModel: string;
  timeToFirstRevenue: string;
  initialCapital: string;
  biggestOpportunity: string;
  biggestRisk: string;
  oneSentenceConclusion: string;
}

export interface ReportSection {
  key: string;
  title: string;
  markdown: string;
}

export interface StructuredReport {
  reportMetadata: {
    researchRunId: string;
    researchBriefId: string;
    industry: string;
    geography: string;
    mode: ResearchMode;
    generatedAt: string;
    synthesisProvider: ProviderId;
    synthesisModel: string;
    schemaVersion: string;
  };
  executiveVerdict: ExecutiveVerdict;
  assumptions: Assumption[];
  sections: ReportSection[];
  competitors: Competitor[];
  unitEconomicsScenarios: UnitEconomicsScenario[];
  rankedOpportunities: RankedOpportunity[];
  killCriteria: string[];
  contradictions: Contradiction[];
  unknowns: ResearchGap[];
  evidenceLedger: Claim[];
  sources: EvidenceSource[];
  confidenceAssessment: string;
}

export type VerificationVerdict = 'pass' | 'pass_with_caveats' | 'repair_required' | 'reject';

/** Perplexity independent factual / citation audit. */
export interface FactualVerification {
  verdict: VerificationVerdict;
  confidence: number; // 0..1
  claimsChecked: number;
  claimsSupported: number;
  claimsPartiallySupported: number;
  claimsUnsupported: number;
  citationFailures: string[];
  unsupportedClaims: string[];
  misleadingClaims: string[];
  outdatedSources: string[];
  calculationErrors: string[];
  missingEvidence: string[];
  requiredRepairs: string[];
  blockingDefects: string[];
}

/** xAI independent adversarial audit (web + X + code). */
export interface AdversarialVerification {
  verdict: VerificationVerdict;
  confidence: number; // 0..1
  webSearchUsed: boolean;
  xSearchUsed: boolean;
  codeExecutionUsed: boolean;
  missingRisks: string[];
  contradictoryEvidence: string[];
  overconfidentConclusions: string[];
  operatorWarnings: string[];
  customerWarnings: string[];
  competitorResponses: string[];
  economicWeaknesses: string[];
  regulatoryWeaknesses: string[];
  requiredRepairs: string[];
  blockingDefects: string[];
}

/** Gemini conflict adjudication (only when verifiers disagree or a defect is material). */
export interface AdjudicationResult {
  verdict: VerificationVerdict;
  disputesReviewed: string[];
  resolvedFindings: string[];
  additionalEvidence: string[];
  requiredRepairs: string[];
  blockingDefects: string[];
}

/** Async provider job tracking (Gemini Interactions, Perplexity async). */
export interface AsyncJobRef {
  provider: ProviderId;
  jobId: string;
  agentOrModel: string;
  status: 'submitted' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  submittedAt: string;
  lastPolledAt?: string;
  completedAt?: string;
  idempotencyKey?: string;
}

// ---------------------------------------------------------------------------
// Cost
// ---------------------------------------------------------------------------

export interface CostLine {
  role: ProviderRole;
  provider: ProviderId;
  stage: StageKey;
  estimatedUsd: number;
  actualUsd?: number;
}

export interface CostEstimate {
  lowUsd: number;
  highUsd: number;
  byLine: CostLine[];
  currency: string;
}

// ---------------------------------------------------------------------------
// Run summary (as returned to the web app)
// ---------------------------------------------------------------------------

export interface ResearchRunSummary {
  id: string;
  industry: string;
  geography: string;
  mode: ResearchMode;
  status: RunStatus;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  estimatedCostUsd: number;
  accruedCostUsd: number;
  maxBudgetUsd: number;
  verdict?: Verdict | null;
  overallScore?: number | null;
  hasReport: boolean;
}

export interface ResearchRunDetail extends ResearchRunSummary {
  brief: CanonicalBrief;
  providerAssignments: ProviderAssignments;
  stages: StageInfo[];
  plan?: ResearchPlan | null;
  progress: ProgressEvent[];
  costEstimate: CostEstimate;
  insufficientEvidence?: boolean;
}

export interface TeamProfileSummary {
  id: string;
  name: string;
  capabilities: string[];
  createdAt: string;
}
