/**
 * The rate curve: closing percentage in, dollars per submitted application out.
 *
 * ── It is continuous, and that is not an implementation detail ───────────────
 *
 * The rate is a CONTINUOUS function of closing percentage, interpolated between
 * anchor points. It replaced a step-banded scale, and it must not be
 * "simplified" back, because the reason is arithmetic rather than taste:
 *
 * At these volumes the measured closing percentage carries real sampling error
 * -- roughly +/-1.4 points at 450 delivered calls in a window, +/-2.8 at the
 * smaller agency's 150. Band edges one point wide are narrower than that noise.
 * On a step scale an agency performing at exactly 10.0% sits on an edge where
 * downward noise is expensive and upward noise is free, and pays about 4% above
 * its fair rate purely from randomness. A continuous curve makes small errors
 * symmetric and cuts that distortion to under 2% across the whole range.
 *
 * ── The three regions ────────────────────────────────────────────────────────
 *
 *   below the minimum   NO rate. The agency is flagged for review, Phase 3
 *                       pauses delivery on that flag, and only a platform
 *                       admin clears it. The curve is NEVER extrapolated
 *                       downward: there is no defensible price out there, and
 *                       inventing one by extending the last segment would
 *                       quote $294 at 4% and $324 at 3% with nothing behind
 *                       the numbers.
 *   between anchors     linear interpolation, rounded to the nearest dollar.
 *   at or above the top flat at the highest anchor's rate. Also not
 *                       extrapolated: 15% and 20% pay the same $134.
 *
 * ── Versioning ───────────────────────────────────────────────────────────────
 *
 * The anchors are rows, not constants, and every rating decision records the
 * version that priced it. A change to the anchor points therefore cannot alter
 * a rate already applied: the old version still exists and still resolves. This
 * module never reads "the current curve" on its own -- it is always handed one.
 *
 * ── There is no introductory rate ────────────────────────────────────────────
 *
 * Phase 2 carried an introductory package on the curve: a flat price for an
 * agency's first five submitted applications. Phase 3 removed it. An agency's
 * opening rate and opening block are agreed before its first Delivery Day and
 * recorded per tenant, and from the second Delivery Day the curve governs --
 * so there is no "first N applications" anywhere in the pricing, and no
 * lifetime count of applications is read to decide a price.
 *
 * `rate_curve_versions.introductoryRate` and `.introductoryApplications` still
 * exist as columns because migrations against the production database are
 * additive and never drop, but nothing in this codebase reads them. Grep.
 */

import { Prisma } from '@prisma/client';

/** One point on a curve. Percentages and dollars, both as plain numbers. */
export interface CurveAnchor {
  /** A percentage: 10 means 10%. */
  closingPct: number;
  /** Dollars per submitted application. */
  rate: number;
}

/** Everything needed to price a closing percentage. */
export interface RateCurve {
  id: string;
  version: number;
  /** Below this, no rate. */
  minimumClosingPct: number;
  /** At and above this, flat at the highest anchor. */
  flatFromClosingPct: number;
  /** Sorted ascending by `closingPct`. */
  anchors: CurveAnchor[];
}

/** What the curve says about one closing percentage. */
export type CurveVerdict =
  | { kind: 'RATE'; rate: number }
  /** Below the curve's minimum. There is no rate, and there is no fallback. */
  | { kind: 'BELOW_MINIMUM'; minimumClosingPct: number };

/** Prisma's Decimal, a number, or a numeric string. */
type Numeric = Prisma.Decimal | number | string;

export function toNumber(value: Numeric): number {
  return typeof value === 'number' ? value : Number(value.toString());
}

/**
 * Shape a curve row (plus its anchors) into the form this module prices with.
 *
 * Sorting happens here, once, so no caller has to remember that interpolation
 * assumes ascending anchors.
 */
export function toRateCurve(row: {
  id: string;
  version: number;
  minimumClosingPct: Numeric;
  flatFromClosingPct: Numeric;
  anchors: Array<{ closingPct: Numeric; rate: Numeric }>;
}): RateCurve {
  return {
    id: row.id,
    version: row.version,
    minimumClosingPct: toNumber(row.minimumClosingPct),
    flatFromClosingPct: toNumber(row.flatFromClosingPct),
    anchors: row.anchors
      .map(a => ({ closingPct: toNumber(a.closingPct), rate: toNumber(a.rate) }))
      .sort((a, b) => a.closingPct - b.closingPct),
  };
}

/**
 * Round to the nearest dollar, halves away from zero.
 *
 * `Math.round` rounds halves toward positive infinity, which is a systematic
 * half-cent tilt in one direction across thousands of settlements. Rates here
 * are always positive so the two agree in practice; the explicit form is here
 * so nobody has to work that out again.
 */
function roundToDollar(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}

/**
 * The rate for a closing percentage, from one curve version.
 *
 * @param closingPct A percentage: 8.5 means 8.5%.
 */
export function rateFor(curve: RateCurve, closingPct: number): CurveVerdict {
  if (!Number.isFinite(closingPct)) {
    throw new Error(`Closing percentage must be a finite number, got ${closingPct}`);
  }

  if (curve.anchors.length === 0) {
    throw new Error(`Rate curve v${curve.version} has no anchor points`);
  }

  // Strictly below the minimum. At exactly the minimum there IS a rate -- 5.0%
  // is the lowest anchor and prices at $264 -- so this is `<`, not `<=`.
  if (closingPct < curve.minimumClosingPct) {
    return { kind: 'BELOW_MINIMUM', minimumClosingPct: curve.minimumClosingPct };
  }

  const highest = curve.anchors[curve.anchors.length - 1];

  // Flat at and above the ceiling. Two conditions rather than one because the
  // ceiling is configured independently of the anchors: whichever the
  // percentage clears first, the answer is the top anchor's rate.
  if (closingPct >= curve.flatFromClosingPct || closingPct >= highest.closingPct) {
    return { kind: 'RATE', rate: roundToDollar(highest.rate) };
  }

  const lowest = curve.anchors[0];
  if (closingPct <= lowest.closingPct) {
    // Between the configured minimum and the lowest anchor, if those ever
    // differ. Flat at the lowest anchor rather than extrapolated, for the same
    // reason the top is flat.
    return { kind: 'RATE', rate: roundToDollar(lowest.rate) };
  }

  for (let i = 0; i < curve.anchors.length - 1; i++) {
    const left = curve.anchors[i];
    const right = curve.anchors[i + 1];
    if (closingPct < left.closingPct || closingPct > right.closingPct) continue;

    const span = right.closingPct - left.closingPct;
    // Two anchors at the same percentage would be a corrupt curve; the unique
    // index on (curveVersionId, closingPct) prevents it, and this keeps the
    // arithmetic from dividing by zero if it ever got through.
    if (span === 0) return { kind: 'RATE', rate: roundToDollar(left.rate) };

    const t = (closingPct - left.closingPct) / span;
    return { kind: 'RATE', rate: roundToDollar(left.rate + t * (right.rate - left.rate)) };
  }

  // Unreachable: the ranges above cover the whole line. Throwing rather than
  // returning a guess, because a silent wrong rate is the failure this whole
  // module exists to avoid.
  throw new Error(
    `Rate curve v${curve.version} could not price a closing percentage of ${closingPct}`
  );
}
