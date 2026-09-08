/**
 * Card disputes: detection and containment.
 *
 * ── A chargeback is a payment event, not a billing correction ────────────────
 *
 * A card chargeback takes money back without our consent, often weeks after the
 * applications it paid for were delivered and consumed. That is a fact about a
 * payment. It is NOT a statement that the agency was billed the wrong amount,
 * and it is not answered in the ledger.
 *
 * So nothing in this module writes a ledger row, returns a credit, or changes a
 * figure on a settlement:
 *
 *   consumed credits   stay consumed. The applications were delivered.
 *   the ledger         is not reversed. There is no entry type for it and there
 *                      is not going to be one.
 *   the settlement     keeps every figure it was written with. It is the record
 *                      of what the agency was billed, and it was billed that.
 *
 * What happens instead is containment, and all four parts of it are here:
 *
 *   1. delivery stops for that tenant, immediately, on the webhook;
 *   2. the tenant is flagged on the platform view as DISPUTED -- its own state,
 *      not folded into "suspended", because an operator needs to know which;
 *   3. platform admins are notified. Platform only: a chargeback is NetEnroll's
 *      to answer, and telling an agency's floor before anybody has looked at it
 *      is alarm rather than information;
 *   4. no Overrun at all is extended while a dispute is open -- see
 *      `delivery-gate.ts`, which reads `hasOpenDispute()`.
 *
 * ── Delivery resumes only when a person says so ──────────────────────────────
 *
 * Never automatically. In particular NOT when the dispute closes, and NOT when
 * it closes in our favour: winning a dispute says the money came back, not that
 * the account is one we want to keep extending credit to unexamined. Stripe's
 * `charge.dispute.closed` moves the status on this row and touches nothing
 * else. `standDownDispute()` is the only thing that lifts the suspension, and
 * it takes an operator id.
 */

import type { PrismaClient } from '@prisma/client';
import {
  Prisma,
  SettlementDisputeStatus,
} from '@prisma/client';

import { getPrismaClient } from '../../lib/prisma.js';

import { BillingNotificationKind, notify } from './notifications.js';

/** What a Stripe dispute webhook tells us, once the server has read it. */
export interface DisputeFacts {
  stripeDisputeId: string;
  stripeChargeId: string | null;
  stripePaymentIntentId: string | null;
  /** Dollars. Stripe reports cents; the caller converts once. */
  amount: number;
  reason: string | null;
  /** Stripe's own status string, recorded verbatim. */
  stripeStatus: string | null;
  /** True for `charge.dispute.closed`. */
  closed: boolean;
}

/**
 * Stripe's dispute statuses, mapped to the five this platform records.
 *
 * Unknown strings map to UNDER_REVIEW rather than to a terminal state: a status
 * we do not recognise is not evidence that a dispute is finished, and guessing
 * "won" would be guessing in the direction that stops containing anything.
 */
export function disputeStatusFrom(stripeStatus: string | null | undefined): SettlementDisputeStatus {
  switch (stripeStatus) {
    case 'warning_needs_response':
    case 'warning_under_review':
    case 'needs_response':
      return SettlementDisputeStatus.OPEN;
    case 'won':
      return SettlementDisputeStatus.WON;
    case 'lost':
      return SettlementDisputeStatus.LOST;
    case 'warning_closed':
      return SettlementDisputeStatus.WITHDRAWN;
    default:
      return SettlementDisputeStatus.UNDER_REVIEW;
  }
}

export interface RecordedDispute {
  disputeId: string;
  tenantId: string;
  settlementId: string | null;
  status: SettlementDisputeStatus;
  /** True when this webhook created the row rather than updating one. */
  created: boolean;
  /** True when this call is what stopped delivery. */
  deliverySuspended: boolean;
}

/**
 * Which tenant and settlement a disputed payment belongs to.
 *
 * Resolved from the payment intent Stripe named, against the rows this platform
 * wrote when it placed the debit -- never from anything in the webhook body
 * that claims to be a tenant. A payload cannot name an agency here for the same
 * reason a browser cannot: the tenant is derived from data we recorded.
 *
 * Returns null when the payment is not one of ours to contain. An opening
 * purchase is found through the ledger; a settlement debit through the
 * settlement itself.
 */
