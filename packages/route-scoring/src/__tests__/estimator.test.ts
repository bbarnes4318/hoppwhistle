import { describe, expect, it } from 'vitest';

import {
  SAFETY_Z,
  createRng,
  deriveCellPosterior,
  lowerBoundAsr,
  posteriorSd,
  resolveConfidence,
  sampleAsr,
  upperBoundAsr,
} from '../estimator.js';
import { DEFAULT_ROUTE_SCORING_POLICY } from '../types.js';

const policy = DEFAULT_ROUTE_SCORING_POLICY;

describe('hierarchical priors (§3.2)', () => {
  it('does not reuse the pacing controller prior', () => {
    // PRIOR_ALPHA=2 / PRIOR_BETA=18 encodes a 10% live-answer rate. That is
    // right for pacing and wrong for route ASR, which operates in the 30-60%
    // band. A cell with no data must not be dragged toward 10%.
    const fleet = deriveCellPosterior(0, 0, null, policy);
    expect(fleet.mean).toBeCloseTo(0.35, 10);
    expect(fleet.mean).not.toBeCloseTo(0.1, 2);
  });

  it('lets a cell with plenty of data dominate its prior', () => {
    const parent = { mean: 0.2, evidence: 5_000 };
    const cell = deriveCellPosterior(600, 1_000, parent, policy);
    // 60% measured against a 20% prior capped at 60 pseudo-observations.
    expect(cell.mean).toBeGreaterThan(0.55);
  });

  it('lets a cell with no data inherit its parent posterior', () => {
    const parent = { mean: 0.42, evidence: 900 };
    const cell = deriveCellPosterior(0, 0, parent, policy);
    expect(cell.mean).toBeCloseTo(0.42, 10);
    expect(cell.observations).toBe(0);
  });
});

describe('prior weight derives from the parent evidence count', () => {
  // This is the fifth confounder. A fixed prior weight would let a barely
  // observed parent lend the same certainty as a heavily observed one.
  const thinParent = { mean: 0.4, evidence: 40 };
  const fatParent = { mean: 0.4, evidence: 40_000 };

  it('caps what a parent can lend by its own evidence', () => {
    const thin = deriveCellPosterior(0, 0, thinParent, policy);
    const fat = deriveCellPosterior(0, 0, fatParent, policy);

    expect(thin.priorWeight).toBe(40);
    expect(fat.priorWeight).toBe(policy.maxParentPriorWeight);
    expect(thin.priorWeight).toBeLessThan(fat.priorWeight);
  });

  it('caps a thick parent so the hierarchy cannot become pooling', () => {
    const fat = deriveCellPosterior(0, 0, { mean: 0.4, evidence: 1_000_000 }, policy);
    // Without the ceiling this cell's prior would carry a million
    // pseudo-observations and no amount of real data could move it.
    expect(fat.priorWeight).toBe(policy.maxParentPriorWeight);
  });

  it('gives the SAME child data different confidence under different parents', () => {
    // 40 own observations either way. The only difference is how well observed
    // the parent is, and that alone moves the confidence output.
    const thinChild = deriveCellPosterior(20, 40, thinParent, policy);
    const fatChild = deriveCellPosterior(20, 40, fatParent, policy);

    expect(thinChild.observations).toBe(fatChild.observations);
    expect(thinChild.evidence).toBeLessThan(fatChild.evidence);

    expect(resolveConfidence(thinChild, policy)).toBe('LOW');
    expect(resolveConfidence(fatChild, policy)).toBe('MEDIUM');
  });

  it('never reaches HIGH on a cell with no observations of its own', () => {
    // Confidence must not be inheritable wholesale, or a well-observed fleet
    // would lend HIGH confidence to a cell nobody has dialled.
    const fat = deriveCellPosterior(0, 0, { mean: 0.4, evidence: 10_000_000 }, policy);
    expect(resolveConfidence(fat, policy)).toBe('LOW');
  });
});

