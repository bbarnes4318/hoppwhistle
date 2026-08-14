/**
 * Phase 5 — the route scorer.
 *
 * Normative spec: `phase-5-route-scoring-spec.md` §3.
 *
 * This function is PURE: no I/O, no `Date.now()`, no `Math.random()`. `nowMs`
 * and `rng` are inputs. That is what makes replay, shadow-mode comparison and
 * the deterministic simulator possible, and it means the highest-risk logic in
 * the routing path is testable on a Windows dev checkout with no Asterisk, no
 * Redis, no database and no carrier.
 *
 * The design exists to defeat five confounders that would each make the scorer
 * confidently wrong (§2). Every one of them is a place where pooling two
 * populations that look similar would destroy the estimate:
 *
 *   §2.1  pre-Phase-0 rows are not comparable to post-Phase-0 rows
 *   §2.2  a route's identity is not stable across a topology epoch change
 *   §2.3  rows that never reached a Dial() are not route outcomes
 *   §2.4  an overflow DID is not local presence; it is a different experiment
 *   §2.5  a retry is drawn from a systematically harder population
 *
 * If you find yourself wanting to pool any of these "just for the low-sample
 * case", that is the bug this whole design exists to prevent. The low-sample
 * case is handled by the hierarchy in §3.2, which is what replaced the original
 * spec's crude 200-attempt threshold.
 */

import {
  type CellPosterior,
  decayWeight,
  deriveCellPosterior,
  lowerBoundAsr,
  resolveConfidence,
  sampleAsr,
  upperBoundAsr,
  weakestConfidence,
} from './estimator.js';
import {
  type Confidence,
  type DidSelectionReason,
  type RouteDecision,
  type RouteObservation,
  RouteReason,
  type RoutePrefixDiff,
  type RouteScoreDetail,
  type RouteScoringInputs,
  type RouteScoringPolicy,
  type RouteTableDiff,
  parseTableKey,
  tableKey,
} from './types.js';

/** Posterior means within this of each other are not meaningfully different. */
const EQUIVALENCE_EPSILON = 0.01;

/**
 * Reasons, most binding first.
 *
 * `RouteDecision.reason` is the single constraint that bound the decision, so it
 * has to be the most binding one that applied — not whichever happened to be
 * appended first. Push order is an implementation detail of the control flow and
 * would, for instance, let a routine overflow fallback outrank a hold-down that
 * actually determined the output.
 */
const REASON_PRECEDENCE: RouteReason[] = [
  RouteReason.EPOCH_CHANGED,
  RouteReason.INSUFFICIENT_POST_DEPLOY_DATA,
  RouteReason.NO_ELIGIBLE_ROUTE,
  RouteReason.HELD_AT_PREVIOUS_TABLE,
  RouteReason.BLEND_CEILING_BINDING,
  RouteReason.EXPLORATION_DRIVEN,
  RouteReason.OVERFLOW_FALLBACK_TO_NPA_MATCH,
  RouteReason.ALL_ROUTES_EQUIVALENT,
  RouteReason.SCORED_ON_MEASURED_ASR,
];

function orderReasons(rs: RouteReason[]): RouteReason[] {
  return [...new Set(rs)].sort(
    (a, b) => REASON_PRECEDENCE.indexOf(a) - REASON_PRECEDENCE.indexOf(b)
  );
}

/** Both strata, in a fixed order so the emitted table is deterministic. */
const STRATA: DidSelectionReason[] = ['npa_match', 'overflow'];

/**
 * Separator for composite map keys — ASCII unit separator (0x1F).
 *
 * It cannot occur in a route name or an NPA, so composite keys are unambiguous.
 * Built with `String.fromCharCode` rather than written as a literal on purpose:
 * an inline control byte in the source makes git classify this file as binary,
 * and a source file that cannot be diffed, blamed or merged costs real work in
 * exchange for nothing. An earlier revision of this file did exactly that with a
 * NUL and every test still passed, so the tests will not catch a regression
 * here — only `git show --stat` reporting `Bin` will.
 */