export async function resolveDisputedPayment(
  prisma: PrismaClient,
  paymentIntentId: string | null
): Promise<{ tenantId: string; settlementId: string | null } | null> {
  if (!paymentIntentId) return null;

  const settlement = await prisma.dailySettlement.findFirst({
    where: { stripePaymentIntentId: paymentIntentId },
    select: { id: true, tenantId: true },
  });
  if (settlement) return { tenantId: settlement.tenantId, settlementId: settlement.id };

  const purchase = await prisma.applicationCreditLedgerEntry.findFirst({
    where: { stripePaymentIntentId: paymentIntentId },
    select: { tenantId: true, settlementId: true },
  });
  if (purchase) return { tenantId: purchase.tenantId, settlementId: purchase.settlementId };

  return null;
}

/**
 * Record a dispute and contain it.
 *
 * Idempotent on `stripeDisputeId`: Stripe delivers a webhook more than once as
 * a matter of course, and a second delivery must update the status rather than
 * open a second dispute or re-suspend an agency somebody has already stood
 * down.
 */
export async function recordDispute(params: {
  prisma?: PrismaClient;
  tenantId: string;
  settlementId: string | null;
  facts: DisputeFacts;
  now?: Date;
}): Promise<RecordedDispute> {
  const prisma = params.prisma ?? getPrismaClient();
  const now = params.now ?? new Date();
  const { facts } = params;

  const status = disputeStatusFrom(facts.stripeStatus);

  const existing = await prisma.settlementDispute.findUnique({
    where: { stripeDisputeId: facts.stripeDisputeId },
  });

  if (existing) {
    /*
     * A status change and nothing else.
     *
     * `deliveryResumedAt` is deliberately not touched: whether delivery is on
     * is a decision an operator made or did not make, and a webhook does not
     * get to make it in either direction. A dispute that closes in our favour
     * leaves a suspended agency suspended.
     */
    const updated = await prisma.settlementDispute.update({
      where: { id: existing.id },
      data: {
        status,
        stripeStatus: facts.stripeStatus,
        closedAt: facts.closed ? existing.closedAt ?? now : existing.closedAt,
      },
    });

    await notify(
      {
        tenantId: updated.tenantId,
        kind: BillingNotificationKind.PAYMENT_DISPUTE_UPDATED,
        // The dispute AND the status, so each transition is one notice and a
        // redelivered webhook is none.
        subjectKey: `${facts.stripeDisputeId}:${status}`,
        subject: `Card dispute ${status.toLowerCase()} — ${facts.stripeDisputeId}`,
        body:
          `Stripe moved dispute ${facts.stripeDisputeId} to ${facts.stripeStatus ?? status}.\n\n` +
          'Nothing about this agency has changed automatically. Delivery is still stopped ' +
          'if it was stopped, and no credit, settlement figure or ledger row has moved — ' +
          'a chargeback is a payment event, not a billing correction. Resuming delivery is ' +
          'an explicit act on the platform view.',
        toAgency: false,
        toPlatform: true,
        detail: {
          disputeId: updated.id,
          stripeDisputeId: facts.stripeDisputeId,
          status,
          stripeStatus: facts.stripeStatus,
        },
      },
      { prisma }
    ).catch(() => undefined);

    return {
      disputeId: updated.id,
      tenantId: updated.tenantId,
      settlementId: updated.settlementId,
      status: updated.status,
      created: false,
      deliverySuspended: false,
    };
  }

  /*
   * A new dispute. Written and contained in one transaction, so there is no
   * window in which the row exists and delivery is still running.
   *
   * The suspension uses the same `suspendedAt` a platform admin's suspend
   * button sets, because it is the same thing: delivery is off until somebody
   * turns it back on. The reason names the dispute so the platform view can
   * show it as DISPUTED rather than as a generic suspension.
   */
  const created = await prisma.$transaction(async tx => {
    const dispute = await tx.settlementDispute.create({
      data: {
        tenantId: params.tenantId,
        settlementId: params.settlementId,
        stripeDisputeId: facts.stripeDisputeId,
        stripeChargeId: facts.stripeChargeId,
        stripePaymentIntentId: facts.stripePaymentIntentId,
        amount: new Prisma.Decimal(facts.amount.toFixed(2)),
        reason: facts.reason,
        status,
        stripeStatus: facts.stripeStatus,
        openedAt: now,
        closedAt: facts.closed ? now : null,
      },
    });

    await tx.agencyBillingProfile.updateMany({
      where: { tenantId: params.tenantId },
      data: {
        suspendedAt: now,
        // No user: this suspension was not somebody's decision, it was a
        // payment event. Attributing it to an operator would be a lie in the
        // audit trail.
        suspendedByUserId: null,
        suspensionReason: `Card payment disputed (${facts.stripeDisputeId}). Delivery is stopped until NetEnroll reviews it.`,
      },
    });

    return dispute;
  });

  await notify(
    {
      tenantId: params.tenantId,
      kind: BillingNotificationKind.PAYMENT_DISPUTE_OPENED,
      subjectKey: facts.stripeDisputeId,
      subject: `DISPUTED: a card payment was charged back — ${facts.stripeDisputeId}`,
      body:
        `A card payment of $${facts.amount.toFixed(2)} has been disputed.\n\n` +
        `Reason given: ${facts.reason ?? 'none stated'}.\n\n` +
        'Delivery for this agency has been STOPPED and no Overrun will be extended to it. ' +
        'Nothing has been refunded, credited or reversed: consumed credits stay consumed, ' +
        'the ledger is untouched and every settlement figure stands. A chargeback is a ' +
        'payment event, not a billing correction.\n\n' +
        'Delivery resumes only when a platform admin says so — not when the dispute closes, ' +
        'and not because it closes in our favour.',
      toAgency: false,
      toPlatform: true,
      detail: {
        disputeId: created.id,
        stripeDisputeId: facts.stripeDisputeId,
        settlementId: params.settlementId,
        amount: facts.amount,
        reason: facts.reason,
      },
    },
    { prisma }
  ).catch(() => undefined);

  return {
    disputeId: created.id,
    tenantId: created.tenantId,
    settlementId: created.settlementId,
    status: created.status,
    created: true,
    deliverySuspended: true,
  };
}

