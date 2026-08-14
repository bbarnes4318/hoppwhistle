/**
 * Phase 5 — deterministic route-scoring simulator.
 *
 * Normative spec: `phase-5-route-scoring-spec.md` §4.3. This is the PRIMARY
 * verification for Phase 5 — there is no `VERIFY:` item needing the lab box, and
 * there could not be: the SBC trunk is paused for a carrier compliance review,
 * the CDR columns this scorer reads do not exist yet, and the whole package has
 * to be correct before any real data exists to check it against.
 *
 * Sibling to `runSimulation` in `apps/dialer-v2/src/sim/simulator.ts`, and built
 * the same way. Everything is seeded. The same seed and config produce
 * byte-identical results, so a failing assertion is always reproducible and a
 * regression is always bisectable.
 *
 * The model generates synthetic CDR rows from a known ground-truth ASR per
 * (route × NPA × did_reason), drives the real `scoreRoutes`, and measures
 * whether the ordering it converges on is the true one. Because ground truth is
 * an input, "the scorer is confidently wrong" is a detectable state here and
 * only here.
 */

import { createRng } from '../estimator.js';
import { scoreRoutes } from '../scorer.js';
import {
  DEFAULT_ROUTE_SCORING_POLICY,
  type DidSelectionReason,
  type RouteConfig,
  type RouteDecision,
  type RouteObservation,
  type RouteScoringPolicy,
} from '../types.js';

const NIGHT_MS = 86_400_000;

/** Ground-truth key. Mirrors the scorer's stratum exactly — route × NPA × DID reason. */
export function truthKey(route: string, npa: string, did: DidSelectionReason): string {
  return `${route} ${npa} ${did}`;
}

export interface RouteSimConfig {
  seed: number;
  /** Scoring runs. The scorer is a nightly job. */
  nights: number;
  callsPerNight: number;
  prefixes: string[];
  routes: RouteConfig[];

  /** Ground-truth ASR by {@link truthKey}. Missing cells fall back to `fallbackAsr`. */
  trueAsr: Map<string, number>;
  fallbackAsr: number;

  maxBlend: number;
  windowStartMs: number;
  epoch: string;
  policy: RouteScoringPolicy;
  trafficWeights: Map<string, number>;

  /**
   * How calls are assigned to routes.
   *
   * `table` closes the feedback loop — the previous night's table decides where
   * tonight's calls go — which is what convergence scenarios need. It is also
   * the honest model: a route that is never led is never measured, and Thompson
   * sampling occasionally ranking an uncertain route first is the ONLY thing
   * that gets it any data. `uniform` spreads calls evenly and is for
   * contamination scenarios, where the question is whether a polluted row moves
   * an estimate rather than whether the ordering converges.
   */
  routingMode: 'table' | 'uniform';

  // ---- Confounder injection ------------------------------------------------
  /** Share of calls dialled on a non-local (overflow) DID. §2.4 */
  overflowShare: number;
  /** Share of rows that never reached a Dial() and carry a `reject_reason`. §2.3 */
  rejectShare: number;
  /** Share of rows that are a second attempt. §2.5 */
  retryShare: number;
  /** Share of rows stamped before `windowStartMs`. §2.1 */
  preWindowShare: number;
  /** Ground truth for one cell changes at this night (list-quality shift). */
  asrShift?: { atNight: number; key: string; to: number };
  /** The topology epoch changes at this night. §2.2 */
  epochChangeAtNight?: number;
  /** Epoch identifier adopted after the change. */
  epochAfterChange?: string;
}

export interface RouteSimNightRecord {
  night: number;
  decision: RouteDecision;
  /** Rows generated up to and including this night. */
  observations: number;
  /** The epoch in force while this night's calls were placed. */
  epoch: string;
}

export interface RouteSimLead {
  prefix: string;
  chosen: string | null;
  trueBest: string;
  chosenTrueAsr: number;
  bestTrueAsr: number;
}

