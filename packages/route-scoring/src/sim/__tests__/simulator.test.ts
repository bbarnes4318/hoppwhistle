/**
 * Phase 5 — simulator scenarios (§4.3).
 *
 * This file IS the verification for Phase 5. There is no lab-box step: the SBC
 * trunk is paused for a carrier compliance review, and the CDR columns the
 * scorer reads do not exist yet. The package has to be correct before any real
 * data exists to check it against, which is only possible because ground truth
 * is an input here.
 *
 * The confounder scenarios (§2) use exact equality rather than tolerance
 * wherever the claim is "this row category cannot move the estimate". A
 * tolerance would let a small contamination pass as noise, and small
 * contamination is precisely the failure being tested for.
 */

import { describe, expect, it } from 'vitest';

import { createRng } from '../../estimator.js';
import { scoreRoutes } from '../../scorer.js';
import {
  DEFAULT_ROUTE_SCORING_POLICY,
  RouteReason,
  type RouteConfig,
  type RouteObservation,
  type RouteScoreDetail,
  type RouteScoringInputs,
} from '../../types.js';
import { defaultRouteSimConfig, runRouteSimulation, truthKey } from '../simulator.js';

const WINDOW_START = 1_700_000_000_000;
const DAY = 86_400_000;
const PREFIXES = ['212', '312', '415'];

const ROUTES: RouteConfig[] = [
  {
    name: 'ShortDuration',
    carrier: 'acme',
    deck: 'SD',
    ratesByPrefix: new Map(PREFIXES.map(p => [p, 0.0017])),
  },
  {
    name: 'CVPreferred',
    carrier: 'acme',
    deck: 'CV',
    ratesByPrefix: new Map(PREFIXES.map(p => [p, 0.0021])),
  },
  {
    name: 'MASH',
    carrier: 'acme',
    deck: 'MASH',
    ratesByPrefix: new Map(PREFIXES.map(p => [p, 0.0029])),
  },
];

function row(over: Partial<RouteObservation> = {}): RouteObservation {
  return {
    reject_reason: '',
    did_selection_reason: 'npa_match',
    topology_epoch: 'epoch-a',
    attempt_index: 1,
    route_name: 'ShortDuration',
    destination_npa: '212',
    answered: false,
    sip_response: 486,
    dialed_seconds: 0,
    observedAtMs: WINDOW_START + DAY,
    ...over,
  };
}

/** `n` rows of which the first `answered` are answered. Deterministic by construction. */
function rows(
  n: number,
  answered: number,
  over: Partial<RouteObservation> = {}
): RouteObservation[] {
  return Array.from({ length: n }, (_, i) => {
    const ok = i < answered;
    return row({
      ...over,
      answered: ok,
      sip_response: ok ? 200 : 486,
      dialed_seconds: ok ? 45 : 0,
    });
  });
}

function inputs(over: Partial<RouteScoringInputs> = {}): RouteScoringInputs {
  return {
    nowMs: WINDOW_START + 30 * DAY,
    windowStartMs: WINDOW_START,
    currentEpoch: 'epoch-a',
    observations: [],
    routes: ROUTES,
    // Deliberately slack so ordering scenarios are not perturbed by the budget.
    // The ceiling gets its own scenario below.
    maxBlend: 0.01,
    trafficWeights: new Map([['212', 1_000]]),
    rng: createRng(42),
    currentTable: new Map(),
    policy: { ...DEFAULT_ROUTE_SCORING_POLICY, holdDownMargin: 0 },
    ...over,
  };
}

const leadFor = (d: { table: Map<string, string[]> }, prefix: string): string | undefined =>
  d.table.get(prefix)?.[0];

// ---------------------------------------------------------------------------
// §2 CONFOUNDERS — one scenario each, proving contamination does not occur.
// ---------------------------------------------------------------------------

