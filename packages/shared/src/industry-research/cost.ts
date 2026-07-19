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
    primary: { low: 2.0, high: 8.0 },
    independent: { low: 2.0, high: 8.0 },
    adjudicator: { low: 0.3, high: 1.5 },
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
  xai: { inPerM: 3, outPerM: 15 },
  anthropic: { inPerM: 5, outPerM: 25 },
};

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