export interface RouteSimResult {
  config: RouteSimConfig;
  nights: RouteSimNightRecord[];
  final: RouteDecision;
  /** Every row generated, so a test can inject contamination and re-score. */
  observations: RouteObservation[];
  leads: RouteSimLead[];
  /** Fraction of trafficked prefixes whose lead route is the true best. */
  leadAccuracy: number;
  /** True ASR the final table would achieve, traffic-weighted. */
  realisedAsr: number;
  /** True ASR the perfect table would achieve. The ceiling. */
  optimalAsr: number;
}

export function defaultRouteSimConfig(overrides: Partial<RouteSimConfig> = {}): RouteSimConfig {
  const prefixes = overrides.prefixes ?? ['212', '312', '415'];
  const routes: RouteConfig[] = overrides.routes ?? [
    {
      name: 'ShortDuration',
      carrier: 'acme',
      deck: 'SD',
      ratesByPrefix: new Map(prefixes.map(p => [p, 0.0017])),
    },
    {
      name: 'CVPreferred',
      carrier: 'acme',
      deck: 'CV',
      ratesByPrefix: new Map(prefixes.map(p => [p, 0.0021])),
    },
    {
      name: 'MASH',
      carrier: 'acme',
      deck: 'MASH',
      ratesByPrefix: new Map(prefixes.map(p => [p, 0.0029])),
    },
  ];

  return {
    seed: 1,
    nights: 20,
    callsPerNight: 1_500,
    prefixes,
    routes,
    trueAsr: new Map(),
    fallbackAsr: 0.3,
    maxBlend: 0.0025,
    windowStartMs: 1_700_000_000_000,
    epoch: 'epoch-a',
    policy: DEFAULT_ROUTE_SCORING_POLICY,
    trafficWeights: new Map(prefixes.map(p => [p, 1_000])),
    routingMode: 'table',
    overflowShare: 0,
    rejectShare: 0,
    retryShare: 0,
    preWindowShare: 0,
    ...overrides,
  };
}

/** Weighted pick over prefixes, by traffic weight. Deterministic given `rng`. */
function pickPrefix(config: RouteSimConfig, rng: () => number): string {
  let total = 0;
  for (const p of config.prefixes) total += Math.max(0, config.trafficWeights.get(p) ?? 0);
  if (total <= 0) return config.prefixes[Math.floor(rng() * config.prefixes.length)];

  let r = rng() * total;
  for (const p of config.prefixes) {
    r -= Math.max(0, config.trafficWeights.get(p) ?? 0);
    if (r <= 0) return p;
  }
  return config.prefixes[config.prefixes.length - 1];
}

function candidatesFor(config: RouteSimConfig, prefix: string): RouteConfig[] {
  return config.routes.filter(r => r.ratesByPrefix.has(prefix));
}

function trueAsrFor(
  config: RouteSimConfig,
  shifted: Map<string, number>,
  route: string,
  npa: string,
  did: DidSelectionReason
): number {
  const key = truthKey(route, npa, did);
  const override = shifted.get(key);
  if (override !== undefined) return override;
  return config.trueAsr.get(key) ?? config.fallbackAsr;
}

/**
 * Run the simulation.
 *
 * Pure with respect to the seed — no clock, no `Math.random`, no I/O. The scorer
 * under test receives the same injected `rng`, so the Thompson draws are part of
 * the reproducible stream rather than a source of flake.
 */