describe('CONFOUNDER §2.3 — rejected rows never move an estimate', () => {
  // 36,683 of these landed in a five-day window against 101,048 CDR rows. They
  // never reached a Dial(). In the denominator they understate every route's ASR
  // by ~15%, and not uniformly: the error concentrates in whichever NPAs
  // exhausted their DID pool first, which is the dimension being scored.
  const clean = [
    ...rows(600, 300, { route_name: 'ShortDuration' }),
    ...rows(600, 180, { route_name: 'CVPreferred' }),
    ...rows(600, 180, { route_name: 'MASH' }),
  ];

  it('produces a byte-identical decision with 5,000 rejected rows added', () => {
    const poison = rows(5_000, 0, {
      route_name: 'ShortDuration',
      reject_reason: 'NO_DID_AVAILABLE',
    });

    const a = scoreRoutes(inputs({ observations: clean, rng: createRng(42) }));
    const b = scoreRoutes(inputs({ observations: [...clean, ...poison], rng: createRng(42) }));

    // If these leaked into the denominator ShortDuration would drop from 50% to
    // ~5% and lose the table outright.
    expect(b.table).toEqual(a.table);
    expect(b.projectedAsr).toBe(a.projectedAsr);
    expect(b.projectedBlend).toBe(a.projectedBlend);
    expect(b.details.map(d => d.posteriorMean)).toEqual(a.details.map(d => d.posteriorMean));

    expect(a.rejectedRows).toBe(0);
    expect(b.rejectedRows).toBe(5_000);
    expect(b.scoredRows).toBe(a.scoredRows);
  });

  it('excludes a reject_reason it has never seen before', () => {
    // The test is "non-empty", full stop. Matching against a known-values list
    // is how a reason added upstream later becomes an answered-call denominator.
    const novel = rows(5_000, 0, {
      route_name: 'ShortDuration',
      reject_reason: 'SOME_REASON_INVENTED_IN_2027',
    });

    const a = scoreRoutes(inputs({ observations: clean, rng: createRng(42) }));
    const b = scoreRoutes(inputs({ observations: [...clean, ...novel], rng: createRng(42) }));

    expect(b.table).toEqual(a.table);
    expect(b.projectedAsr).toBe(a.projectedAsr);
    expect(b.rejectedRows).toBe(5_000);
  });
});

describe('CONFOUNDER §2.4 — overflow and npa_match strata are never pooled', () => {
  // An overflow DID is not local presence for the destination, and overflow
  // usage spikes exactly when a pool is exhausted. A route that looks bad may
  // simply have been dialled with overflow DIDs during an exhaustion window.
  //
  // ShortDuration: 60% on npa_match, 5% on overflow, 80% of its volume overflow
  //                -> pooled it reads 16%
  // CVPreferred:   35% on both -> pooled it reads 35%
  //
  // Pooled, CVPreferred wins. Stratified, ShortDuration wins. It is the correct
  // answer, because the table assigns local-presence dialling.
  const observations = [
    ...rows(400, 240, { route_name: 'ShortDuration', did_selection_reason: 'npa_match' }),
    ...rows(1_600, 80, { route_name: 'ShortDuration', did_selection_reason: 'overflow' }),
    ...rows(400, 140, { route_name: 'CVPreferred', did_selection_reason: 'npa_match' }),
    ...rows(1_600, 560, { route_name: 'CVPreferred', did_selection_reason: 'overflow' }),
  ];

  it('ranks on the npa_match stratum, not the pooled average', () => {
    const d = scoreRoutes(inputs({ observations, rng: createRng(42) }));
    expect(leadFor(d, '212')).toBe('ShortDuration');
  });

  it('reports the two strata as separate estimates', () => {
    const d = scoreRoutes(inputs({ observations, rng: createRng(42) }));
    const sd = d.details.find(x => x.routeName === 'ShortDuration' && x.prefix === '212');

    expect(sd).toBeDefined();
    // ~0.54 on npa_match against ~0.06 on overflow. A pooled figure would sit
    // near 0.16 and be a description of neither population.
    expect(sd!.posteriorMean).toBeGreaterThan(0.5);
    expect(sd!.overflowPosteriorMean).toBeLessThan(0.15);
    expect(sd!.observations).toBe(400);
    expect(sd!.overflowObservations).toBe(1_600);
  });
});

