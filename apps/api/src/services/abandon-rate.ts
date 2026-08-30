import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * Abandon rate: the share of offered calls where the CALLER hung up before
 * anyone answered.
 *
 * It is NOT `1 - answerRate`. That would count a busy signal, a ring-timeout
 * and a rejected call as abandons, and those are the buyer's problem, not a
 * queue-length problem. The distinction is the entire point of the metric: a
 * rising abandon rate means callers are giving up on you, and nothing else in
 * the product measures that.
 *
 * The numerator reads `Call.terminationParty`, populated on the inbound leg by
 * the FreeSWITCH CDR webhook. Nothing is backfilled, so every row written
 * before that shipped has NULL there.
 */

/** Rates are fractions in [0,1], not percentages. Matches the live-metrics route. */
type Fraction = number;

/**
 * The subset of the generated Call delegate this needs. Derived from
 * PrismaClient rather than hand-declared, so a renamed column is a compile
 * error here; a Pick rather than the whole client so tests can drive it with a
 * fake and assert on the exact `where` clauses.
 */
export type AbandonRateCallDelegate = Pick<PrismaClient['call'], 'count'>;

export interface AbandonRateResult {
  /** null when it cannot be sourced honestly — never a fabricated 0. */
  rate: Fraction | null;
  /** Why `rate` is null. Absent when `rate` is a number. */
  unavailable?: string;
}

const NO_CALLS = 'No calls offered in the window.';

const NOT_INSTRUMENTED =
  'No call in this window records who hung up. Abandon rate is the caller ' +
  'hanging up before answer over total offered; it is sourced from ' +
  'Call.terminationParty, which the FreeSWITCH CDR webhook has only been ' +
  'writing since the termination-party migration and which is not backfilled. ' +
  'The metric goes live on its own once a window fills with instrumented calls. ' +
  'Reporting 0% here would claim nobody is abandoning, which is not something ' +
  'this data can say.';

/**
 * @param offered Total calls in the window — the denominator the caller has
 *   already counted for answer rate. Passed in rather than recounted so the two
 *   rates can never disagree about how many calls there were.
 */
export async function computeAbandonRate(opts: {
  calls: AbandonRateCallDelegate;
  where: Prisma.CallWhereInput;
  offered: number;
}): Promise<AbandonRateResult> {
  const { calls, where, offered } = opts;

  if (offered <= 0) return { rate: null, unavailable: NO_CALLS };

  /*
   * Two counts, both bounded by the same window the caller already scanned.
   *
   * `classified` is what separates "nobody abandoned" from "we weren't
   * recording". Without it a tenant whose FreeSWITCH has not been redeployed
   * yet would see a confident 0% abandon rate, which is a worse lie than a
   * dash: 0% is the number an operator most wants to see and would not
   * question.
   */
  const [classified, abandoned] = await Promise.all([
    calls.count({ where: { ...where, terminationParty: { not: null } } }),
    calls.count({ where: { ...where, terminationParty: 'CALLER', answeredAt: null } }),
  ]);

  if (classified === 0) return { rate: null, unavailable: NOT_INSTRUMENTED };

  /*
   * Denominator is total offered, not `classified`. Partially-instrumented
   * windows (a rolling FreeSWITCH deploy) would otherwise report an abandon
   * rate computed over a shrinking sample and read as a spike. Over the full
   * denominator an unrecorded call counts as not-abandoned, so the rate is
   * biased low while instrumentation is incomplete — understated, never
   * overstated, and it converges as coverage completes.
   */
  return { rate: abandoned / offered };
}
