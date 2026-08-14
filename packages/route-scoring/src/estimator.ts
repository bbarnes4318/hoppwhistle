/**
 * Phase 5 — hierarchical Beta-Binomial ASR estimation.
 *
 * Normative spec: `phase-5-route-scoring-spec.md` §3.2, §3.3.
 *
 * Pure. No I/O, no `Date.now()`, no `Math.random()` — the RNG is injected, for
 * the same reason `nowMs` is injected into the pacing controller: a decision you
 * cannot replay is a decision you cannot debug.
 *
 * The statistics are deliberately transparent. Beta-Binomial smoothing and
 * nothing else. Every number is traceable to a counted call.
 */

import type { Confidence, RouteScoringPolicy } from './types.js';

/**
 * Standard deviations of posterior uncertainty added when projecting cost.
 *
 * Same constant and same convention as `SAFETY_Z` in the pacing controller
 * (controller.ts:197).
 *
 * READ THIS BEFORE "FIXING" THE SIGN. Both places this package leaves the
 * posterior mean, it moves UP: ranking draws from the upper tail, and the blend
 * check uses an upper bound. That looks like one of them must be a copy-paste
 * error. Neither is. The reasons are different and both are load-bearing.
 *
 *   ranking      Thompson draw from the posterior (§3.3). Optimism under
 *                uncertainty is precisely what produces exploration — a route
 *                nobody has tried is sometimes drawn high and gets tried — and
 *                it self-extinguishes as evidence accumulates and the posterior
 *                narrows. With a lower bound instead, an untried route would be
 *                ranked last forever on the strength of having no data, which is
 *                self-fulfilling.
 *
 *   blend check  Upper bound (§3.4). The quantity being protected is the
 *                projected blended RATE, and the blend is minute-weighted:
 *                `Σ(volume · asr · rate) / Σ(volume · asr)`. Billed minutes
 *                scale with ASR, so ASR sets each route's SHARE of the blend.
 *                Underestimate an expensive route's ASR and you underestimate
 *                the minutes it carries, the projection reads cheaper than
 *                production, and the ceiling is breached silently by a table
 *                that was validated as affordable. Assuming the assigned route
 *                carries MORE billed minutes than measured is the conservative
 *                direction.
 *
 * Note a uniform ASR error cancels between numerator and denominator. It is the
 * DIFFERENTIAL error across routes of different rates that moves the blend, and
 * that is what the bound is guarding.
 *
 * The pacing controller also uses an upper bound, but for a third reason again:
 * its demand is `deficit / pLive`, so a LOW estimate produces MORE calls. Same
 * direction, different mechanism. Its comment at controller.ts:234 warns that
 * this is easy to get backwards; that warning applies here with interest,
 * because here the intuition "committing money wants pessimism" points at the
 * wrong bound. The pessimism belongs on the cost projection, not on the ASR that
 * feeds it, and pessimism about cost means optimism about ASR.
 */
export const SAFETY_Z = 1.5;

/** Numerical guard only. Real protection is the blend ceiling and the hold-down. */
export const ASR_FLOOR = 0.001;

/**
 * Weight of an observation by age. Exponential, halving every `halfLifeMs`.
 *
 * This is the second of two mechanisms and it does a different job from the
 * first. The window start (§2.1) is a CLIFF: pre-Phase-0 attempts came from a
 * different process and are not comparable at any weight. Decay operates INSIDE
 * the window, where evidence is comparable but not equally current.
 *
 * Both are needed. A hard window alone only ever grows, so the time to correct a
 * degraded route grows with it — after 90 days of history a bad week is 7% of
 * the evidence and moves nothing. Decay alone would let pre-deploy rows back in
 * at a small weight, which is worse than excluding them, because their bias is
 * systematic rather than noisy.
 */
export function decayWeight(ageMs: number, halfLifeMs: number): number {
  if (!Number.isFinite(halfLifeMs) || halfLifeMs <= 0) return 1;
  if (!Number.isFinite(ageMs) || ageMs <= 0) return 1;
  return Math.pow(0.5, ageMs / halfLifeMs);
}