describe('CONFOUNDER §2.5 — first-attempt and retry outcomes are never pooled', () => {
  // Every retried call already failed once, so retries are drawn from a
  // systematically harder population. Pooling makes fallback routes look worse
  // than they are and the scorer demotes them until they are never tried, which
  // is self-fulfilling.
  const first = [
    ...rows(400, 200, { route_name: 'ShortDuration' }),
    ...rows(400, 140, { route_name: 'CVPreferred' }),
    ...rows(400, 140, { route_name: 'MASH' }),
  ];

  it('produces a byte-identical decision with 3,000 retry rows added', () => {
    const retries = rows(3_000, 30, { route_name: 'ShortDuration', attempt_index: 2 });

    const a = scoreRoutes(inputs({ observations: first, rng: createRng(42) }));
    const b = scoreRoutes(inputs({ observations: [...first, ...retries], rng: createRng(42) }));

    expect(b.table).toEqual(a.table);
    expect(b.projectedAsr).toBe(a.projectedAsr);
    expect(b.scoredRows).toBe(a.scoredRows);
    expect(b.details.map(d => d.posteriorMean)).toEqual(a.details.map(d => d.posteriorMean));
  });

  it('reports retry performance separately, because it is a useful number', () => {
    const retries = rows(3_000, 30, { route_name: 'ShortDuration', attempt_index: 2 });
    const b = scoreRoutes(inputs({ observations: [...first, ...retries], rng: createRng(42) }));

    expect(b.retry.attempts).toBe(3_000);
    expect(b.retry.answered).toBe(30);
    expect(b.retry.rescueRate).toBeCloseTo(0.01, 10);
  });

  it('does not let a third attempt through either', () => {
    const third = rows(2_000, 0, { route_name: 'ShortDuration', attempt_index: 3 });
    const a = scoreRoutes(inputs({ observations: first, rng: createRng(42) }));
    const b = scoreRoutes(inputs({ observations: [...first, ...third], rng: createRng(42) }));

    expect(b.projectedAsr).toBe(a.projectedAsr);
    expect(b.retry.attempts).toBe(2_000);
  });
});

describe('CONFOUNDER §2.2 — an epoch change drops confidence rather than pooling', () => {
  const result = runRouteSimulation(
    defaultRouteSimConfig({
      seed: 5,
      nights: 9,
      callsPerNight: 150,
      routingMode: 'uniform',
      maxBlend: 0.01,
      epochChangeAtNight: 6,
      epochAfterChange: 'epoch-b',
      policy: { ...DEFAULT_ROUTE_SCORING_POLICY, holdDownMargin: 0 },
    })
  );

  it('drops to LOW confidence on the night the topology changes', () => {
    const before = result.nights[5].decision;
    const after = result.nights[6].decision;

    expect(before.confidence).not.toBe('LOW');
    expect(after.confidence).toBe('LOW');
    expect(after.reasons).toContain(RouteReason.EPOCH_CHANGED);
  });

  it('does not count prior-epoch rows as current-epoch evidence', () => {
    const after = result.nights[6].decision;

    // Nights 0-5 produced 900 rows under epoch-a; night 6 produced 150 under
    // epoch-b. The old rows are visible and down-weighted, never pooled.
    expect(after.offEpochRows).toBe(900);
    expect(after.scoredRows).toBe(150);
  });

  it('recovers on its own once the new epoch accumulates data', () => {
    // No manual reset, because a manual reset is a step someone forgets.
    const settled = result.nights[8].decision;
    expect(settled.scoredRows).toBeGreaterThan(
      DEFAULT_ROUTE_SCORING_POLICY.minPostDeployObservations
    );
    expect(settled.reasons).not.toContain(RouteReason.EPOCH_CHANGED);
  });
});