const KEY_SEP = String.fromCharCode(31);

interface Counts {
  /** Raw call count. What an operator means by "how many calls". */
  observations: number;
  answered: number;
  /** Age-decayed counts. These are what the estimator weights. */
  weightedObservations: number;
  weightedAnswered: number;
  /** Summed `dialed_seconds` over answered calls, for ACD reporting only. */
  answeredSeconds: number;
}

function emptyCounts(): Counts {
  return {
    observations: 0,
    answered: 0,
    weightedObservations: 0,
    weightedAnswered: 0,
    answeredSeconds: 0,
  };
}

function add(c: Counts, obs: RouteObservation, weight: number): void {
  c.observations++;
  c.weightedObservations += weight;
  if (obs.answered) {
    c.answered++;
    c.weightedAnswered += weight;
    c.answeredSeconds += Number.isFinite(obs.dialed_seconds) ? obs.dialed_seconds : 0;
  }
}

function bump(map: Map<string, Counts>, key: string, obs: RouteObservation, weight: number): void {
  let c = map.get(key);
  if (!c) {
    c = emptyCounts();
    map.set(key, c);
  }
  add(c, obs, weight);
}

function get(map: Map<string, Counts>, key: string): Counts {
  return map.get(key) ?? emptyCounts();
}

const routeKey = (route: string): string => route;
const npaKey = (route: string, npa: string): string => `${route}${KEY_SEP}${npa}`;
const cellKey = (route: string, npa: string, did: string): string =>
  `${route}${KEY_SEP}${npa}${KEY_SEP}${did}`;

interface Bucket {
  fleet: Counts;
  route: Map<string, Counts>;
  routeNpa: Map<string, Counts>;
  cell: Map<string, Counts>;
}

/**
 * Everything counted, split by epoch.
 *
 * In-epoch and off-epoch are kept in SEPARATE maps for the whole of ingest.
 * There is deliberately no code path that merges them into one count — off-epoch
 * rows only ever reach the estimator through `deriveCellPosterior`'s explicit
 * `offEpoch` parameter, where they are multiplied by `policy.offEpochWeight` and
 * excluded from the observation count that drives confidence. Keeping them in
 * one map with a flag would make silent pooling a one-line mistake.
 */
export interface Ingested {
  inEpoch: Bucket;
  offEpoch: Bucket;
  rejectedRows: number;
  outOfWindowRows: number;
  offEpochRows: number;
  scoredRows: number;
  effectiveScoredRows: number;
  retryAttempts: number;
  retryAnswered: number;
  observedPrefixes: Set<string>;
}

function emptyBucket(): Bucket {
  return { fleet: emptyCounts(), route: new Map(), routeNpa: new Map(), cell: new Map() };
}

/**
 * Filter, weight and bucket the raw CDR rows.
 *
 * The order of the guards is the order of the spec sections, and each one is a
 * hard exclusion rather than a down-weight, except the epoch check which is the
 * one case the spec asks to be weakened rather than dropped.
 */
