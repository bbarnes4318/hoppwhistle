import { RESEARCH_MODES } from './constants';
import type {
  CostEstimate,
  CostLine,
  ProviderAssignments,
  ProviderId,
  ProviderRole,
  ResearchMode,
} from './types';

// Date-stamped, configurable pricing assumptions. These are deliberately kept
// out of the UI components (per spec) and are ROUGH per-run estimates for a
// deep-research pass in each role — not per-token billing. Real accrued cost is
// captured from provider usage during a run.
//
// pricingAsOf lets the UI show users how current these assumptions are.
export const PRICING_AS_OF = '2026-07-01';

interface RolePriceBand {
  low: number;
  high: number;
}

// Per-provider, per-role estimated cost band (USD) for a single deep pass.
const PROVIDER_ROLE_PRICING: Record<ProviderId, Partial<Record<ProviderRole, RolePriceBand>>> = {
  google: {
    // Standard Gemini Deep Research ~$1-3/task; Forensic (Max) scales via MODE_MULTIPLIER.
    primary: { low: 1.0, high: 3.0 },
    independent: { low: 1.0, high: 3.0 },
    adjudicator: { low: 0.05, high: 0.5 },
  },
  perplexity: {
    primary: { low: 1.0, high: 4.0 },
    independent: { low: 1.0, high: 4.0 },
    social: { low: 0.5, high: 2.0 },
    factual_verifier: { low: 0.3, high: 2.0 },
  },
  xai: {
    social: { low: 0.5, high: 3.0 },
    primary: { low: 1.0, high: 4.0 },
    independent: { low: 1.0, high: 4.0 },
    adversarial_verifier: { low: 0.5, high: 3.0 },
  },
  anthropic: {
    synthesis: { low: 0.8, high: 3.5 },
  },
};

// Depth multiplier per mode — forensic runs use more searches/tokens.
const MODE_MULTIPLIER: Record<ResearchMode, number> = {
  rapid_scan: 0.5,
  full_due_diligence: 1,
  forensic_max: 2,
};

function bandFor(provider: ProviderId, role: ProviderRole): RolePriceBand {
  return PROVIDER_ROLE_PRICING[provider]?.[role] ?? { low: 0.5, high: 3.0 };
}

/**
 * Estimate the cost of a run as a low/high band, broken out by role/provider/stage.
 * Only the roles actually executed by the mode are included.
 */
export function estimateRunCost(
  mode: ResearchMode,
  assignments: ProviderAssignments,
  currency = 'USD'
): CostEstimate {
  const def = RESEARCH_MODES[mode];
  const mult = MODE_MULTIPLIER[mode];
  const byLine: CostLine[] = [];
  let low = 0;
  let high = 0;

  for (const role of def.roles) {
    const provider = assignments[role];
    const band = bandFor(provider, role);
    const lineLow = band.low * mult;
    const lineHigh = band.high * mult;
    low += lineLow;
    high += lineHigh;
    byLine.push({
      role,
      provider,
      // stage key mirrors the role for provider-backed stages
      stage: role as unknown as CostLine['stage'],
      estimatedUsd: round2((lineLow + lineHigh) / 2),
    });
  }

  return {
    lowUsd: round2(low),
    highUsd: round2(high),
    byLine,
    currency,
  };
}

/** Whether the selected mode is likely to fit within the user's budget. */
export function budgetFits(estimate: CostEstimate, maxBudgetUsd: number): boolean {
  return maxBudgetUsd >= estimate.highUsd;
}

// Configurable per-provider token pricing (USD per 1M tokens), date-stamped.
// Used to compute ACTUAL cost from real usage when a provider does not report a
// dollar cost directly. Rough public list prices as of PRICING_AS_OF.
const TOKEN_PRICING: Record<ProviderId, { inPerM: number; outPerM: number }> = {
  google: { inPerM: 2.5, outPerM: 10 },
  perplexity: { inPerM: 2, outPerM: 8 },
  // Grok 4.5 current pricing: input $2/M, output $6/M (cached input $0.50/M);
  // server-side web/X/code tool calls are billed separately by invocation count.
  xai: { inPerM: 2, outPerM: 6 },
  anthropic: { inPerM: 5, outPerM: 25 },
};

export type CostBasis = 'provider_reported' | 'calculated_complete' | 'calculated_partial' | 'estimated';

export interface StageCost {
  usd: number;
  basis: CostBasis;
  providerReportedCostUsd?: number;
  calculatedCostUsd?: number;
  estimatedCostUsd?: number;
  /** Honest range: equals `usd` when confirmed/calculated; a band when estimated. */
  costLowUsd: number;
  costHighUsd: number;
  pricingAsOf: string;
}

/**
 * Resolve a stage's cost with an explicit basis, never presenting an estimate as
 * an actual charge:
 *  - provider_reported: the provider returned a dollar cost (authoritative)
 *  - calculated_complete: computed from real token usage
 *  - estimated: no usage/cost available → the mode band midpoint (clearly an estimate)
 */
export function computeStageCost(
  provider: ProviderId,
  usage: ActualUsageLike & { providerReportedCostUsd?: number },
  estimateUsd: number
): StageCost {
  if (usage.providerReportedCostUsd != null && usage.providerReportedCostUsd >= 0) {
    const v = round2(usage.providerReportedCostUsd);
    return {
      usd: v,
      basis: 'provider_reported',
      providerReportedCostUsd: v,
      costLowUsd: v,
      costHighUsd: v,
      pricingAsOf: PRICING_AS_OF,
    };
  }
  const calc = computeActualCost(provider, usage);
  if (calc != null) {
    return {
      usd: calc,
      basis: 'calculated_complete',
      calculatedCostUsd: calc,
      costLowUsd: calc,
      costHighUsd: calc,
      pricingAsOf: PRICING_AS_OF,
    };
  }
  const mid = round2(estimateUsd);
  return {
    usd: mid,
    basis: 'estimated',
    estimatedCostUsd: mid,
    costLowUsd: round2(estimateUsd * 0.6),
    costHighUsd: round2(estimateUsd * 1.4),
    pricingAsOf: PRICING_AS_OF,
  };
}

export interface ActualUsageLike {
  inputTokens?: number;
  outputTokens?: number;
}

/**
 * Compute the ACTUAL cost of a provider call from real token usage. Returns
 * null when token counts are unavailable, so callers can clearly label a value
 * as an estimate rather than actual usage.
 */
export function computeActualCost(provider: ProviderId, usage: ActualUsageLike): number | null {
  const p = TOKEN_PRICING[provider];
  if (!p) return null;
  const inT = usage.inputTokens;
  const outT = usage.outputTokens;
  if (inT == null && outT == null) return null;
  const cost = ((inT ?? 0) / 1_000_000) * p.inPerM + ((outT ?? 0) / 1_000_000) * p.outPerM;
  return round2(cost);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