/** Rejection-sampler iteration cap, so a pathological RNG cannot hang the scorer. */
const MAX_SAMPLE_ITERATIONS = 200;

function clampNonNegative(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * A Beta posterior over one cell's ASR, plus the bookkeeping the hierarchy needs.
 *
 * `observations` is what THIS cell measured. `evidence` additionally counts a
 * discounted share of its parent's. The two are kept apart on purpose: the
 * posterior may lean on its parent, but confidence must never be inherited
 * wholesale, or a well-observed fleet would lend HIGH confidence to a cell
 * nobody has dialled.
 */
export interface CellPosterior {
  alpha: number;
  beta: number;
  mean: number;
  /** Real, in-epoch, first-attempt calls counted at this node. */
  observations: number;
  answered: number;
  /** Own observations plus `parentEvidenceDiscount` × the parent's. */
  evidence: number;
  /** Weight this node's prior carried in from its parent. */
  priorWeight: number;
}

export function posteriorSd(post: CellPosterior): number {
  const total = post.alpha + post.beta;
  if (total <= 0) return 0.5;
  return Math.sqrt((post.mean * (1 - post.mean)) / (total + 1));
}

/**
 * Upper credible bound on ASR — the value the blend projection weights by.
 *
 * See the note on {@link SAFETY_Z} for why this is an upper and not a lower
 * bound. Short version: billed minutes scale with ASR, so understating an
 * expensive route's ASR understates its share of the blended rate and lets the
 * ceiling be breached by a table that projected as affordable.
 */
export function upperBoundAsr(post: CellPosterior, z: number = SAFETY_Z): number {
  return Math.min(1, Math.max(ASR_FLOOR, post.mean + z * posteriorSd(post)));
}

/**
 * Lower credible bound on ASR.
 *
 * NOT used by any decision — see {@link upperBoundAsr} and the note on
 * {@link SAFETY_Z} for why the blend check uses the upper bound instead. This is
 * reported so an operator can read the width of the interval and see how much of
 * a route's ranking is evidence and how much is uncertainty. The hold-down
 * (§3.5) compares posterior means on both sides, like for like; using a lower
 * bound there would suppress exactly the exploratory moves §3.3 exists to make.
 */
export function lowerBoundAsr(post: CellPosterior, z: number = SAFETY_Z): number {
  return Math.min(1, Math.max(ASR_FLOOR, post.mean - z * posteriorSd(post)));
}

/**
 * Build a posterior for one cell from its own counts and its parent's estimate.
 *
 * The parent supplies the prior MEAN. The prior WEIGHT is capped by the parent's
 * own evidence — this is the load-bearing line in the whole hierarchy.
 *
 * A parent with 40 observations may lend at most 40 pseudo-observations of
 * confidence; a parent with 40,000 is still capped at
 * `policy.maxParentPriorWeight`. Without the first half of that rule a thin
 * parent would lend the same certainty as a thick one, and a cell three levels
 * below a barely-observed fleet would report HIGH confidence on nothing.
 * Without the second half a thick parent would swamp its children and the
 * hierarchy would silently degrade into pooling.
 */
export function deriveCellPosterior(
  answered: number,
  observations: number,
  parent: { mean: number; evidence: number } | null,
  policy: RouteScoringPolicy,
  /** Extra pseudo-counts from down-weighted off-epoch rows (§2.2). */
  offEpoch: { answered: number; observations: number } = { answered: 0, observations: 0 }
): CellPosterior {
  const obs = clampNonNegative(observations);
  const ans = Math.min(clampNonNegative(answered), obs);

  const priorMean = parent ? parent.mean : policy.fleetPriorMean;
  const priorWeight = parent
    ? Math.min(policy.maxParentPriorWeight, parent.evidence)
    : policy.fleetPriorWeight;

  // Off-epoch rows enter as fractional pseudo-counts. They move the estimate a
  // little and the confidence not at all — they are never added to
  // `observations`, which is what the confidence ladder reads.
  const offObs = clampNonNegative(offEpoch.observations) * policy.offEpochWeight;
  const offAns = Math.min(clampNonNegative(offEpoch.answered) * policy.offEpochWeight, offObs);

  const alpha = priorMean * priorWeight + ans + offAns;
  const beta = (1 - priorMean) * priorWeight + (obs - ans) + (offObs - offAns);
  const total = alpha + beta;

  return {
    alpha,
    beta,
    mean: total > 0 ? alpha / total : priorMean,
    observations: obs,
    answered: ans,
    evidence: obs + (parent ? parent.evidence * policy.parentEvidenceDiscount : 0),
    priorWeight,
  };
}

/**
 * Confidence in a cell's estimate.
 *
 * Both tests must pass at each rung. `observations` is the cell's own measured
 * calls; `evidence` additionally counts its ancestors at a discount. Requiring
 * both means neither a thick parent with an unobserved child, nor a child with
 * some data hanging off a barely-observed fleet, can reach HIGH.
 */
export function resolveConfidence(post: CellPosterior, policy: RouteScoringPolicy): Confidence {
  if (
    post.observations >= policy.minObservationsForHigh &&
    post.evidence >= policy.minEvidenceForHigh
  ) {
    return 'HIGH';
  }
  if (
    post.observations >= policy.minObservationsForMedium &&
    post.evidence >= policy.minEvidenceForMedium
  ) {
    return 'MEDIUM';
  }
  return 'LOW';
}

/** The weaker of two confidence levels. */
export function weakestConfidence(a: Confidence, b: Confidence): Confidence {
  const rank: Record<Confidence, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };
  return rank[a] <= rank[b] ? a : b;
}

