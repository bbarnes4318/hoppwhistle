import { describe, it, expect } from 'vitest';

import {
  computeAnthropicCost,
  computeStageCost,
  computeXaiCost,
  XAI_PRICING,
  type CostBasis,
} from '../cost';

describe('xAI cost accounting — every component + calculated_partial basis', () => {
  it('sums input + cached-input + output token charges AND web/X/code tool-call charges', () => {
    const r = computeXaiCost({
      inputTokens: 1_000_000,
      cachedInputTokens: 200_000,
      outputTokens: 500_000,
      webSearchCalls: 4,
      xSearchCalls: 2,
      codeExecutionCalls: 1,
    });
    expect(r).not.toBeNull();
    const c = r!.components;
    // 800k fresh input @ $2/M = 1.60; 200k cached @ $0.50/M = 0.10; 500k out @ $6/M = 3.00
    expect(c.inputCost).toBeCloseTo(1.6, 3);
    expect(c.cachedInputCost).toBeCloseTo(0.1, 3);
    expect(c.outputCost).toBeCloseTo(3.0, 3);
    // tool calls: 4*0.025 + 2*0.025 + 1*0 = 0.15
    expect(c.webSearchCost).toBeCloseTo(4 * XAI_PRICING.webSearchPerCall, 4);
    expect(c.xSearchCost).toBeCloseTo(2 * XAI_PRICING.xSearchPerCall, 4);
    expect(c.codeExecutionCost).toBeCloseTo(0, 4);
    // total = 1.60 + 0.10 + 3.00 + 0.10 + 0.05 + 0 = 4.85
    expect(r!.usd).toBeCloseTo(4.85, 2);
  });

  it('computeStageCost labels xAI as calculated_partial (never calculated_complete) with components', () => {
    const sc = computeStageCost(
      'xai',
      { inputTokens: 100_000, outputTokens: 50_000, webSearchCalls: 3, xSearchCalls: 1 },
      2.0
    );
    expect(sc.basis).toBe('calculated_partial');
    expect(sc.basis).not.toBe('calculated_complete');
    expect(sc.components?.webSearchCalls).toBe(3);
    expect(sc.components?.xSearchCalls).toBe(1);
    // low === high === usd for a calculated stage (not a band)
    expect(sc.costLowUsd).toBe(sc.usd);
    expect(sc.costHighUsd).toBe(sc.usd);
  });

  it('xAI with NO usage at all falls back to an estimated band (never presented as actual)', () => {
    const sc = computeStageCost('xai', {}, 3.0);
    expect(sc.basis).toBe('estimated');
    expect(sc.costLowUsd).toBeLessThan(sc.costHighUsd);
  });
});

describe('Anthropic prompt-cache accounting', () => {
  it('computes cache savings and hit rate only from real cache-read tokens', () => {
    const r = computeAnthropicCost({
      inputTokens: 2_000, // fresh, uncached
      cachedInputTokens: 40_000, // cache read
      cacheCreationInputTokens: 0,
      outputTokens: 6_000,
    });
    expect(r).not.toBeNull();
    const cache = r!.cache;
    // savings = cacheRead * inRate * 0.9 = 40000/1e6 * 5 * 0.9 = 0.18
    expect(cache.cacheSavingsUsd).toBeCloseTo(0.18, 3);
    expect(cache.cacheReadInputTokens).toBe(40_000);
    // hitRate = 40000 / (2000 + 0 + 40000) ≈ 0.952
    expect(cache.cacheHitRate).toBeGreaterThan(0.9);
    expect(cache.cacheHitRate).toBeLessThanOrEqual(1);
  });

  it('reports zero savings and zero hit rate when nothing was cached', () => {
    const r = computeAnthropicCost({ inputTokens: 10_000, outputTokens: 3_000 });
    expect(r!.cache.cacheReadInputTokens).toBe(0);
    expect(r!.cache.cacheSavingsUsd).toBe(0);
    expect(r!.cache.cacheHitRate).toBe(0);
  });

  it('computeStageCost labels Anthropic calculated_complete and attaches cache metrics', () => {
    const sc = computeStageCost(
      'anthropic',
      { inputTokens: 2_000, cachedInputTokens: 40_000, outputTokens: 6_000 },
      1.0
    );
    expect(sc.basis).toBe('calculated_complete');
    expect(sc.cache).toBeTruthy();
    expect(sc.cache!.cacheSavingsUsd).toBeGreaterThan(0);
  });
});

describe('cost basis contract', () => {
  it('provider-reported dollar cost is authoritative', () => {
    const sc = computeStageCost('perplexity', { providerReportedCostUsd: 0.42 } as never, 1.0);
    expect(sc.basis).toBe('provider_reported');
    expect(sc.usd).toBe(0.42);
  });

  it("'reused' is a first-class CostBasis value", () => {
    const bases: CostBasis[] = [
      'provider_reported',
      'calculated_complete',
      'calculated_partial',
      'estimated',
      'reused',
    ];
    expect(bases).toContain('reused');
  });
});