/**
 * Does this tenant have a dispute nobody has stood down from?
 *
 * The question the delivery gate asks, and it is deliberately NOT "is a dispute
 * open". A dispute that Stripe closed is still a dispute an operator has not
 * looked at, and `deliveryResumedAt` is the only thing that says somebody has.
 *
 * One indexed lookup on `(tenantId, deliveryResumedAt)`.
 */
export async function hasOpenDispute(
  prisma: Pick<PrismaClient, 'settlementDispute'>,
  tenantId: string
): Promise<boolean> {
  const row = await prisma.settlementDispute.findFirst({
    where: { tenantId, deliveryResumedAt: null },
    select: { id: true },
  });
  return row !== null;
}

/**
 * A platform admin's explicit decision that delivery may start again.
 *
 * The only path that lifts a dispute suspension. It stands down every dispute
 * on the tenant that has not been stood down, because delivery is one switch:
 * clearing one of two open disputes and resuming would leave the gate refusing
 * on the other and read as the button not working.
 *
 * It does not settle the dispute with Stripe, return anything to anybody, or
 * change what the agency was charged. It says: a person looked at this, and
 * calls may be offered again.
 */
export async function standDownDispute(params: {
  prisma?: PrismaClient;
  tenantId: string;
  operatorUserId: string;
  note?: string | null;
  now?: Date;
}): Promise<{ disputesStoodDown: number; deliveryResumed: boolean }> {
  const prisma = params.prisma ?? getPrismaClient();
  const now = params.now ?? new Date();

  const result = await prisma.$transaction(async tx => {
    const stood = await tx.settlementDispute.updateMany({
      where: { tenantId: params.tenantId, deliveryResumedAt: null },
      data: {
        deliveryResumedAt: now,
        deliveryResumedByUserId: params.operatorUserId,
        deliveryResumedNote: params.note ?? null,
      },
    });

    if (stood.count === 0) return { disputesStoodDown: 0, deliveryResumed: false };

    /*
     * Lift the suspension this dispute placed, and only that one.
     *
     * `suspendedByUserId IS NULL` is what distinguishes a suspension the
     * dispute handler wrote from one an operator placed by hand. An agency a
     * platform admin suspended for an unrelated reason stays suspended: standing
     * down a chargeback is not a general amnesty.
     */
    await tx.agencyBillingProfile.updateMany({
      where: { tenantId: params.tenantId, suspendedByUserId: null },
      data: { suspendedAt: null, suspensionReason: null },
    });

    return { disputesStoodDown: stood.count, deliveryResumed: true };
  });

  return result;
}
