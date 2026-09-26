/**
 * The shapes `apps/api/src/routes/returns.ts` answers with.
 *
 * A "return" is a buyer's dispute of a call, waiting on the white-label owner:
 * OPEN is `disputeStatus = 'DISPUTED'`, and a decision moves it to ACCEPTED
 * (the buyer is refunded or not charged, the publisher is not paid) or DENIED
 * (the call stands as sold). Money is dollars; every figure arrives computed.
 */

export type ReturnStatus = 'OPEN' | 'ACCEPTED' | 'DENIED';
export type ReturnDecision = 'ACCEPT' | 'DENY';

export interface ReturnRow {
  callId: string;
  startedAt: string | null;
  status: ReturnStatus;
  buyer: { id: string; name: string } | null;
  publisher: { id: string; name: string } | null;
  campaignName: string | null;
  callerId: string | null;
  connectedDuration: number | null;
  buyerBillableAmount: number | null;
  publisherPayoutAmount: number | null;
  publisherPayoutStatus: string | null;
  buyerChargeStatus: string | null;
  buyerBillingType: string | null;
  reason: string | null;
  disputedAt: string | null;
  disputedBy: string | null;
  recordingId: string | null;
  decision: {
    decision: ReturnDecision;
    decidedAt: string | null;
    decidedBy: string | null;
    note: string | null;
  } | null;
  /**
   * An accepted return on a call whose publisher was already paid: the
   * deduction from that publisher's next payment, and the payment it came out
   * of (null while it waits).
   */
  clawback: { paymentId: string; amount: number; appliedToPaymentId: string | null } | null;
}

export interface ReturnsPage {
  data: ReturnRow[];
  meta: { page: number; limit: number; total: number; totalPages: number; openCount: number };
}

/** What the decision dialog needs to say what a decision will do. */
export type ReturnSubject = Pick<
  ReturnRow,
  | 'callId'
  | 'buyer'
  | 'publisher'
  | 'buyerBillableAmount'
  | 'publisherPayoutAmount'
  | 'publisherPayoutStatus'
  | 'buyerChargeStatus'
  | 'buyerBillingType'
>;
