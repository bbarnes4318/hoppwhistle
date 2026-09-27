/**
 * What a buyer has actually been charged, out of the cost report.
 *
 * The report's `buyerCost` sums `buyerBillableAmount` over every call in the
 * window, whatever became of the charge: a call not yet billed, one waived,
 * and one whose return was accepted and refunded all count in it. That is the
 * right figure for the agency's own reports -- what the calls were priced at --
 * and the wrong one to tell a buyer it spent. Spend on these pages is the
 * charged calls only (`buyerChargeStatus = CHARGED`).
 *
 * The report already splits CHARGED by billing type -- a prepaid buyer's
 * charged calls are `walletDebits`, a buyer on terms has them as
 * `pendingInvoice` -- and a buyer is only ever one of the two, so their sum is
 * the charged total for either. Reading it this way needs no change to the
 * report, and so none to what the agency's reports mean.
 */

import { toMajor } from '@/lib/server/buyer';

export function chargedSpend(figures: {
  walletDebits: string | number;
  pendingInvoice: string | number;
}): number {
  return toMajor(figures.walletDebits) + toMajor(figures.pendingInvoice);
}