// ---- Sampling ------------------------------------------------------------
//
// Thompson sampling (§3.3) replaces the original epsilon-greedy design. Draw
// each candidate's ASR from its own posterior and rank by the draw: a route with
// wide uncertainty is sometimes drawn high and gets tried, a route with a tight
// low posterior almost never is. Exploration becomes proportional to uncertainty
// and self-extinguishing, with no epsilon to tune.
//
// Everything below is driven by the injected `rng`, so a run is reproducible
// from its seed.

/** Box–Muller. Two uniforms in, one standard normal out. */
function sampleStandardNormal(rng: () => number): number {
  const u1 = Math.min(1 - 1e-12, Math.max(1e-12, rng()));
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Marsaglia–Tsang gamma sampler.
 *
 * The iteration cap is a liveness guard, not statistics: acceptance is ~98% per
 * pass, so hitting the cap means the injected RNG is degenerate (a constant, a
 * stub returning 0). Falling back to the distribution mean keeps a broken RNG
 * from hanging a nightly job.
 */
function sampleGamma(rng: () => number, shape: number): number {
  if (!Number.isFinite(shape) || shape <= 0) return 0;

  if (shape < 1) {
    // Boosting: G(a) = G(a+1) · U^(1/a).
    const boosted = sampleGamma(rng, shape + 1);
    const u = Math.max(1e-12, rng());
    return boosted * Math.pow(u, 1 / shape);
  }

  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);

  for (let i = 0; i < MAX_SAMPLE_ITERATIONS; i++) {
    let x = 0;
    let v = 0;
    do {
      x = sampleStandardNormal(rng);
      v = 1 + c * x;
    } while (v <= 0);

    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(Math.max(1e-12, u)) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }

  return shape;
}

/**
 * One draw from the cell's Beta posterior. This is the ranking value (§3.4).
 *
 * Selection wants optimism under uncertainty — that is what makes an untried
 * route occasionally get tried. The money decision does not; it uses
 * {@link lowerBoundAsr}.
 */
export function sampleAsr(post: CellPosterior, rng: () => number): number {
  const x = sampleGamma(rng, post.alpha);
  const y = sampleGamma(rng, post.beta);
  const total = x + y;
  if (!Number.isFinite(total) || total <= 0) return post.mean;
  return Math.min(1, Math.max(ASR_FLOOR, x / total));
}

/**
 * mulberry32 — the same seeded generator the pacing simulator uses
 * (`apps/dialer-v2/src/sim/simulator.ts:25`), duplicated rather than imported so
 * this package stays dependency-free and testable in isolation. Deterministic
 * across platforms, which matters because the dev checkout is Windows and CI is
 * not.
 */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return function rng(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