export function ingest(inputs: RouteScoringInputs): Ingested {
  const out: Ingested = {
    inEpoch: emptyBucket(),
    offEpoch: emptyBucket(),
    rejectedRows: 0,
    outOfWindowRows: 0,
    offEpochRows: 0,
    scoredRows: 0,
    effectiveScoredRows: 0,
    retryAttempts: 0,
    retryAnswered: 0,
    observedPrefixes: new Set(),
  };

  for (const obs of inputs.observations) {
    // §2.3 — the call never reached a Dial(), so it is not a route outcome.
    //
    // The test is "non-empty", full stop. Do NOT match against the known list of
    // reject reasons: a new reason added upstream must exclude its rows
    // automatically, and matching a list is how an unrecognised reason silently
    // becomes an answered-call denominator. 36,683 of these landed in a five-day
    // window; letting them through understates every route's ASR by ~15%, and
    // not uniformly — the error concentrates in whichever NPAs exhausted their
    // DID pool first, which is exactly the dimension being scored.
    if (obs.reject_reason !== '') {
      out.rejectedRows++;
      continue;
    }

    // §2.1 — the window starts at the Phase 0 deploy, not "7 days ago".
    // Amplification was 2.48x on 08-11 and 1.67x on 08-12 as the gateway count
    // fell; those attempts are drawn from a different process entirely, and no
    // weight is small enough to make a systematically biased population safe.
    // This is a cliff, not a slope — the decay below is the slope.
    if (!(obs.observedAtMs >= inputs.windowStartMs)) {
      out.outOfWindowRows++;
      continue;
    }

    // §2.5 — retries are a systematically harder population: every one of these
    // calls already failed at least once. Pooling them makes fallback routes
    // look worse than they are, and the scorer demotes them until they are never
    // tried, which is self-fulfilling.
    if (obs.attempt_index !== 1) {
      out.retryAttempts++;
      if (obs.answered) out.retryAnswered++;
      continue;
    }

    out.observedPrefixes.add(obs.destination_npa);

    // Age decay INSIDE the window. Carrier route quality changes underneath you,
    // and without this the window only grows: after 90 days of history a bad
    // week is 7% of the evidence and moves nothing.
    const weight = decayWeight(inputs.nowMs - obs.observedAtMs, inputs.policy.halfLifeMs);

    // §2.2 — a route's identity is not stable across a change to its underlying
    // proxy set. Off-epoch rows go in a separate bucket and enter the estimate
    // only as a down-weighted prior.
    const inEpoch = obs.topology_epoch === inputs.currentEpoch;
    const bucket = inEpoch ? out.inEpoch : out.offEpoch;
    if (inEpoch) {
      out.scoredRows++;
      out.effectiveScoredRows += weight;
    } else {
      out.offEpochRows++;
    }

    add(bucket.fleet, obs, weight);
    bump(bucket.route, routeKey(obs.route_name), obs, weight);
    bump(bucket.routeNpa, npaKey(obs.route_name, obs.destination_npa), obs, weight);
    // §2.4 — the stratum. `npa_match` and `overflow` are never pooled.
    bump(
      bucket.cell,
      cellKey(obs.route_name, obs.destination_npa, obs.did_selection_reason),
      obs,
      weight
    );
  }

  return out;
}

/** The four-level chain for one (route × NPA × did_reason) cell. */
export interface CellEstimate {
  fleet: CellPosterior;
  route: CellPosterior;
  routeNpa: CellPosterior;
  cell: CellPosterior;
  confidence: Confidence;
}

/** Age-decayed counts, in the shape `deriveCellPosterior` expects. */
function weighted(c: Counts): { answered: number; observations: number } {
  return { answered: c.weightedAnswered, observations: c.weightedObservations };
}

/**
 * Walk the hierarchy: fleet → route → (route × NPA) → (route × NPA × did_reason).
 *
 * Each level's posterior is the next level's prior (§3.2). A cell with no data
 * inherits its parent's posterior; a cell with a little data shifts a little; a
 * cell with a lot dominates its prior. There is no threshold to tune, which is
 * what makes this strictly better than the original spec's "200 attempts before
 * a score is trusted" — that threw away real information below the line while
 * treating 201 observations as certainty.
 */
export function estimateCell(
  ing: Ingested,
  route: string,
  npa: string,
  did: string,
  policy: RouteScoringPolicy
): CellEstimate {
  const fleetIn = weighted(ing.inEpoch.fleet);
  const fleet = deriveCellPosterior(
    fleetIn.answered,
    fleetIn.observations,
    null,
    policy,
    weighted(ing.offEpoch.fleet)
  );

  const rIn = weighted(get(ing.inEpoch.route, routeKey(route)));
  const routePost = deriveCellPosterior(
    rIn.answered,
    rIn.observations,
    fleet,
    policy,
    weighted(get(ing.offEpoch.route, routeKey(route)))
  );

  const nIn = weighted(get(ing.inEpoch.routeNpa, npaKey(route, npa)));
  const routeNpa = deriveCellPosterior(
    nIn.answered,
    nIn.observations,
    routePost,
    policy,
    weighted(get(ing.offEpoch.routeNpa, npaKey(route, npa)))
  );

  const cIn = weighted(get(ing.inEpoch.cell, cellKey(route, npa, did)));
  const cell = deriveCellPosterior(
    cIn.answered,
    cIn.observations,
    routeNpa,
    policy,
    weighted(get(ing.offEpoch.cell, cellKey(route, npa, did)))
  );

  return { fleet, route: routePost, routeNpa, cell, confidence: resolveConfidence(cell, policy) };
}

