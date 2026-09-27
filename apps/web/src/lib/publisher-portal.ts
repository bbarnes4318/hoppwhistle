/**
 * The shapes the publisher portal's own money routes answer with.
 *
 * Mirrors `apps/api/src/services/reporting/publisher-portal.ts` and the
 * summary route beside it. The figures are the agency owner's -- this
 * publisher's row of the owner's Payouts screen, from the same function -- so
 * nothing on a portal page adds them up again. Money is dollars.
 */

import type { ResolvedPeriodView } from '@/components/white-label/types';

export interface PublisherPayoutSummary {
  period: ResolvedPeriodView & {
    /** First instant of the period, for reading the calls it covers. */
    startsAt: string;
    /** Last instant of the period. */
    endsAt: string;
  };
  /** Owed for this period's calls and not yet paid. */
  payable: number;
  payableCalls: number;
  /** On hold, or disputed and not yet decided. */
  held: number;
  /** Paid for this period's calls. */
  paid: number;
  /** Returns accepted after a payment, to come off the next one, whatever the period. */
  returnsPending: number;
  /** payable − returnsPending. Negative when more came back than is owed. */
  netPayable: number;
}

/** A returned call taken off a payment, or waiting for the next one. */
export interface PublisherDeduction {
  id: string;
  callId: string | null;
  /** When the returned call came in; null once the call itself is gone. */
  callDate: string | null;
  /** Negative: money coming back off a payment. */
  amount: number;
  createdAt: string;
}

export interface PublisherPayment {
  id: string;
  /** What reached the publisher, net of `deductions`. */
  amount: number;
  method: string;
  reference: string | null;
  paidAt: string;
  periodFrom: string;
  periodTo: string;
  deductions: PublisherDeduction[];
}

export interface PublisherPayments {
  payments: PublisherPayment[];
  waiting: PublisherDeduction[];
}

export function payoutSummaryPath(publisherId: string, periodQuery: string): string {
  return `/api/v1/publishers/${publisherId}/payouts/summary?${periodQuery}`;
}
