/**
 * Which carriers' answers changed between two quotes.
 *
 * Deterministic and read straight off the engine's results. Three kinds of
 * change, most important first:
 *
 *   eligibility  -- qualified ↔ declined
 *   class        -- the class (and so the benefit) its best line is written in
 *   premium/face -- same class, but the price or the coverage moved by a
 *                   material amount
 *
 * A premium change is reported only when it is material: at least
 * `PREMIUM_MIN_DELTA` dollars AND at least `PREMIUM_MIN_RATIO` of the old
 * premium, so a rate book's rounding never reads as news. A face change (a
 * budget quote buying more or less) is reported when it moves by
 * `FACE_MIN_DELTA` or more. When a carrier's class or eligibility changed,
 * that is its change; the price move that came with it is carried on the
 * same entry rather than reported twice.
 */

import type { FexResult } from './api';

/** A premium move smaller than this many dollars a period is rounding, not news. */
export const PREMIUM_MIN_DELTA = 0.5;
/** ...or smaller than this share of the old premium. Both must be met. */
export const PREMIUM_MIN_RATIO = 0.005;
/** A face move smaller than this is not reported. */
export const FACE_MIN_DELTA = 100;

export interface CarrierOutcome {
  /** Compared: the class code, or DECLINED. */
  key: string;
  /** Shown: "Level", "Graded", "Declined". */
  label: string;
  premium: number | null;
  face: number | null;
}

export type OutcomeChangeKind = 'eligibility' | 'class' | 'premium' | 'face';

export interface OutcomeChange {
  productId: string;
  carrier: string;
  product: string;
  kind: OutcomeChangeKind;
  /** The outcome before and after ("Level" → "Graded"); the same for a price change. */
  from: string;
  to: string;
  /**
   * Better or worse for the applicant: a stepped benefit or a decline is
   * worse, a higher premium or a smaller face is worse.
   */
  direction: 'better' | 'worse' | 'changed';
  /** The premium before and after, when both were priced. */
  premiumFrom?: number | null;
  premiumTo?: number | null;
  faceFrom?: number | null;
  faceTo?: number | null;
}

export function outcomeOf(result: FexResult): CarrierOutcome {
  if (!result.eligible) return { key: 'DECLINED', label: 'Declined', premium: null, face: null };
  if (!result.best)
    return { key: 'NONE', label: result.outcomeLabel || 'No line', premium: null, face: null };
  return {
    key: `${result.best.benefit}:${result.best.classCode}`,
    label: result.best.classLabel,
    premium: result.best.premium,
    face: result.best.face,
  };
}

export function outcomeMap(results: readonly FexResult[]): Map<string, CarrierOutcome> {
  return new Map(results.map(r => [r.productId, outcomeOf(r)]));
}

/** Level, then the stepped benefits, then nothing: for "better" or "worse". */
const BENEFIT_RANK: Record<string, number> = {
  LEVEL: 0,
  ROP: 1,
  MODIFIED: 2,
  GRADED: 2,
  GUARANTEED_ISSUE: 3,
  GI: 3,
};

function rank(key: string): number | null {
  if (key === 'DECLINED') return 9;
  const benefit = key.split(':')[0];
  return benefit in BENEFIT_RANK ? BENEFIT_RANK[benefit] : null;
}

/** A premium move worth an agent's attention. */
export function premiumMaterial(from: number, to: number): boolean {
  const delta = Math.abs(to - from);
  return delta >= PREMIUM_MIN_DELTA && delta >= Math.abs(from) * PREMIUM_MIN_RATIO;
}

const KIND_ORDER: Record<OutcomeChangeKind, number> = {
  eligibility: 0,
  class: 1,
  face: 2,
  premium: 3,
};

/**
 * The carriers present in both quotes whose answer moved, eligibility and
 * class changes first, then face and premium changes; within each kind in the
 * order of `results`. A carrier that appears or disappears (a state or age
 * the product is not offered at) is not a change of answer and is left out.
 */
export function diffOutcomes(
  previous: ReadonlyMap<string, CarrierOutcome>,
  results: readonly FexResult[]
): OutcomeChange[] {
  const changes: OutcomeChange[] = [];
  for (const result of results) {
    const before = previous.get(result.productId);
    if (!before) continue;
    const after = outcomeOf(result);
    const base = {
      productId: result.productId,
      carrier: result.family,
      product: result.product,
      from: before.label,
      to: after.label,
      premiumFrom: before.premium,
      premiumTo: after.premium,
      faceFrom: before.face,
      faceTo: after.face,
    };

    if (before.key !== after.key) {
      const a = rank(before.key);
      const b = rank(after.key);
      const eligibility = before.key === 'DECLINED' || after.key === 'DECLINED';
      changes.push({
        ...base,
        kind: eligibility ? 'eligibility' : 'class',
        direction: a === null || b === null || a === b ? 'changed' : b > a ? 'worse' : 'better',
      });
      continue;
    }

    if (
      before.face != null &&
      after.face != null &&
      Math.abs(after.face - before.face) >= FACE_MIN_DELTA
    ) {
      changes.push({
        ...base,
        kind: 'face',
        direction: after.face > before.face ? 'better' : 'worse',
      });
      continue;
    }

    if (
      before.premium != null &&
      after.premium != null &&
      premiumMaterial(before.premium, after.premium)
    ) {
      changes.push({
        ...base,
        kind: 'premium',
        direction: after.premium < before.premium ? 'better' : 'worse',
      });
    }
  }
  // Stable: within a kind, the order of the results.
  return changes
    .map((c, i) => ({ c, i }))
    .sort((x, y) => KIND_ORDER[x.c.kind] - KIND_ORDER[y.c.kind] || x.i - y.i)
    .map(x => x.c);
}

/** An outcome change (eligibility or class), as opposed to a price or coverage move. */
export const isOutcomeChange = (c: OutcomeChange): boolean =>
  c.kind === 'eligibility' || c.kind === 'class';