describe('credible bounds (§3.4)', () => {
  it('brackets the posterior mean', () => {
    const post = deriveCellPosterior(50, 100, { mean: 0.4, evidence: 500 }, policy);
    expect(lowerBoundAsr(post)).toBeLessThan(post.mean);
    expect(upperBoundAsr(post)).toBeGreaterThan(post.mean);
  });

  it('uses the UPPER bound for cost projection, not the lower one', () => {
    // Regression guard for the sign. Billed minutes scale with ASR, so
    // understating an expensive route's ASR understates its share of the blend
    // and lets the ceiling be breached by a table that projected as affordable.
    // The conservative direction for a COST projection is optimism about ASR.
    const post = deriveCellPosterior(30, 100, { mean: 0.3, evidence: 200 }, policy);
    expect(upperBoundAsr(post)).toBeCloseTo(post.mean + SAFETY_Z * posteriorSd(post), 10);
  });

  it('narrows the interval as evidence accumulates', () => {
    const thin = deriveCellPosterior(5, 10, { mean: 0.4, evidence: 100 }, policy);
    const thick = deriveCellPosterior(5_000, 10_000, { mean: 0.4, evidence: 100 }, policy);
    const thinWidth = upperBoundAsr(thin) - lowerBoundAsr(thin);
    const thickWidth = upperBoundAsr(thick) - lowerBoundAsr(thick);
    expect(thickWidth).toBeLessThan(thinWidth);
  });
});

describe('Thompson sampling (§3.3)', () => {
  it('is deterministic for a given seed', () => {
    const post = deriveCellPosterior(40, 100, { mean: 0.4, evidence: 500 }, policy);
    const a = Array.from({ length: 20 }, () => 0);
    const b = Array.from({ length: 20 }, () => 0);

    const rngA = createRng(7);
    const rngB = createRng(7);
    for (let i = 0; i < 20; i++) {
      a[i] = sampleAsr(post, rngA);
      b[i] = sampleAsr(post, rngB);
    }
    expect(a).toEqual(b);
  });

  it('explores more when uncertain and less when confident', () => {
    // Exploration is proportional to uncertainty and self-extinguishing: no
    // epsilon to tune. A wide posterior gets drawn across a wide range; a tight
    // one barely moves.
    const uncertain = deriveCellPosterior(2, 4, { mean: 0.4, evidence: 20 }, policy);
    const confident = deriveCellPosterior(4_000, 10_000, { mean: 0.4, evidence: 50_000 }, policy);

    const spread = (post: ReturnType<typeof deriveCellPosterior>): number => {
      const rng = createRng(11);
      const draws = Array.from({ length: 400 }, () => sampleAsr(post, rng));
      return Math.max(...draws) - Math.min(...draws);
    };

    expect(spread(uncertain)).toBeGreaterThan(spread(confident) * 5);
  });

  it('stays inside [0,1]', () => {
    const rng = createRng(3);
    const post = deriveCellPosterior(1, 2, { mean: 0.5, evidence: 10 }, policy);
    for (let i = 0; i < 500; i++) {
      const draw = sampleAsr(post, rng);
      expect(draw).toBeGreaterThanOrEqual(0);
      expect(draw).toBeLessThanOrEqual(1);
    }
  });

  it('survives a degenerate RNG without hanging', () => {
    // Liveness guard, not statistics. A stub RNG must not wedge a nightly job.
    const post = deriveCellPosterior(10, 20, { mean: 0.4, evidence: 100 }, policy);
    const draw = sampleAsr(post, () => 0);
    expect(Number.isFinite(draw)).toBe(true);
  });
});

describe('off-epoch evidence (§2.2)', () => {
  it('moves the estimate a little and the confidence not at all', () => {
    const parent = { mean: 0.3, evidence: 400 };
    const clean = deriveCellPosterior(10, 20, parent, policy);
    const withOld = deriveCellPosterior(10, 20, parent, policy, {
      answered: 800,
      observations: 1_000,
    });

    // The old-epoch rows are 80% answered, so they pull the mean up...
    expect(withOld.mean).toBeGreaterThan(clean.mean);
    // ...but they are NOT observations of the current epoch, so they must not
    // buy confidence. `observations` is what the confidence ladder reads.
    expect(withOld.observations).toBe(clean.observations);
    expect(withOld.evidence).toBe(clean.evidence);
  });

  it('weights an off-epoch row below a current-epoch one', () => {
    const parent = { mean: 0.3, evidence: 100 };
    const current = deriveCellPosterior(100, 100, parent, policy);
    const old = deriveCellPosterior(0, 0, parent, policy, { answered: 100, observations: 100 });
    expect(old.mean).toBeLessThan(current.mean);
  });
});
