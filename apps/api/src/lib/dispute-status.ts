/**
 * What `Call.disputeStatus` means, in one place.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 *
 * The column is a free string, and every reader used to treat ANY non-null
 * value as an open dispute: `!!call.disputeStatus`, `{ not: null }`. That was
 * true while the only value ever written was 'DISPUTED' (the buyer's dispute
 * route). It stopped being true the moment a return could be DECIDED: an
 * operator's decision leaves 'ACCEPTED' or 'DENIED' behind, and both of those
 * are closed. Read as "disputed", a denied return would sit in HELD forever and
 * never be paid, and an accepted one would be counted as a dispute on top of
 * already carrying zero revenue.
 *
 * So there is exactly one open state, and exactly one way to ask about it.
 *
 *   'DISPUTED'   open: the buyer has asked for the call back, nobody has decided
 *   'ACCEPTED'   closed: the return was granted; revenue and payout are zeroed
 *                on the call itself (routes/returns.ts)
 *   'DENIED'     closed: the call stands and counts as an ordinary call
 *   null         never disputed
 */

/** The one value of `Call.disputeStatus` that is an open dispute. */
export const OPEN_DISPUTE = 'DISPUTED';

/** A return the operator granted. */
export const ACCEPTED_DISPUTE = 'ACCEPTED';

/** A return the operator refused; the call stands. */
export const DENIED_DISPUTE = 'DENIED';

/** True only for an open dispute -- never for a decided one, and never for null. */
export function isOpenDispute(status: string | null | undefined): boolean {
  return status === OPEN_DISPUTE;
}