interface Candidate {
  routeName: string;
  rate: number;
  estimate: CellEstimate;
  sampled: number;
  upper: number;
  lower: number;
  mean: number;
  acdSeconds: number;
  observations: number;
  answered: number;
  effectiveObservations: number;
}

function buildDiff(current: Map<string, string[]>, next: Map<string, string[]>): RouteTableDiff {
  const changed: RoutePrefixDiff[] = [];
  const added: string[] = [];
  const removed: string[] = [];

  for (const [prefix, to] of next) {
    const from = current.get(prefix);
    if (!from) {
      added.push(prefix);
      continue;
    }
    if (from.length !== to.length || from.some((r, i) => r !== to[i])) {
      changed.push({ prefix, from: [...from], to: [...to], leadChanged: from[0] !== to[0] });
    }
  }
  for (const prefix of current.keys()) {
    if (!next.has(prefix)) removed.push(prefix);
  }

  return {
    changed,
    added,
    removed,
    identical: changed.length === 0 && added.length === 0 && removed.length === 0,
  };
}

/**
 * Traffic-weighted projections for a given key→lead assignment.
 *
 * `blend` is a MINUTE-weighted average of rates, and that is why it is weighted
 * by the UPPER bound of ASR rather than the mean. Billed minutes scale with ASR,
 * so ASR sets each route's share of the blend. Underestimating an expensive
 * route's ASR understates the minutes it carries, the projection reads cheaper
 * than production, and the ceiling gets breached by a table that validated as
 * affordable. See the note on `SAFETY_Z` in `estimator.ts` — the sign here is
 * deliberate and is the single most invertible line in this package.
 *
 * Weights are per (stratum, prefix), so the 60.6% of live traffic that goes out
 * on overflow DIDs is priced at its own ASR rather than at local-presence ASR.
 *
 * ACD is assumed equal across routes and therefore cancels out of the weighting.
 * That assumption is only safe while §2.6 holds — calls capping at 44–47s across
 * every route is itself evidence the duration is an artifact, not a route
 * property. Revisit when `useAcdInScore` is turned on.
 */
function project(
  leads: Map<string, Candidate>,
  trafficWeights: Map<string, number>
): { blend: number; asr: number } {
  let minutes = 0;
  let cost = 0;
  let weightedAsr = 0;
  let volume = 0;

  for (const [key, cand] of leads) {
    const w = Math.max(0, trafficWeights.get(key) ?? 0);
    if (w === 0) continue;
    const m = w * cand.upper;
    minutes += m;
    cost += m * cand.rate;
    weightedAsr += w * cand.mean;
    volume += w;
  }

  return { blend: minutes > 0 ? cost / minutes : 0, asr: volume > 0 ? weightedAsr / volume : 0 };
}

/**
 * Score routes and produce a routing table.
 *
 * Every failure mode degrades toward CHANGING LESS. There is no input
 * combination — including impossible or corrupted telemetry — for which
 * uncertainty produces a more aggressive table than evidence would.
 */