describe('CONFOUNDER — a thinly observed parent lends thin confidence (fifth scenario)', () => {
  // Not in the spec as written. A prior weight that is a fixed anchor rather
  // than a function of the parent's own evidence would let a parent with 40
  // observations lend a child the confidence of a parent with 40,000.
  const base = {
    seed: 3,
    routingMode: 'uniform' as const,
    maxBlend: 0.01,
    policy: { ...DEFAULT_ROUTE_SCORING_POLICY, holdDownMargin: 0 },
  };

  it('reports LOW confidence throughout when the fleet is barely observed', () => {
    const thin = runRouteSimulation(
      defaultRouteSimConfig({ ...base, nights: 2, callsPerNight: 120 })
    );

    expect(thin.final.scoredRows).toBeGreaterThanOrEqual(
      DEFAULT_ROUTE_SCORING_POLICY.minPostDeployObservations
    );
    expect(thin.final.confidence).toBe('LOW');
    expect(thin.final.details.every(d => d.confidence === 'LOW')).toBe(true);
  });

  it('reaches HIGH confidence on the same topology once the fleet is well observed', () => {
    const fat = runRouteSimulation(
      defaultRouteSimConfig({ ...base, nights: 10, callsPerNight: 3_000 })
    );

    expect(fat.final.details.some(d => d.confidence === 'HIGH')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §4.3 ORDERING SCENARIOS — does the scorer converge on the truth?
// ---------------------------------------------------------------------------

const orderingPolicy = { ...DEFAULT_ROUTE_SCORING_POLICY, holdDownMargin: 0 };

function truth(entries: Array<[string, string, number]>): Map<string, number> {
  const m = new Map<string, number>();
  for (const [route, npa, asr] of entries) {
    m.set(truthKey(route, npa, 'npa_match'), asr);
    m.set(truthKey(route, npa, 'overflow'), asr);
  }
  return m;
}

describe('§4.3 — a route that is good everywhere', () => {
  it('wins every prefix', () => {
    const trueAsr = truth([
      ...PREFIXES.map(p => ['ShortDuration', p, 0.55] as [string, string, number]),
      ...PREFIXES.map(p => ['CVPreferred', p, 0.3] as [string, string, number]),
      ...PREFIXES.map(p => ['MASH', p, 0.28] as [string, string, number]),
    ]);

    const result = runRouteSimulation(
      defaultRouteSimConfig({
        seed: 11,
        nights: 25,
        callsPerNight: 900,
        trueAsr,
        maxBlend: 0.01,
        policy: orderingPolicy,
      })
    );

    expect(result.leadAccuracy).toBe(1);
    for (const lead of result.leads) expect(lead.chosen).toBe('ShortDuration');
  });
});

describe('§4.3 — a route that is good only in specific NPAs', () => {
  it('wins there and nowhere else', () => {
    const trueAsr = truth([
      ['ShortDuration', '212', 0.25],
      ['ShortDuration', '312', 0.6],
      ['ShortDuration', '415', 0.25],
      ['CVPreferred', '212', 0.45],
      ['CVPreferred', '312', 0.45],
      ['CVPreferred', '415', 0.45],
      ['MASH', '212', 0.3],
      ['MASH', '312', 0.3],
      ['MASH', '415', 0.3],
    ]);

    const result = runRouteSimulation(
      defaultRouteSimConfig({
        seed: 13,
        nights: 25,
        callsPerNight: 900,
        trueAsr,
        maxBlend: 0.01,
        policy: orderingPolicy,
      })
    );

    // This is the scenario a route-level-only model gets wrong: pooled across
    // NPAs ShortDuration averages ~0.37 and looks like a mediocre global route.
    expect(result.final.table.get('312')?.[0]).toBe('ShortDuration');
    expect(result.final.table.get('212')?.[0]).toBe('CVPreferred');
    expect(result.final.table.get('415')?.[0]).toBe('CVPreferred');
  });
});

describe('§4.3 — a route whose ASR changes mid-window', () => {
  it('demotes it once the new behaviour dominates the window', () => {
    const trueAsr = truth([
      ...PREFIXES.map(p => ['ShortDuration', p, 0.55] as [string, string, number]),
      ...PREFIXES.map(p => ['CVPreferred', p, 0.4] as [string, string, number]),
      ...PREFIXES.map(p => ['MASH', p, 0.3] as [string, string, number]),
    ]);

    const result = runRouteSimulation(
      defaultRouteSimConfig({
        seed: 17,
        nights: 40,
        callsPerNight: 900,
        trueAsr,
        maxBlend: 0.01,
        policy: orderingPolicy,
        // ShortDuration collapses in 212 only, one fifth of the way in.
        asrShift: { atNight: 8, key: truthKey('ShortDuration', '212', 'npa_match'), to: 0.05 },
      })
    );

    expect(result.final.table.get('212')?.[0]).not.toBe('ShortDuration');
    // The other prefixes are untouched, so it should still lead them.
    expect(result.final.table.get('312')?.[0]).toBe('ShortDuration');
  });
});

describe('§4.3 — a cell with zero observations', () => {
  // MASH is configured with a rate for every prefix but appears in no CDR row.
  const observations = [
    ...rows(600, 300, { route_name: 'ShortDuration' }),
    ...rows(600, 240, { route_name: 'CVPreferred' }),
  ];

  it('inherits its parent posterior instead of crashing or reading as zero', () => {
    const d = scoreRoutes(inputs({ observations, rng: createRng(42) }));
    const mash = d.details.find(x => x.routeName === 'MASH' && x.prefix === '212');

    expect(mash).toBeDefined();
    expect(mash!.observations).toBe(0);
    expect(Number.isFinite(mash!.posteriorMean)).toBe(true);
    // Inherits the fleet posterior (~45% across the two observed routes) rather
    // than reading as a 0% route that would never be tried again.
    expect(mash!.posteriorMean).toBeGreaterThan(0.3);
    expect(mash!.confidence).toBe('LOW');
  });

  it('still gets ranked, so it can be explored', () => {
    const d = scoreRoutes(inputs({ observations, rng: createRng(42) }));
    expect(d.table.get('212')).toContain('MASH');
  });
});

// ---------------------------------------------------------------------------
// §3.4 / §3.5 — the budget and the hold-down
// ---------------------------------------------------------------------------

describe('§3.4 — the blend ceiling', () => {
  // MASH is the best route everywhere and the most expensive at $0.0029 against
  // a $0.0025 ceiling, so the budget has to bind.
  const observations = PREFIXES.flatMap(p => [
    ...rows(600, 360, { route_name: 'MASH', destination_npa: p }),
    ...rows(600, 210, { route_name: 'CVPreferred', destination_npa: p }),
    ...rows(600, 180, { route_name: 'ShortDuration', destination_npa: p }),
  ]);

  const trafficWeights = new Map(PREFIXES.map(p => [p, 1_000]));

  it('holds the projection under the ceiling and says so', () => {
    const d = scoreRoutes(
      inputs({ observations, trafficWeights, maxBlend: 0.0025, rng: createRng(42) })
    );

    expect(d.reasons).toContain(RouteReason.BLEND_CEILING_BINDING);
    expect(d.projectedBlend).toBeLessThanOrEqual(0.0025);
  });

  it('does not bind when the ceiling is slack', () => {
    const d = scoreRoutes(
      inputs({ observations, trafficWeights, maxBlend: 0.01, rng: createRng(42) })
    );

    expect(d.reasons).not.toContain(RouteReason.BLEND_CEILING_BINDING);
    for (const p of PREFIXES) expect(d.table.get(p)?.[0]).toBe('MASH');
  });

  it('weights the projection by the UPPER bound of ASR, not the mean or the lower bound', () => {
    // Regression guard for the single most invertible line in this package.
    //
    // The blend is minute-weighted, and billed minutes scale with ASR, so ASR
    // sets each route's SHARE of the blended rate. Understating an expensive
    // route's ASR understates the minutes it carries, the projection reads
    // cheaper than production, and the ceiling gets breached by a table that
    // validated as affordable.
    //
    // 212 leads with the expensive route on a THIN sample and 312 leads with the
    // cheap route on a THICK one, so the three weightings genuinely disagree —
    // without that asymmetry this test would pass under any of them.
    const mixed = [
      ...rows(120, 84, { route_name: 'MASH', destination_npa: '212' }),
      ...rows(120, 24, { route_name: 'ShortDuration', destination_npa: '212' }),
      ...rows(4_000, 2_800, { route_name: 'ShortDuration', destination_npa: '312' }),
      ...rows(4_000, 800, { route_name: 'MASH', destination_npa: '312' }),
    ];
    const weights = new Map([
      ['212', 1_000],
      ['312', 1_000],
    ]);

    const d = scoreRoutes(
      inputs({
        observations: mixed,
        trafficWeights: weights,
        maxBlend: 0.01,
        rng: createRng(42),
      })
    );

    expect(d.table.get('212')?.[0]).toBe('MASH');
    expect(d.table.get('312')?.[0]).toBe('ShortDuration');

    const blendWeightedBy = (pick: (detail: RouteScoreDetail) => number): number => {
      let cost = 0;
      let minutes = 0;
      for (const [prefix, names] of d.table) {
        const w = weights.get(prefix) ?? 0;
        const lead = d.details.find(x => x.prefix === prefix && x.routeName === names[0]);
        if (!lead) continue;
        const m = w * pick(lead);
        minutes += m;
        cost += m * lead.ratePerMinute;
      }
      return cost / minutes;
    };

    const byUpper = blendWeightedBy(x => x.upperBoundAsr);
    const byMean = blendWeightedBy(x => x.posteriorMean);
    const byLower = blendWeightedBy(x => x.lowerBoundAsr);

    // The three must actually differ, or this proves nothing.
    expect(byUpper).not.toBeCloseTo(byMean, 6);
    expect(byUpper).not.toBeCloseTo(byLower, 6);
    // Conservative for a COST projection means the highest of the three.
    expect(byUpper).toBeGreaterThan(byMean);
    expect(byMean).toBeGreaterThan(byLower);

    expect(d.projectedBlend).toBeCloseTo(byUpper, 12);
  });

  it('demotes rather than applying a flat per-prefix rate cap', () => {
    // A flat cap would discard the expensive-but-connecting route entirely.
    // Greedy demotion keeps it where it earns its price.
    const d = scoreRoutes(
      inputs({ observations, trafficWeights, maxBlend: 0.0025, rng: createRng(42) })
    );
    const leads = PREFIXES.map(p => d.table.get(p)?.[0]);
    expect(leads).toContain('MASH');
  });
});

describe('§3.5 — hold-down', () => {
  const observations = [
    ...rows(600, 300, { route_name: 'ShortDuration' }),
    ...rows(600, 290, { route_name: 'CVPreferred' }),
    ...rows(600, 280, { route_name: 'MASH' }),
  ];

  it('leaves a working table alone when the proposal is not clearly better', () => {
    const currentTable = new Map([['212', ['MASH', 'CVPreferred', 'ShortDuration']]]);
    const d = scoreRoutes(
      inputs({
        observations,
        currentTable,
        rng: createRng(42),
        policy: { ...DEFAULT_ROUTE_SCORING_POLICY, holdDownMargin: 0.5 },
      })
    );

    expect(d.reason).toBe(RouteReason.HELD_AT_PREVIOUS_TABLE);
    expect(d.table).toEqual(currentTable);
    expect(d.diff.identical).toBe(true);
  });

  it('moves when the margin is cleared', () => {
    const currentTable = new Map([['212', ['MASH', 'CVPreferred', 'ShortDuration']]]);
    const d = scoreRoutes(
      inputs({
        observations,
        currentTable,
        rng: createRng(42),
        policy: { ...DEFAULT_ROUTE_SCORING_POLICY, holdDownMargin: 0 },
      })
    );

    expect(d.reasons).not.toContain(RouteReason.HELD_AT_PREVIOUS_TABLE);
  });
});

// ---------------------------------------------------------------------------
// §2.1 — the window
// ---------------------------------------------------------------------------

describe('§2.1 — the post-deploy window', () => {
  it('refuses to score rather than scoring on too little, and says why', () => {
    const d = scoreRoutes(
      inputs({ observations: rows(50, 25, { route_name: 'ShortDuration' }), rng: createRng(42) })
    );

    expect(d.reason).toBe(RouteReason.INSUFFICIENT_POST_DEPLOY_DATA);
    expect(d.confidence).toBe('LOW');
    // Refusal is a reported reason, never a silent fallback to a scored table.
    expect(d.table.size).toBe(0);
  });

  it('keeps the previously loaded table when it refuses', () => {
    const currentTable = new Map([['212', ['CVPreferred', 'MASH']]]);
    const d = scoreRoutes(
      inputs({
        observations: rows(50, 25, {}),
        currentTable,
        rng: createRng(42),
      })
    );

    expect(d.table).toEqual(currentTable);
  });

  it('excludes rows stamped before the window opened', () => {
    // Amplification was 2.48x on 08-11 and 1.67x on 08-12 as the gateway count
    // fell 7 -> 6 -> 5. Those attempts come from a different process.
    const inWindow = [
      ...rows(600, 300, { route_name: 'ShortDuration' }),
      ...rows(600, 180, { route_name: 'CVPreferred' }),
    ];
    const preDeploy = rows(5_000, 0, {
      route_name: 'ShortDuration',
      observedAtMs: WINDOW_START - DAY,
    });

    const a = scoreRoutes(inputs({ observations: inWindow, rng: createRng(42) }));
    const b = scoreRoutes(
      inputs({ observations: [...inWindow, ...preDeploy], rng: createRng(42) })
    );

    expect(b.table).toEqual(a.table);
    expect(b.projectedAsr).toBe(a.projectedAsr);
    expect(b.outOfWindowRows).toBe(5_000);
  });
});

// ---------------------------------------------------------------------------
// Determinism — the property the whole design rests on
// ---------------------------------------------------------------------------

describe('determinism', () => {
  it('produces identical results for the same seed and config', () => {
    const cfg = defaultRouteSimConfig({ seed: 99, nights: 6, callsPerNight: 400 });
    const a = runRouteSimulation(cfg);
    const b = runRouteSimulation(cfg);

    expect(b.final.table).toEqual(a.final.table);
    expect(b.realisedAsr).toBe(a.realisedAsr);
    expect(b.nights.map(n => n.decision.projectedAsr)).toEqual(
      a.nights.map(n => n.decision.projectedAsr)
    );
  });

  it('produces different exploration for a different seed', () => {
    const a = runRouteSimulation(defaultRouteSimConfig({ seed: 1, nights: 4, callsPerNight: 300 }));
    const b = runRouteSimulation(defaultRouteSimConfig({ seed: 2, nights: 4, callsPerNight: 300 }));
    expect(b.nights.map(n => n.decision.projectedAsr)).not.toEqual(
      a.nights.map(n => n.decision.projectedAsr)
    );
  });

  it('never calls Date.now or Math.random', () => {
    // Structural, not a matter of discipline: the scorer takes nowMs and rng as
    // inputs and this package imports nothing that could reach a clock.
    const realNow = Date.now;
    const realRandom = Math.random;
    Date.now = () => {
      throw new Error('scorer called Date.now()');
    };
    Math.random = () => {
      throw new Error('scorer called Math.random()');
    };
    try {
      expect(() =>
        runRouteSimulation(defaultRouteSimConfig({ seed: 4, nights: 3, callsPerNight: 300 }))
      ).not.toThrow();
    } finally {
      Date.now = realNow;
      Math.random = realRandom;
    }
  });
});