export function runRouteSimulation(config: RouteSimConfig): RouteSimResult {
  const rng = createRng(config.seed);
  const observations: RouteObservation[] = [];
  const records: RouteSimNightRecord[] = [];
  const shifted = new Map<string, number>();

  let table = new Map<string, string[]>();
  let epoch = config.epoch;
  let decision: RouteDecision | null = null;

  for (let night = 0; night < config.nights; night++) {
    if (config.asrShift && night === config.asrShift.atNight) {
      shifted.set(config.asrShift.key, config.asrShift.to);
    }
    if (config.epochChangeAtNight !== undefined && night === config.epochChangeAtNight) {
      epoch = config.epochAfterChange ?? `${config.epoch}-next`;
    }

    const nightStartMs = config.windowStartMs + night * NIGHT_MS;

    for (let i = 0; i < config.callsPerNight; i++) {
      const prefix = pickPrefix(config, rng);
      const candidates = candidatesFor(config, prefix);
      if (candidates.length === 0) continue;

      let routeName: string;
      const lead = table.get(prefix)?.[0];
      if (config.routingMode === 'table' && lead) {
        routeName = lead;
      } else {
        routeName = candidates[Math.floor(rng() * candidates.length)].name;
      }

      // Draw every confounder from the same stream so the whole run stays
      // reproducible from the seed.
      const isReject = rng() < config.rejectShare;
      const isRetry = !isReject && rng() < config.retryShare;
      const isPreWindow = rng() < config.preWindowShare;
      const did: DidSelectionReason = rng() < config.overflowShare ? 'overflow' : 'npa_match';

      const p = trueAsrFor(config, shifted, routeName, prefix, did);
      const answered = !isReject && rng() < p;

      observations.push({
        // A rejected row never reached a Dial(), so it has no route outcome.
        // It still carries a route_name and NPA — that is exactly what makes it
        // dangerous, and exactly why the scorer must exclude on the reason
        // rather than on a missing field.
        reject_reason: isReject ? 'NO_DID_AVAILABLE' : '',
        did_selection_reason: did,
        topology_epoch: epoch,
        attempt_index: isRetry ? 2 : 1,
        route_name: routeName,
        destination_npa: prefix,
        answered,
        sip_response: answered ? 200 : 486,
        dialed_seconds: answered ? 45 : 0,
        observedAtMs: isPreWindow
          ? config.windowStartMs - NIGHT_MS - i
          : nightStartMs + Math.floor((i / config.callsPerNight) * NIGHT_MS),
      });
    }

    decision = scoreRoutes({
      nowMs: nightStartMs + NIGHT_MS,
      windowStartMs: config.windowStartMs,
      currentEpoch: epoch,
      observations,
      routes: config.routes,
      maxBlend: config.maxBlend,
      trafficWeights: config.trafficWeights,
      rng,
      currentTable: table,
      policy: config.policy,
    });

    table = decision.table;
    records.push({ night, decision, observations: observations.length, epoch });
  }

  // ---- Measure the final table against ground truth ------------------------
  const leads: RouteSimLead[] = [];
  let weightedRealised = 0;
  let weightedOptimal = 0;
  let volume = 0;
  let correct = 0;
  let trafficked = 0;

  for (const prefix of config.prefixes) {
    const w = Math.max(0, config.trafficWeights.get(prefix) ?? 0);
    const candidates = candidatesFor(config, prefix);
    if (candidates.length === 0) continue;

    // Ground truth is compared on the `npa_match` stratum, which is what the
    // scorer ranks on. Comparing against a blended truth would score the scorer
    // for failing to do the pooling §2.4 forbids.
    let trueBest = candidates[0].name;
    let bestTrueAsr = -1;
    for (const c of candidates) {
      const asr = trueAsrFor(config, shifted, c.name, prefix, 'npa_match');
      if (asr > bestTrueAsr) {
        bestTrueAsr = asr;
        trueBest = c.name;
      }
    }

    const chosen = table.get(prefix)?.[0] ?? null;
    const chosenTrueAsr = chosen ? trueAsrFor(config, shifted, chosen, prefix, 'npa_match') : 0;

    leads.push({ prefix, chosen, trueBest, chosenTrueAsr, bestTrueAsr });

    if (w > 0) {
      trafficked++;
      if (chosen === trueBest) correct++;
      weightedRealised += w * chosenTrueAsr;
      weightedOptimal += w * bestTrueAsr;
      volume += w;
    }
  }

  return {
    config,
    nights: records,
    final: decision as RouteDecision,
    observations,
    leads,
    leadAccuracy: trafficked > 0 ? correct / trafficked : 0,
    realisedAsr: volume > 0 ? weightedRealised / volume : 0,
    optimalAsr: volume > 0 ? weightedOptimal / volume : 0,
  };
}