export function scoreRoutes(inputs: RouteScoringInputs): RouteDecision {
  const { policy } = inputs;
  const ing = ingest(inputs);

  const reasons: RouteReason[] = [];
  const details: RouteScoreDetail[] = [];
  const exploredPrefixes: string[] = [];

  const base = {
    retry: {
      attempts: ing.retryAttempts,
      answered: ing.retryAnswered,
      rescueRate: ing.retryAttempts > 0 ? ing.retryAnswered / ing.retryAttempts : 0,
    },
    rejectedRows: ing.rejectedRows,
    outOfWindowRows: ing.outOfWindowRows,
    offEpochRows: ing.offEpochRows,
    scoredRows: ing.scoredRows,
    effectiveScoredRows: ing.effectiveScoredRows,
  };

  // §2.2 — the epoch moved and the current epoch has not yet accumulated enough
  // data to stand on its own. Confidence drops and the system leans on the
  // hierarchical prior until data accumulates. It recovers on its own; there is
  // no manual reset, because a manual reset is a step someone forgets.
  const epochUnsettled = ing.offEpochRows > 0 && ing.scoredRows < policy.minPostDeployObservations;
  if (epochUnsettled) reasons.push(RouteReason.EPOCH_CHANGED);

  // §2.1 — refuse to score rather than score on nothing, and report the refusal
  // as a reason rather than as a silent fallback. Gated on the RAW row count:
  // "is there enough data to look at" is a question about volume, not currency.
  if (ing.scoredRows < policy.minPostDeployObservations) {
    reasons.push(RouteReason.INSUFFICIENT_POST_DEPLOY_DATA);
    return {
      ...base,
      table: new Map(inputs.currentTable),
      projectedBlend: 0,
      projectedAsr: 0,
      confidence: 'LOW',
      reason: orderReasons(reasons)[0],
      reasons: orderReasons(reasons),
      diff: buildDiff(inputs.currentTable, inputs.currentTable),
      details,
      exploredPrefixes,
    };
  }

  // Traffic weights are keyed per (stratum, prefix); collapse to the prefix set.
  const prefixSet = new Set<string>();
  for (const key of inputs.trafficWeights.keys()) {
    const parsed = parseTableKey(key);
    if (parsed) prefixSet.add(parsed.prefix);
  }
  if (prefixSet.size === 0) for (const p of ing.observedPrefixes) prefixSet.add(p);
  const prefixes = [...prefixSet].sort();

  const ranked = new Map<string, Candidate[]>();
  const inherited = new Set<string>();
  let sawEligible = false;

  for (const prefix of prefixes) {
    // §2.4 — each stratum is ranked on its own evidence, and emitted as its own
    // table entry. The dialplan knows which stratum it is in BEFORE it selects a
    // route: SBC_DID_REASON is assigned at extensions.conf.tpl:402/:409, the DID
    // pick Gosub runs at :403/:410, and the dial loop does not begin until
    // n(dial) at :451, where the variable is still live (:458). So a per-stratum
    // table is loadable as `sbc/route/<stratum>/<prefix>` and still costs three
    // DB() reads.
    //
    // It is also necessary rather than merely possible. Production ran 60.6%
    // overflow; ranking on npa_match alone would rank the table on a minority of
    // live traffic, and the strata genuinely disagree — the §2.4 fixture has one
    // route at 60% local-presence and 5% overflow.
    const npaMatchOrder: string[] = [];

    for (const stratum of STRATA) {
      const key = tableKey(stratum, prefix);
      const candidates: Candidate[] = [];

      for (const route of inputs.routes) {
        const rate = route.ratesByPrefix.get(prefix);
        if (rate === undefined) continue;

        const estimate = estimateCell(ing, route.name, prefix, stratum, policy);
        const counts = get(ing.inEpoch.cell, cellKey(route.name, prefix, stratum));

        candidates.push({
          routeName: route.name,
          rate,
          estimate,
          sampled: sampleAsr(estimate.cell, inputs.rng),
          upper: upperBoundAsr(estimate.cell),
          lower: lowerBoundAsr(estimate.cell),
          mean: estimate.cell.mean,
          acdSeconds: counts.answered > 0 ? counts.answeredSeconds / counts.answered : 0,
          observations: counts.observations,
          answered: counts.answered,
          effectiveObservations: counts.weightedObservations,
        });
      }

      if (candidates.length === 0) continue;
      sawEligible = true;

      // §3.3 — rank by the Thompson draw, not by the point estimate and not by
      // rate. Ties break on posterior mean so the ordering stays deterministic.
      const bySampled = [...candidates].sort((a, b) => b.sampled - a.sampled || b.mean - a.mean);
      const byMean = [...candidates].sort((a, b) => b.mean - a.mean);

      if (stratum === 'npa_match') {
        npaMatchOrder.push(...bySampled.map(c => c.routeName));
      } else if (!candidates.some(c => c.observations > 0) && npaMatchOrder.length > 0) {
        // An overflow cell with no observations of its own would be ordered
        // entirely by a Thompson draw off its parent prior — noise dressed as a
        // measurement. Follow the local-presence ordering until it has evidence
        // of its own, and SAY so rather than letting it read as measured.
        bySampled.sort(
          (a, b) => npaMatchOrder.indexOf(a.routeName) - npaMatchOrder.indexOf(b.routeName)
        );
        inherited.add(key);
        if (!reasons.includes(RouteReason.OVERFLOW_FALLBACK_TO_NPA_MATCH)) {
          reasons.push(RouteReason.OVERFLOW_FALLBACK_TO_NPA_MATCH);
        }
      }

      if (!inherited.has(key) && bySampled[0].routeName !== byMean[0].routeName) {
        exploredPrefixes.push(key);
      }

      ranked.set(key, bySampled);
    }
  }

  if (!sawEligible) reasons.push(RouteReason.NO_ELIGIBLE_ROUTE);

  // §3.3 — emergency cap on exploration share. Off by default: Thompson sampling
  // is self-extinguishing and needs no epsilon. This exists only so an operator
  // can clamp it during an incident.
  if (
    policy.explorePercentCap !== null &&
    ranked.size > 0 &&
    exploredPrefixes.length / ranked.size > policy.explorePercentCap
  ) {
    const allowed = Math.floor(ranked.size * policy.explorePercentCap);
    for (const key of exploredPrefixes.slice(allowed)) {
      const cands = ranked.get(key);
      if (cands)
        ranked.set(
          key,
          [...cands].sort((a, b) => b.mean - a.mean)
        );
    }
    exploredPrefixes.length = allowed;
  }

  // ---- §3.4 the budget -----------------------------------------------------
  const leads = new Map<string, Candidate>();
  const depth = new Map<string, number>();
  for (const [key, cands] of ranked) {
    leads.set(key, cands[0]);
    depth.set(key, 0);
  }

  let projection = project(leads, inputs.trafficWeights);
  let demoted = false;

  // Fractional knapsack, greedy on Δasr/Δcost — optimal for this shape. A flat
  // per-prefix rate cap would be simpler and wrong: it discards exactly the
  // expensive-but-connecting routes this project exists to use.
  while (projection.blend > inputs.maxBlend) {
    let bestKey: string | null = null;
    let bestRatio = Infinity;
    let bestNext: Candidate | null = null;

    for (const [key, cands] of ranked) {
      const at = depth.get(key) ?? 0;
      const current = cands[at];
      const next = cands[at + 1];
      if (!next) continue;

      const deltaCost = current.rate - next.rate;
      if (deltaCost <= 0) continue;

      // Δasr on the posterior MEAN: the realistic expected loss from the
      // demotion, not the optimistic draw that produced the ranking.
      const deltaAsr = Math.max(0, current.mean - next.mean);
      const ratio = deltaAsr / deltaCost;
      if (ratio < bestRatio) {
        bestRatio = ratio;
        bestKey = key;
        bestNext = next;
      }
    }

    if (bestKey === null || bestNext === null) break;

    depth.set(bestKey, (depth.get(bestKey) ?? 0) + 1);
    leads.set(bestKey, bestNext);
    demoted = true;
    projection = project(leads, inputs.trafficWeights);
  }

  if (demoted) reasons.push(RouteReason.BLEND_CEILING_BINDING);

  // ---- Build the table -----------------------------------------------------
  const table = new Map<string, string[]>();
  for (const [key, cands] of ranked) {
    const at = depth.get(key) ?? 0;
    const lead = cands[at];
    const rest = cands.filter(c => c !== lead);
    table.set(key, [lead.routeName, ...rest.map(c => c.routeName)]);
  }

  for (const [key, cands] of ranked) {
    const parsed = parseTableKey(key);
    if (!parsed) continue;
    for (const c of cands) {
      details.push({
        routeName: c.routeName,
        prefix: parsed.prefix,
        stratum: parsed.stratum,
        observations: c.observations,
        answered: c.answered,
        effectiveObservations: c.effectiveObservations,
        posteriorMean: c.mean,
        sampledAsr: c.sampled,
        upperBoundAsr: c.upper,
        lowerBoundAsr: c.lower,
        confidence: c.estimate.confidence,
        ratePerMinute: c.rate,
        // §5 — the metric the operator actually needs. A route at $0.0029 with
        // 55% ASR beats one at $0.0017 with 30%, and nothing in the current
        // tooling shows it.
        costPerConnectedMinute: c.mean > 0 ? c.rate / c.mean : Infinity,
        acdSeconds: c.acdSeconds,
        inheritedFromNpaMatch: inherited.has(key),
      });
    }
  }

  // Confidence is the weakest of the routes actually being assigned traffic.
  // The worst cell in the table is the one that will embarrass you.
  let confidence: Confidence = leads.size > 0 ? 'HIGH' : 'LOW';
  for (const [key, cand] of leads) {
    if ((inputs.trafficWeights.get(key) ?? 0) <= 0) continue;
    confidence = weakestConfidence(confidence, cand.estimate.confidence);
  }
  if (epochUnsettled) confidence = 'LOW';

  const allEquivalent =
    ranked.size > 0 &&
    [...ranked.values()].every(cands => {
      const means = cands.map(c => c.mean);
      return Math.max(...means) - Math.min(...means) < EQUIVALENCE_EPSILON;
    });

  // ---- §3.5 hold-down ------------------------------------------------------
  // A table that churns every night is worse than one that moves deliberately.
  // Both sides are compared on the posterior mean, like for like: using a lower
  // bound for the proposal would suppress exactly the exploratory moves §3.3
  // exists to make, and the table would freeze.
  const currentLeads = new Map<string, Candidate>();
  for (const [key, names] of inputs.currentTable) {
    const cands = ranked.get(key);
    if (!cands || names.length === 0) continue;
    const match = cands.find(c => c.routeName === names[0]);
    if (match) currentLeads.set(key, match);
  }
  const currentProjection = project(currentLeads, inputs.trafficWeights);

  const diff = buildDiff(inputs.currentTable, table);
  const beatsCurrent = projection.asr >= currentProjection.asr + policy.holdDownMargin;

  if (currentLeads.size > 0 && !diff.identical && !beatsCurrent) {
    reasons.push(RouteReason.HELD_AT_PREVIOUS_TABLE);
    return {
      ...base,
      table: new Map(inputs.currentTable),
      projectedBlend: currentProjection.blend,
      projectedAsr: currentProjection.asr,
      confidence,
      reason: orderReasons(reasons)[0],
      reasons: orderReasons(reasons),
      diff: buildDiff(inputs.currentTable, inputs.currentTable),
      details,
      exploredPrefixes,
    };
  }

  if (exploredPrefixes.length > 0) reasons.push(RouteReason.EXPLORATION_DRIVEN);
  if (allEquivalent) reasons.push(RouteReason.ALL_ROUTES_EQUIVALENT);
  if (reasons.length === 0) reasons.push(RouteReason.SCORED_ON_MEASURED_ASR);

  return {
    ...base,
    table,
    projectedBlend: projection.blend,
    projectedAsr: projection.asr,
    confidence,
    reason: orderReasons(reasons)[0],
    reasons: orderReasons(reasons),
    diff,
    details,
    exploredPrefixes,
  };
}
