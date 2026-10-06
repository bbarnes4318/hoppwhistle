/**
 * Which carriers' answers changed between two quotes.
 *
 * Deterministic and read straight off the engine's results: a carrier's
 * outcome is the class its best line is written in, or "Declined". Premiums
 * are deliberately not compared -- every face or age change moves every
 * premium, and "40 carriers changed" says nothing. A class or an eligibility
 * changing is what an agent needs to see after adding a condition.
 */

import type { FexResult } from './api';

export interface CarrierOutcome {
  /** Compared: the class code, or DECLINED. */
  key: string;
  /** Shown: "Level", "Graded", "Declined". */
  label: string;
}

export interface OutcomeChange {
  productId: string;
  carrier: string;
  product: string;
  from: string;
  to: string;
  /** Moved from a written class to a decline, or the other way. */
  direction: 'better' | 'worse' | 'changed';
}

export function outcomeOf(result: FexResult): CarrierOutcome {
  if (!result.eligible) return { key: 'DECLINED', label: 'Declined' };
  if (!result.best) return { key: 'NONE', label: result.outcomeLabel || 'No line' };
  return { key: `${result.best.benefit}:${result.best.classCode}`, label: result.best.classLabel };
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

/**
 * The carriers present in both quotes whose outcome differs, in the order of
 * `results`. A carrier that appears or disappears (a state or age the product
 * is not offered at) is not a change of answer and is left out.
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
    if (before.key === after.key) continue;
    const a = rank(before.key);
    const b = rank(after.key);
    changes.push({
      productId: result.productId,
      carrier: result.family,
      product: result.product,
      from: before.label,
      to: after.label,
      direction: a === null || b === null || a === b ? 'changed' : b > a ? 'worse' : 'better',
    });
  }
  return changes;
}
