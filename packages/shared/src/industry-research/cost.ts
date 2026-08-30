import { RESEARCH_MODES } from './constants.js';
import type {
  CostEstimate,
  CostLine,
  ProviderAssignments,
  ProviderId,
  ProviderRole,
  ResearchMode,
} from './types.js';

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
// Calibrated to July 2026 MEASURED live runs (Full DD ≈ $6 without repair) so the
// UI's "expected" range tracks reality instead of a worst-case that never occurs.
const PROVIDER_ROLE_PRICING: Record<ProviderId, Partial<Record<ProviderRole, RolePriceBand>>> = {
  google: {
    // Gemini Deep Research measured ≈ $2/task; Forensic (Max) scales via MODE_MULTIPLIER.
    primary: { low: 1.0, high: 2.5 },
    independent: { low: 1.0, high: 2.5 },
    adjudicator: { low: 0.02, high: 0.2 },
  },
  perplexity: {
    primary: { low: 0.5, high: 1.5 },
    independent: { low: 0.4, high: 1.2 },
    social: { low: 0.4, high: 1.2 },
    factual_verifier: { low: 0.05, high: 0.4 },
  },
  xai: {
    social: { low: 0.5, high: 1.5 },
    primary: { low: 0.5, high: 1.5 },
    independent: { low: 0.5, high: 1.5 },
    adversarial_verifier: { low: 0.5, high: 1.6 },
  },
  anthropic: {
    synthesis: { low: 0.6, high: 1.6 },
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

// Read a numeric override from the environment when running under Node (worker /
// API). Guarded so this module stays safe to import in the browser bundle.
function envNum(name: string, dflt: number): number {
  try {
    if (typeof process !== 'undefined' && process.env && process.env[name] != null) {
      const n = Number(process.env[name]);
      if (Number.isFinite(n) && n >= 0) return n;
    }
  } catch {
    /* no process — browser */
  }
  return dflt;
}

// Configurable per-provider token pricing (USD per 1M tokens), date-stamped.
// Used to compute ACTUAL cost from real usage when a provider does not report a
// dollar cost directly. Rough public list prices as of PRICING_AS_OF.
const TOKEN_PRICING: Record<ProviderId, { inPerM: number; outPerM: number }> = {
  google: { inPerM: 2.5, outPerM: 10 },
  perplexity: { inPerM: 2, outPerM: 8 },
  // Grok 4.5 list pricing: input $2/M, output $6/M (cached input $0.50/M);
  // server-side web/X/code tool calls are billed separately by invocation count
  // and are handled explicitly in computeXaiCost (see XAI_PRICING).
  xai: { inPerM: 2, outPerM: 6 },
  anthropic: { inPerM: 5, outPerM: 25 },
};

// Anthropic prompt-cache multipliers relative to the base input rate (standard
// Anthropic ephemeral-cache economics): cache WRITE costs 1.25x input, cache
// READ costs 0.10x input.
const ANTHROPIC_CACHE_WRITE_MULT = envNum('ANTHROPIC_CACHE_WRITE_MULT', 1.25);
const ANTHROPIC_CACHE_READ_MULT = envNum('ANTHROPIC_CACHE_READ_MULT', 0.1);

/**
 * xAI Grok pricing, centrally configured and date-stamped. Token rates are per
 * 1M tokens; tool-call rates are per invocation. These are LIST-price estimates,
 * not a provider-reported dollar charge — which is why an xAI stage is billed as
 * `calculated_partial`, never `calculated_complete`.
 */
export const XAI_PRICING = {
  inputPerMillion: envNum('XAI_INPUT_PER_MILLION', 2),
  cachedInputPerMillion: envNum('XAI_CACHED_INPUT_PER_MILLION', 0.5),
  outputPerMillion: envNum('XAI_OUTPUT_PER_MILLION', 6),
  webSearchPerCall: envNum('XAI_WEB_SEARCH_PER_CALL', 0.025),
  xSearchPerCall: envNum('XAI_X_SEARCH_PER_CALL', 0.025),
  codeInterpreterPerCall: envNum('XAI_CODE_INTERPRETER_PER_CALL', 0),
};

export type CostBasis =
  | 'provider_reported'
  | 'calculated_complete'
  | 'calculated_partial'
  | 'estimated'
  | 'reused';

/** Per-component breakdown of a calculated stage cost (tokens + tool calls). */
export interface StageCostComponents {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  webSearchCalls?: number;
  xSearchCalls?: number;
  codeExecutionCalls?: number;
  inputCost?: number;
  cachedInputCost?: number;
  outputCost?: number;
  webSearchCost?: number;
  xSearchCost?: number;
  codeExecutionCost?: number;
}

/** Anthropic prompt-cache accounting for a synthesis/repair stage. */
export interface CacheMetrics {
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  normalInputTokens: number;
  outputTokens: number;
  cacheCreationCost: number;
  cacheReadCost: number;
  /** What the cache-read tokens WOULD have cost at the full input rate. */
  uncachedInputCost: number;
  cacheSavingsUsd: number;
  cacheHitRate: number;
}

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
  /** Present for calculated stages — the token/tool component breakdown. */
  components?: StageCostComponents;
  /** Present for Anthropic synthesis/repair — prompt-cache savings. */
  cache?: CacheMetrics;
}

export interface ActualUsageLike {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
  reasoningTokens?: number;
  webSearchCalls?: number;
  xSearchCalls?: number;
  codeExecutionCalls?: number;
}

/**
 * Resolve a stage's cost with an EXPLICIT basis, never presenting an estimate as
 * an actual charge:
 *  - provider_reported : the provider returned a dollar cost (authoritative)
 *  - calculated_complete: every billable component is known from real usage
 *  - calculated_partial : computed from usage + list prices, but not every
 *                         component is provider-confirmed (e.g. xAI tool calls)
 *  - estimated          : no usage/cost available → mode band (clearly an estimate)
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

  if (provider === 'xai') {
    const xai = computeXaiCost(usage);
    if (xai) {
      return {
        usd: xai.usd,
        // Never calculated_complete: tool-call and cached-token splits are
        // list-price estimates, not provider-confirmed line items.
        basis: 'calculated_partial',
        calculatedCostUsd: xai.usd,
        costLowUsd: xai.usd,
        costHighUsd: xai.usd,
        pricingAsOf: PRICING_AS_OF,
        components: xai.components,
      };
    }
    return estimatedStage(estimateUsd);
  }

  if (provider === 'anthropic') {
    const anth = computeAnthropicCost(usage);
    if (anth) {
      return {
        usd: anth.usd,
        basis: 'calculated_complete',
        calculatedCostUsd: anth.usd,
        costLowUsd: anth.usd,
        costHighUsd: anth.usd,
        pricingAsOf: PRICING_AS_OF,
        components: anth.components,
        cache: anth.cache,
      };
    }
    return estimatedStage(estimateUsd);
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
      components: {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      },
    };
  }
  return estimatedStage(estimateUsd);
}

function estimatedStage(estimateUsd: number): StageCost {
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

/**
 * Compute an xAI stage cost from real usage: input + cached-input + output token
 * charges PLUS per-call web/X/code tool charges. Returns null only when there is
 * no usable usage at all (then the caller falls back to an estimate).
 */
export function computeXaiCost(
  usage: ActualUsageLike
): { usd: number; components: StageCostComponents } | null {
  const inTok = usage.inputTokens ?? 0;
  const cachedTok = usage.cachedInputTokens ?? 0;
  const outTok = usage.outputTokens ?? 0;
  const web = usage.webSearchCalls ?? 0;
  const x = usage.xSearchCalls ?? 0;
  const code = usage.codeExecutionCalls ?? 0;
  if (!inTok && !outTok && !web && !x && !code) return null;

  // Non-cached input tokens are billed at the full input rate; cached at the
  // cheaper cached rate. If the API doesn't split them, cachedTok is 0.
  const freshIn = Math.max(0, inTok - cachedTok);
  const inputCost = (freshIn / 1_000_000) * XAI_PRICING.inputPerMillion;
  const cachedInputCost = (cachedTok / 1_000_000) * XAI_PRICING.cachedInputPerMillion;
  const outputCost = (outTok / 1_000_000) * XAI_PRICING.outputPerMillion;
  const webSearchCost = web * XAI_PRICING.webSearchPerCall;
  const xSearchCost = x * XAI_PRICING.xSearchPerCall;
  const codeExecutionCost = code * XAI_PRICING.codeInterpreterPerCall;
  const usd = round2(
    inputCost + cachedInputCost + outputCost + webSearchCost + xSearchCost + codeExecutionCost
  );
  return {
    usd,
    components: {
      inputTokens: inTok,
      cachedInputTokens: cachedTok,
      outputTokens: outTok,
      reasoningTokens: usage.reasoningTokens,
      webSearchCalls: web,
      xSearchCalls: x,
      codeExecutionCalls: code,
      inputCost: round4(inputCost),
      cachedInputCost: round4(cachedInputCost),
      outputCost: round4(outputCost),
      webSearchCost: round4(webSearchCost),
      xSearchCost: round4(xSearchCost),
      codeExecutionCost: round4(codeExecutionCost),
    },
  };
}

/**
 * Compute an Anthropic synthesis/repair cost with prompt-cache accounting.
 * Anthropic reports exact token counts (including cache read/creation), so this
 * is `calculated_complete`. cacheSavingsUsd is only meaningful when
 * cacheReadInputTokens > 0.
 */
export function computeAnthropicCost(
  usage: ActualUsageLike
): { usd: number; components: StageCostComponents; cache: CacheMetrics } | null {
  const normalIn = usage.inputTokens ?? 0;
  const cacheRead = usage.cachedInputTokens ?? 0;
  const cacheCreate = usage.cacheCreationInputTokens ?? 0;
  const outTok = usage.outputTokens ?? 0;
  if (!normalIn && !cacheRead && !cacheCreate && !outTok) return null;

  const inRate = TOKEN_PRICING.anthropic.inPerM;
  const outRate = TOKEN_PRICING.anthropic.outPerM;
  const normalInputCost = (normalIn / 1_000_000) * inRate;
  const cacheCreationCost = (cacheCreate / 1_000_000) * inRate * ANTHROPIC_CACHE_WRITE_MULT;
  const cacheReadCost = (cacheRead / 1_000_000) * inRate * ANTHROPIC_CACHE_READ_MULT;
  const outputCost = (outTok / 1_000_000) * outRate;
  const uncachedInputCost = (cacheRead / 1_000_000) * inRate; // full-price counterfactual
  const cacheSavingsUsd = uncachedInputCost - cacheReadCost;
  const totalInputUnits = normalIn + cacheCreate + cacheRead;
  const cacheHitRate = totalInputUnits > 0 ? cacheRead / totalInputUnits : 0;
  const usd = round2(normalInputCost + cacheCreationCost + cacheReadCost + outputCost);

  return {
    usd,
    components: {
      inputTokens: normalIn,
      cachedInputTokens: cacheRead,
      outputTokens: outTok,
      inputCost: round4(normalInputCost),
      cachedInputCost: round4(cacheReadCost),
      outputCost: round4(outputCost),
    },
    cache: {
      cacheCreationInputTokens: cacheCreate,
      cacheReadInputTokens: cacheRead,
      normalInputTokens: normalIn,
      outputTokens: outTok,
      cacheCreationCost: round4(cacheCreationCost),
      cacheReadCost: round4(cacheReadCost),
      uncachedInputCost: round4(uncachedInputCost),
      cacheSavingsUsd: round4(cacheSavingsUsd),
      cacheHitRate: Math.round(cacheHitRate * 1000) / 1000,
    },
  };
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

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
