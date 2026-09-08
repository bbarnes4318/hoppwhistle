/**
 * The daily settlement.
 *
 * After each Delivery Day closes, per tenant, in this order:
 *
 *   1. Compute the day's Delivered Calls and Submitted Applications.
 *   2. Compute the trailing-window closing percentage and derive the next day's
 *      rate from the curve -- by calling the Phase 2 engine, not by
 *      reimplementing it.
 *   3. Bill today's Overrun at that new rate.
 *   4. Sell the next Delivery Day's block at that new rate, in the agency's
 *      configured daily target quantity, reduced or omitted where unused paid
 *      applications remain.
 *   5. Charge both as a single off-session debit.
 *   6. Write an immutable settlement record.
 *
 * ── Idempotency is the requirement that matters most ─────────────────────────
 *
 * The unique index on `(tenantId, deliveryDay)` is the whole mechanism, and it
 * is deliberately not a check-then-act. The sequence is:
 *
 *   A. INSERT the settlement, with every computed figure, status PENDING.
 *      A second run racing the first loses this insert and stops. It does not
 *      look first and then decide; it tries, and the database decides.
 *   B. Charge, OUTSIDE that transaction, with the settlement id as Stripe's
 *      idempotency key.
 *   C. Record the outcome, and on success write the purchase that sells
 *      tomorrow's block.
 *
 * So two concurrent runs for one tenant and day produce one settlement row, one
 * charge and one block. `settlement.test.ts` runs them genuinely concurrently
 * and asserts the gateway was called once.
 *
 * A process that dies between A and B leaves a PENDING settlement with no
 * attempts. That is NOT resumed by an ordinary re-run -- which would reopen the
 * race the insert closes -- but by `resumeStalledSettlements()`, which only
 * touches rows old enough that no run can still be in flight, and which charges
 * with the same idempotency key so Stripe returns the same payment intent
 * rather than a second debit.
 *
 * ── The maximum daily debit is a commitment, not a guideline ─────────────────
 *
 * If the computed total exceeds the agency's configured maximum, nothing is
 * sent to Stripe at all. The settlement is written as HALTED_MAX_DEBIT, no
 * block is sold, and platform admins are alerted. It is not clamped to the
 * maximum and charged: a figure on an Insertion Order is not a rounding
 * instruction.
 *
 * ── One agency failing must not stop another ─────────────────────────────────
 *
 * `runDailySettlement()` settles tenants one at a time and collects failures.
 * Their ledgers, rates and payment instruments are independent, and a bad row
 * for one must not leave the rest unbilled.
 *
 * ── Enrolment, and the dry run ───────────────────────────────────────────────
 *
 * An agency that has not been explicitly enrolled is skipped entirely, before
 * anything is computed or written. See `settleAgencyForDeliveryDay` below.
 *
 * An agency that IS enrolled but has not had charging enabled gets the whole
 * settlement -- the reconciliation, the counts, the rating call, the overrun,
 * the block, the immutable record with every figure on it -- and no Stripe
 * charge. The row reads `paymentStatus: DRY_RUN` and `totalCharged` is what it
 * would have taken. That is the mode to run a real agency in for a few days
 * before any money moves, and it is the default on enrolment: turning charging
 * on is a second, separate, explicit act.
 *
 * The next Delivery Day's block IS sold in a dry run, deliberately. Not selling
 * it would leave the agency at a zero balance, every application would be
 * Overrun, and delivery would stop at the ceiling on the first day -- so the
 * thing being watched would not be the system's real behaviour. The purchase
 * carries no Stripe payment reference and names a DRY_RUN settlement, so an
 * unpaid block is identifiable from the rows; see docs/BILLING.md on what to do
 * with that balance at cutover.
 *
 * ── The rate is the curve rate plus the agency's offset ──────────────────────
 *
 * Everything below prices at the EFFECTIVE rate: what the rating engine
 * returned, which is the curve's answer plus the agency's recorded rate offset.
 * There is no separate fee line on a settlement, in the export or anywhere
 * else, because an itemised fee added to a price is a surcharge and a different
 * price is not.
 *
 * The settlement stores `curveRate` and `rateOffset` beside `rate`, so the row
 * still explains its own price and a later change to either is visible as a
 * different row rather than as an unexplained movement. All three are under the
 * immutability trigger: changing an agency's offset tomorrow cannot alter a
 * settlement written tonight.
 *
 * ── ACH or card ──────────────────────────────────────────────────────────────
 *
 * The instrument is `terms.paymentMethod`, and `terms.settlementPaymentMethodId`
 * is the Stripe payment method it resolves to. Both charges are off-session
 * against something the agency already authorised; neither is reachable from a
 * browser and neither takes an amount from one.
 *
 * ── No refunds ───────────────────────────────────────────────────────────────
 *
 * Nothing here reverses anything. There is no code path that returns a credit,
 * no negative charge, and no compensating ledger row. A carrier's decision
 * after an application is submitted is not read anywhere in this file. A card
 * chargeback does not reach this file at all: see `disputes.ts` -- it is
 * contained, not reversed, and no figure written here moves because of one.
 */

import type { PrismaClient } from '@prisma/client';
import {
  AgencyPaymentMethod,
  CreditLedgerEntryType,
  Prisma,
  SettlementPaymentStatus,
} from '@prisma/client';

import { logger } from '../../lib/logger.js';
import { getPrismaClient } from '../../lib/prisma.js';
import { businessDayPeriodEnd, CONTRACT_PERIODS } from '../rating/business-day.js';
import { calendarDayBounds, lastClosedCalendarDay, nextCalendarDay } from '../rating/calendar-day.js';
import type { CalendarDayKey } from '../rating/calendar-day.js';
import { measureCalendarDay } from '../rating/measurement.js';
import { toNumber } from '../rating/rate-curve.js';
import { rateAgencyForClosedDay } from '../rating/rating-engine.js';

import { paymentGateway } from './ach.js';
import type { PaymentGateway } from './ach.js';
import {
  creditBalance,
  ledgerCountsForDay,
  recordPurchase,
  reconcileDeliveryDay,
} from './credit-ledger.js';
import { BillingNotificationKind, notify } from './notifications.js';
import { loadAgencyTerms } from './terms.js';

/** Dollars to whole cents, without floating-point drift. */
export function toCents(dollars: number): number {
  return Number(new Prisma.Decimal(dollars).mul(100).toFixed(0));
}

export interface SettleOptions {
  tenantId: string;
  /** The Delivery Day that closed. Defaults to the last closed calendar day. */
  deliveryDay?: CalendarDayKey;
  prisma?: PrismaClient;
  gateway?: PaymentGateway;
  now?: Date;
  /**
   * Settle without charging: compute and record the full settlement for this
   * invocation, whatever the agency's own `chargesEnabled` says, and place no
   * debit.
   *
   * One-directional on purpose: this can only ever turn charging OFF. There is
   * no option here that turns it on for an agency whose profile says otherwise,
   * because a per-run flag that starts charging somebody is a flag somebody
   * passes by accident once.
   */
  settleWithoutCharge?: boolean;
}

export interface SettlementResult {
  tenantId: string;
  deliveryDay: CalendarDayKey;
  settlementId: string | null;
  /** True when a settlement for this agency and day already existed. */
  alreadySettled: boolean;
  paymentStatus: SettlementPaymentStatus | null;
  deliveredCalls: number;
  submittedApplications: number;
  /** The effective rate: the curve rate plus the agency's rate offset. */
  rate: number | null;
  /** The curve's own answer, before the offset. */
  curveRate: number | null;
  /** The offset that was in force tonight. */
  rateOffset: number;
  overrunQuantity: number;
  overrunAmount: number;
  nextBlockQuantity: number;
  nextBlockAmount: number;
  totalCharged: number;
  /** Set when the run refused to do anything at all, with the reason. */
  skippedReason: string | null;
}

/**
 * Settle one agency for one Delivery Day.
 */
export async function settleAgencyForDeliveryDay(
  options: SettleOptions
): Promise<SettlementResult> {
  const prisma = options.prisma ?? getPrismaClient();
  const gateway = options.gateway ?? paymentGateway();
  const now = options.now ?? new Date();
  const deliveryDay = options.deliveryDay ?? lastClosedCalendarDay(now);
  const tenantId = options.tenantId;

  const empty = (skippedReason: string | null, alreadySettled = false): SettlementResult => ({
    tenantId,
    deliveryDay,
    settlementId: null,
    alreadySettled,
    paymentStatus: null,
    deliveredCalls: 0,
    submittedApplications: 0,
    rate: null,
    curveRate: null,
    rateOffset: 0,
    overrunQuantity: 0,
    overrunAmount: 0,
    nextBlockQuantity: 0,
    nextBlockAmount: 0,
    totalCharged: 0,
    skippedReason,
  });

  const terms = await loadAgencyTerms(tenantId, { prisma });

  /*
   * An agency that has not been explicitly enrolled in billing is skipped
   * entirely -- no settlement row, not even one saying zero.
   *
   * A row would be an assertion that this agency was billed nothing for the
   * day, and the truth is different and worth keeping distinguishable: it is
   * not in the billing system. `daily_settlements` is the record of days that
   * were settled, and a night of zero-value rows for every unenrolled tenant on
   * the platform would bury the days that were.
   *
   * This covers the no-profile case too, since enrolment lives on the profile
   * and an agency without one cannot be enrolled.
   */
  if (!terms.enrolled) {
    return empty(
      terms.profile
        ? 'not enrolled in billing'
        : 'not enrolled in billing: no billing profile recorded'
    );
  }

  const bounds = calendarDayBounds(deliveryDay);

  // Step 0 -- everything the agency actually submitted today has a ledger row,
  // including any the submission-time hook failed to write. Before the day's
  // overrun is counted, or the count is of what got written rather than of what
  // happened.
  await reconcileDeliveryDay({ prisma, tenantId, deliveryDay, bounds });

  // Step 1 -- the day's counts, from the Phase 2 definitions. Not restated here.
  const measurement = await measureCalendarDay(
    { calls: prisma.call, applications: prisma.insuranceCarrierApplication },
    tenantId,
    deliveryDay
  );

  /*
   * Step 2 -- the trailing window and the next day's rate, from the Phase 2
   * engine. Called, not reimplemented: there is one rate curve and one window
   * definition on this platform, and a second implementation living in the
   * billing code is exactly the divergence Phase 2 was written to prevent.
   *
   * It is itself idempotent -- one decision per agency per effective day -- so
   * a second settlement run cannot re-apply a rate.
   */
  const rating = await rateAgencyForClosedDay({
    tenantId,
    closedCalendarDay: deliveryDay,
    prisma,
    now,
  });

  /*
   * The `rate_changes` row the engine just wrote (or found already written).
   * Read back rather than reconstructed from the result object, so the
   * settlement copies the window, the curve version and the counts from the
   * one immutable record that priced them. An agency disputing a charge is then
   * answered from two rows that cannot disagree.
   */
  const rateChange = await prisma.rateChange.findUnique({
    where: { id: rating.rateChangeId },
  });

  /*
   * Tonight's price, and its two halves.
   *
   * `rating.newRate` is the EFFECTIVE rate: what the curve returned for the
   * window plus this agency's recorded rate offset. That is what the agency is
   * charged and what every figure below is computed from -- there is no
   * separate fee added to a total anywhere, because a fee added to a price is a
   * surcharge and this is a price.
   *
   * `rating.curveRate` and `rating.rateOffset` are stored beside it so the
   * settlement row explains its own price without a join to a profile that may
   * since have changed.
   */
  const effective = rating.newRate;
  const curveRate = rating.curveRate;
  const rateOffset = rating.rateOffset;

  /*
   * When the curve returns no rate -- the window closed below the minimum --
   * there is no next-day price, and the curve is never extrapolated downward to
   * invent one. Tonight's overrun is still owed, so it is billed at the rate
   * that was in force on the Delivery Day it was incurred on: the rate the
   * agency's credits for that day were sold at, which is a number both sides
   * already agreed and which is stored on the purchase row. That stored number
   * is already an effective rate -- it is what was actually charged -- so no
   * offset is added to it a second time.
   *
   * No block is sold in that case. Delivery is paused on the review flag, and
   * selling an agency a block it cannot use would be taking money for nothing.
   */
  const fallbackRate = await rateInForceOnDay(prisma, tenantId, deliveryDay);
  const overrunRate = effective ?? fallbackRate;

  const counts = await ledgerCountsForDay(prisma, tenantId, deliveryDay);

  // Step 3 -- today's overrun, at that rate.
  const overrunQuantity = counts.overrun;
  const overrunAmount =
    overrunRate === null ? 0 : Number((overrunQuantity * overrunRate).toFixed(2));

  /*
   * Step 4 -- tomorrow's block.
   *
   * "Reduced or omitted where unused paid applications remain": the balance is
   * what the agency has already paid for and has not used, so the block is the
   * configured daily target minus that, floored at zero. An agency sitting on
   * more credits than its daily target buys nothing tonight.
   */
  const balance = await creditBalance(prisma, tenantId);
  const unusedPaidApplications = Math.max(0, balance);
  const configuredBlockQuantity = terms.dailyBlockApplications;
  const nextBlockQuantity =
    effective === null ? 0 : Math.max(0, configuredBlockQuantity - unusedPaidApplications);
  const nextBlockAmount =
    effective === null ? 0 : Number((nextBlockQuantity * effective).toFixed(2));

  // Step 5 -- one debit for both.
  const totalCharged = Number((overrunAmount + nextBlockAmount).toFixed(2));

  const exceedsMaxDebit = totalCharged > terms.maxDailyDebit;
  const missingMandate = !terms.hasValidMandate;

  /*
   * Whether a debit may actually be placed.
   *
   * Off unless the agency's profile says charging is enabled, and the per-run
   * `settleWithoutCharge` can only turn it further off. Everything above this
   * line has already been computed either way -- the dry run is the real
   * settlement with the last step withheld, not a different calculation.
   */
  const chargingAllowed = terms.chargesEnabled && options.settleWithoutCharge !== true;

  /*
   * The maximum-daily-debit halt is checked even in a dry run, and comes first.
   *
   * A dry run exists to show what would happen. An agency whose computed
   * settlement is over its Insertion Order ceiling would HALT, not be charged,
   * so that is what the record has to say -- reporting DRY_RUN there would hide
   * the one outcome somebody watching a dry run most needs to see.
   */
  const initialStatus: SettlementPaymentStatus = exceedsMaxDebit
    ? SettlementPaymentStatus.HALTED_MAX_DEBIT
    : totalCharged === 0
      ? SettlementPaymentStatus.NOT_CHARGED
      : !chargingAllowed
        ? SettlementPaymentStatus.DRY_RUN
        : missingMandate
          ? SettlementPaymentStatus.HALTED_NO_MANDATE
          : SettlementPaymentStatus.PENDING;

  /*
   * Step 6, part one -- the record. Written BEFORE any money moves.
   *
   * This insert is the idempotency. A second run racing this one loses it and
   * returns without charging anybody; it does not read first and then decide.
   */
  let settlement;
  try {
    settlement = await prisma.dailySettlement.create({
      data: {
        tenantId,
        deliveryDay,
        deliveredCalls: measurement.deliveredCalls,
        submittedApplications: measurement.submittedApplications,
        windowClosingPct: rateChange?.closingPct ?? null,
        windowDeliveryDays: rateChange?.windowDeliveryDays ?? 0,
        windowDaysFound: rateChange?.windowDaysFound ?? 0,
        windowDayKeys: rateChange?.windowDayKeys ?? [],
        rate: overrunRate === null ? null : new Prisma.Decimal(overrunRate.toFixed(2)),
        /*
         * The two halves of the price, copied from the rating decision.
         *
         * Null `curveRate` beside a non-null `rate` says the same thing a null
         * `curveVersionId` does: this was the rate in force on the Delivery Day
         * rather than one the curve returned tonight. `rateOffset` is recorded
         * either way, so a reader can always tell an offset change from a curve
         * change, and both are under the immutability trigger.
         */
        curveRate: curveRate === null ? null : new Prisma.Decimal(curveRate.toFixed(2)),
        rateOffset: new Prisma.Decimal(rateOffset.toFixed(2)),
        /*
         * The curve version is recorded ONLY when the curve actually priced
         * tonight. A null here beside a non-null `rate` is the row saying "this
         * was the rate in force on the Delivery Day, not a rate the curve
         * returned" -- which is what happens when the window closed below the
         * minimum and there is no next-day price to derive. It is a distinction
         * an agency reading the row is entitled to see.
         */
        curveVersionId: effective === null ? null : rateChange?.curveVersionId ?? null,
        curveVersion: effective === null ? null : rateChange?.curveVersion ?? null,
        rateChangeId: rating.rateChangeId,
        overrunQuantity,
        overrunAmount: new Prisma.Decimal(overrunAmount.toFixed(2)),
        configuredBlockQuantity,
        unusedPaidApplications,
        nextBlockQuantity,
        nextBlockAmount: new Prisma.Decimal(nextBlockAmount.toFixed(2)),
        totalCharged: new Prisma.Decimal(totalCharged.toFixed(2)),
        maxDailyDebit: new Prisma.Decimal(terms.maxDailyDebit.toFixed(2)),
        paymentStatus: initialStatus,
        gracePeriodEndsOn:
          initialStatus === SettlementPaymentStatus.HALTED_MAX_DEBIT ||
          initialStatus === SettlementPaymentStatus.HALTED_NO_MANDATE
            ? businessDayPeriodEnd(
                deliveryDay,
                CONTRACT_PERIODS.SETTLEMENT_GRACE_BUSINESS_DAYS
              )
            : null,
        computedAt: now,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const existing = await prisma.dailySettlement.findUnique({
        where: { tenantId_deliveryDay: { tenantId, deliveryDay } },
      });
      return {
        ...empty('already settled for this Delivery Day', true),
        settlementId: existing?.id ?? null,
        paymentStatus: existing?.paymentStatus ?? null,
        deliveredCalls: existing?.deliveredCalls ?? 0,
        submittedApplications: existing?.submittedApplications ?? 0,
        rate: existing?.rate == null ? null : toNumber(existing.rate),
        curveRate: existing?.curveRate == null ? null : toNumber(existing.curveRate),
        rateOffset: existing?.rateOffset == null ? 0 : toNumber(existing.rateOffset),
        overrunQuantity: existing?.overrunQuantity ?? 0,
        overrunAmount: existing?.overrunAmount == null ? 0 : toNumber(existing.overrunAmount),
        nextBlockQuantity: existing?.nextBlockQuantity ?? 0,
        nextBlockAmount: existing?.nextBlockAmount == null ? 0 : toNumber(existing.nextBlockAmount),
        totalCharged: existing?.totalCharged == null ? 0 : toNumber(existing.totalCharged),
      };
    }
    throw error;
  }

  const base: SettlementResult = {
    tenantId,
    deliveryDay,
    settlementId: settlement.id,
    alreadySettled: false,
    paymentStatus: initialStatus,
    deliveredCalls: measurement.deliveredCalls,
    submittedApplications: measurement.submittedApplications,
    rate: overrunRate,
    curveRate,
    rateOffset,
    overrunQuantity,
    overrunAmount,
    nextBlockQuantity,
    nextBlockAmount,
    totalCharged,
    skippedReason: null,
  };

  if (initialStatus === SettlementPaymentStatus.HALTED_MAX_DEBIT) {
    await notifyMaxDebitHalt(prisma, tenantId, settlement.id, deliveryDay, totalCharged, terms.maxDailyDebit);
    return base;
  }

  if (initialStatus === SettlementPaymentStatus.HALTED_NO_MANDATE) {
    await notify(
      {
        tenantId,
        kind: BillingNotificationKind.MANDATE_MISSING,
        subjectKey: settlement.id,
        subject: `Settlement for ${deliveryDay} could not be charged: no ACH mandate`,
        body:
          `A settlement of $${totalCharged.toFixed(2)} for Delivery Day ${deliveryDay} was ` +
          'computed but not charged: this agency has no valid ACH mandate. Delivery is already ' +
          'held for the same reason.',
        toAgency: true,
        toPlatform: true,
      },
      { prisma }
    );
    return base;
  }

  if (initialStatus === SettlementPaymentStatus.NOT_CHARGED) {
    // Nothing owed and nothing to sell. The row still exists, because a day the
    // job ran and found nothing to bill and a day the job did not run are
    // different things and only one of them is fine.
    return base;
  }

  if (initialStatus === SettlementPaymentStatus.DRY_RUN) {
    /*
     * Everything except the debit.
     *
     * The block is still sold, so the agency keeps delivering the way it would
     * if the charge had gone through and what is being watched is the system's
     * real behaviour rather than an agency starved to its ceiling on day one.
     * The purchase carries no Stripe payment reference and names this DRY_RUN
     * settlement, which is what makes an unpaid block identifiable later.
     *
     * No payment attempt row: none was attempted. No notification: nothing
     * failed. `totalCharged` on the record is what this would have taken.
     */
    if (nextBlockQuantity > 0 && effective !== null) {
      await recordPurchase(prisma, {
        tenantId,
        deliveryDay: nextCalendarDay(deliveryDay),
        quantity: nextBlockQuantity,
        // The effective rate, which is the price. The purchase row is what
        // the overrun on a later day falls back to when the curve has nothing
        // to say, so it has to carry what was actually charged.
        unitRate: effective,
        stripePaymentIntentId: null,
        settlementId: settlement.id,
        curveVersionId: rateChange?.curveVersionId ?? null,
        curveVersion: rateChange?.curveVersion ?? null,
      });
    }

    logger.info({
      msg: 'Settlement computed and recorded; no debit placed (charging not enabled)',
      tenantId,
      deliveryDay,
      settlementId: settlement.id,
      wouldHaveCharged: totalCharged,
    });

    return base;
  }

  return chargeAndFinalise({
    prisma,
    gateway,
    settlementId: settlement.id,
    tenantId,
    deliveryDay,
    totalCharged,
    attemptNumber: 1,
    customerId: terms.stripeCustomerId,
    paymentMethodId: terms.settlementPaymentMethodId,
    paymentMethod: terms.paymentMethod,
    nextBlockQuantity,
    nextBlockRate: effective,
    curveVersionId: rateChange?.curveVersionId ?? null,
    curveVersion: effective === null ? null : rateChange?.curveVersion ?? null,
    result: base,
    now,
  });
}

/**
 * Place the debit and record what happened.
 *
 * Split out because a retry does exactly the same thing with a later attempt
 * number and a different idempotency key.
 */
async function chargeAndFinalise(params: {
  prisma: PrismaClient;
  gateway: PaymentGateway;
  settlementId: string;
  tenantId: string;
  deliveryDay: CalendarDayKey;
  totalCharged: number;
  attemptNumber: number;
  customerId: string | null;
  paymentMethodId: string | null;
  /**
   * Which instrument to debit. ACH unless the agency's terms say CARD.
   *
   * Both are off-session against something the agency already authorised, and
   * neither takes an amount from anywhere but the ledger and the rating engine.
   * A card-paying agency is priced differently through its rate offset, not
   * charged a fee here: nothing on this path adds anything to `totalCharged`.
   */
  paymentMethod: AgencyPaymentMethod;
  nextBlockQuantity: number;
  nextBlockRate: number | null;
  curveVersionId?: string | null;
  curveVersion: number | null;
  result: SettlementResult;
  now: Date;
}): Promise<SettlementResult> {
  const { prisma, gateway, settlementId, tenantId, deliveryDay } = params;

  const request = {
    customerId: params.customerId ?? '',
    paymentMethodId: params.paymentMethodId ?? '',
    amountCents: toCents(params.totalCharged),
    description: `NetEnroll settlement ${deliveryDay}`,
    // Stable per attempt. A crash between Stripe accepting this and us
    // recording it means the same key comes back with the same payment
    // intent instead of a second debit.
    idempotencyKey: `settlement:${settlementId}:${params.attemptNumber}`,
    metadata: { tenantId, deliveryDay, settlementId },
  };

  const charge =
    params.customerId && params.paymentMethodId
      ? params.paymentMethod === AgencyPaymentMethod.CARD
        ? await gateway.chargeCardOffSession(request)
        : await gateway.chargeAchOffSession(request)
      : {
          ok: false,
          paymentIntentId: null,
          status: null,
          failureCode: 'no_payment_method',
          failureMessage: 'No Stripe customer or ACH payment method is recorded for this agency.',
        };

  const status = charge.ok ? SettlementPaymentStatus.SUCCEEDED : SettlementPaymentStatus.FAILED;

  await prisma.$transaction(async tx => {
    await tx.settlementPaymentAttempt.create({
      data: {
        settlementId,
        attemptNumber: params.attemptNumber,
        status,
        amount: new Prisma.Decimal(params.totalCharged.toFixed(2)),
        stripePaymentIntentId: charge.paymentIntentId,
        failureCode: charge.failureCode,
        failureMessage: charge.failureMessage,
        occurredAt: params.now,
      },
    });

    await tx.dailySettlement.update({
      where: { id: settlementId },
      data: {
        paymentStatus: status,
        stripePaymentIntentId: charge.paymentIntentId,
        paymentFailureCode: charge.failureCode,
        paymentFailureMessage: charge.failureMessage,
        paidAt: charge.ok ? params.now : null,
        /*
         * The grace period starts at the FIRST failure and is not extended by a
         * retry: five Business Days from the Delivery Day that failed, counted
         * in weekdays excluding US federal holidays. A retry that also fails
         * must not push the deadline out, so this is only written when it is
         * still null.
         */
        ...(charge.ok
          ? { gracePeriodEndsOn: null }
          : {
              gracePeriodEndsOn:
                (
                  await tx.dailySettlement.findUnique({
                    where: { id: settlementId },
                    select: { gracePeriodEndsOn: true },
                  })
                )?.gracePeriodEndsOn ??
                businessDayPeriodEnd(
                  deliveryDay,
                  CONTRACT_PERIODS.SETTLEMENT_GRACE_BUSINESS_DAYS
                ),
            }),
      },
    });

    /*
     * The block is sold only when the money was taken. A failed settlement sells
     * no block -- delivery holds at the current PAID balance, which is what the
     * agency has already bought and which nothing removes.
     */
    if (charge.ok && params.nextBlockQuantity > 0 && params.nextBlockRate !== null) {
      await recordPurchase(tx as unknown as PrismaClient, {
        tenantId,
        deliveryDay: nextCalendarDay(deliveryDay),
        quantity: params.nextBlockQuantity,
        unitRate: params.nextBlockRate,
        stripePaymentIntentId: charge.paymentIntentId,
        settlementId,
        curveVersionId: params.curveVersionId ?? null,
        curveVersion: params.curveVersion,
      });
    }
  });

  if (!charge.ok) {
    await notifySettlementFailure(prisma, {
      tenantId,
      settlementId,
      deliveryDay,
      amount: params.totalCharged,
      attemptNumber: params.attemptNumber,
      failureMessage: charge.failureMessage,
    });
  }

  return { ...params.result, paymentStatus: status };
}

/**
 * The rate an agency's applications were priced at on a given Delivery Day.
 *
 * Read off the purchase that covered that day, which is the price the agency
 * actually paid rather than a price recomputed later. Falls back to the rate
 * change recorded for the day, and to null when neither exists -- in which case
 * the overrun genuinely has no agreed price and is recorded at zero with the
 * quantity still on the row, so it is visible rather than lost.
 */
async function rateInForceOnDay(
  prisma: PrismaClient,
  tenantId: string,
  deliveryDay: CalendarDayKey
): Promise<number | null> {
  const purchase = await prisma.applicationCreditLedgerEntry.findFirst({
    where: { tenantId, deliveryDay, entryType: CreditLedgerEntryType.PURCHASE },
    orderBy: { createdAt: 'desc' },
    select: { unitRate: true },
  });
  if (purchase?.unitRate != null) return toNumber(purchase.unitRate);

  const change = await prisma.rateChange.findUnique({
    where: { tenantId_effectiveCalendarDay: { tenantId, effectiveCalendarDay: deliveryDay } },
    select: { newRate: true, previousRate: true },
  });
  if (change?.newRate != null) return toNumber(change.newRate);
  if (change?.previousRate != null) return toNumber(change.previousRate);

  const state = await prisma.agencyRatingState.findUnique({
    where: { tenantId },
    select: { currentRate: true, openingRate: true },
  });
  if (state?.currentRate != null) return toNumber(state.currentRate);
  if (state?.openingRate != null) return toNumber(state.openingRate);

  return null;
}

async function notifyMaxDebitHalt(
  prisma: PrismaClient,
  tenantId: string,
  settlementId: string,
  deliveryDay: CalendarDayKey,
  totalCharged: number,
  maxDailyDebit: number
): Promise<void> {
  const tenant = await prisma.tenant
    .findUnique({ where: { id: tenantId }, select: { name: true } })
    .catch(() => null);

  await notify(
    {
      tenantId,
      kind: BillingNotificationKind.MAX_DAILY_DEBIT_EXCEEDED,
      subjectKey: settlementId,
      subject: `HALTED: settlement for ${tenant?.name ?? tenantId} exceeds the maximum daily debit`,
      body:
        `The settlement computed for Delivery Day ${deliveryDay} is $${totalCharged.toFixed(2)}, ` +
        `above the configured maximum daily debit of $${maxDailyDebit.toFixed(2)}.\n\n` +
        'NOTHING WAS CHARGED and no block was sold. The maximum daily debit is a contractual ' +
        'commitment on the Insertion Order, so the settlement halts rather than being clamped ' +
        'to it. A platform admin has to decide what happens next.',
      // Platform only. This is a halt for NetEnroll to resolve, and telling an
      // agency it was nearly overcharged before anyone has looked at why is not
      // information, it is alarm.
      toAgency: false,
      toPlatform: true,
      detail: { settlementId, deliveryDay, totalCharged, maxDailyDebit },
    },
    { prisma }
  );
}

async function notifySettlementFailure(
  prisma: PrismaClient,
  params: {
    tenantId: string;
    settlementId: string;
    deliveryDay: CalendarDayKey;
    amount: number;
    attemptNumber: number;
    failureMessage: string | null;
  }
): Promise<void> {
  const tenant = await prisma.tenant
    .findUnique({ where: { id: params.tenantId }, select: { name: true } })
    .catch(() => null);

  const graceEnd = businessDayPeriodEnd(
    params.deliveryDay,
    CONTRACT_PERIODS.SETTLEMENT_GRACE_BUSINESS_DAYS
  );

  await notify(
    {
      tenantId: params.tenantId,
      kind: BillingNotificationKind.SETTLEMENT_FAILED,
      // The settlement, not the attempt: one notice per failed settlement,
      // however many times it is retried.
      subjectKey: params.settlementId,
      subject: `Settlement failed for ${tenant?.name ?? params.tenantId} — ${params.deliveryDay}`,
      body:
        `The ACH debit of $${params.amount.toFixed(2)} for Delivery Day ${params.deliveryDay} ` +
        `was declined.\n\n${params.failureMessage ?? 'No reason was given.'}\n\n` +
        'Delivery is held at the applications already paid for. No new block was sold. ' +
        `Delivery stops entirely if this is still unpaid after ${graceEnd} ` +
        `(${CONTRACT_PERIODS.SETTLEMENT_GRACE_BUSINESS_DAYS} Business Days).`,
      toAgency: true,
      toPlatform: true,
      detail: {
        settlementId: params.settlementId,
        attemptNumber: params.attemptNumber,
        amount: params.amount,
        gracePeriodEndsOn: graceEnd,
      },
    },
    { prisma }
  );
}

export interface RunResult {
  deliveryDay: CalendarDayKey;
  results: SettlementResult[];
  failures: Array<{ tenantId: string; error: string }>;
}

/**
 * Settle every active agency for the Delivery Day that just closed.
 *
 * Sequential and individually guarded. One agency's settlement failing --
 * a declined debit, a missing profile, a database error -- collects a failure
 * and moves on. Their money is independent and so is their billing.
 *
 * Every active tenant is walked, and the ones not enrolled in billing return a
 * skip without a settlement row. Walking them and skipping, rather than
 * querying only the enrolled, is deliberate: the run's result then names every
 * agency and says what happened to it, which is what an operator watching a
 * staged rollout wants to see.
 */
export async function runDailySettlement(
  options: {
    deliveryDay?: CalendarDayKey;
    prisma?: PrismaClient;
    gateway?: PaymentGateway;
    now?: Date;
    tenantIds?: string[];
    /**
     * Settle every agency in this invocation without charging any of them.
     * Never the reverse.
     */
    settleWithoutCharge?: boolean;
  } = {}
): Promise<RunResult> {
  const prisma = options.prisma ?? getPrismaClient();
  const now = options.now ?? new Date();
  const deliveryDay = options.deliveryDay ?? lastClosedCalendarDay(now);

  const tenants = options.tenantIds
    ? options.tenantIds.map(id => ({ id }))
    : await prisma.tenant.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      });

  const results: SettlementResult[] = [];
  const failures: Array<{ tenantId: string; error: string }> = [];

  for (const tenant of tenants) {
    try {
      results.push(
        await settleAgencyForDeliveryDay({
          tenantId: tenant.id,
          deliveryDay,
          prisma,
          gateway: options.gateway,
          now,
          settleWithoutCharge: options.settleWithoutCharge,
        })
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ tenantId: tenant.id, error: message });
      logger.error({ msg: 'Settlement failed for one agency', tenantId: tenant.id, error });

      await notify(
        {
          tenantId: tenant.id,
          kind: BillingNotificationKind.SETTLEMENT_RUN_FAILED,
          subjectKey: deliveryDay,
          subject: `Settlement run failed for one agency — ${deliveryDay}`,
          body: `The settlement run for Delivery Day ${deliveryDay} raised: ${message}`,
          toAgency: false,
          toPlatform: true,
        },
        { prisma }
      ).catch(() => undefined);
    }
  }

  return { deliveryDay, results, failures };
}

/**
 * Retry the debits that failed, on Stripe's ACH timetable.
 *
 * One retry per settlement per calendar day, until the grace period ends. Each
 * retry is a genuinely new debit -- a later attempt number and therefore a
 * different idempotency key -- because the previous one was declined and a
 * declined ACH debit is not reattempted by Stripe on its own.
 *
 * A settlement whose grace period has expired is not retried: delivery has
 * already stopped and a human is dealing with it.
 */
export async function retryFailedSettlements(
  options: {
    prisma?: PrismaClient;
    gateway?: PaymentGateway;
    now?: Date;
    today?: CalendarDayKey;
  } = {}
): Promise<Array<{ settlementId: string; status: SettlementPaymentStatus }>> {
  const prisma = options.prisma ?? getPrismaClient();
  const gateway = options.gateway ?? paymentGateway();
  const now = options.now ?? new Date();
  const today = options.today ?? lastClosedCalendarDay(now);

  const failed = await prisma.dailySettlement.findMany({
    where: { paymentStatus: SettlementPaymentStatus.FAILED },
    include: { attempts: { orderBy: { attemptNumber: 'desc' }, take: 1 } },
    orderBy: { deliveryDay: 'asc' },
  });

  const outcomes: Array<{ settlementId: string; status: SettlementPaymentStatus }> = [];

  for (const settlement of failed) {
    const graceEnd =
      settlement.gracePeriodEndsOn ??
      businessDayPeriodEnd(settlement.deliveryDay, CONTRACT_PERIODS.SETTLEMENT_GRACE_BUSINESS_DAYS);

    if (today > graceEnd) continue;

    const lastAttempt = settlement.attempts[0];
    // One retry per calendar day. `occurredAt` is an instant; the comparison is
    // in the platform timezone, like every other day comparison here.
    if (lastAttempt) {
      const { calendarDayOf } = await import('../rating/calendar-day.js');
      if (calendarDayOf(lastAttempt.occurredAt) === calendarDayOf(now)) continue;
    }

    const terms = await loadAgencyTerms(settlement.tenantId, { prisma });
    const total = toNumber(settlement.totalCharged);

    const result = await chargeAndFinalise({
      prisma,
      gateway,
      settlementId: settlement.id,
      tenantId: settlement.tenantId,
      deliveryDay: settlement.deliveryDay,
      totalCharged: total,
      attemptNumber: (lastAttempt?.attemptNumber ?? 0) + 1,
      customerId: terms.stripeCustomerId,
      paymentMethodId: terms.settlementPaymentMethodId,
      paymentMethod: terms.paymentMethod,
      nextBlockQuantity: settlement.nextBlockQuantity,
      nextBlockRate: settlement.rate === null ? null : toNumber(settlement.rate),
      curveVersionId: settlement.curveVersionId,
      curveVersion: settlement.curveVersion,
      now,
      result: {
        tenantId: settlement.tenantId,
        deliveryDay: settlement.deliveryDay,
        settlementId: settlement.id,
        alreadySettled: false,
        paymentStatus: settlement.paymentStatus,
        deliveredCalls: settlement.deliveredCalls,
        submittedApplications: settlement.submittedApplications,
        rate: settlement.rate === null ? null : toNumber(settlement.rate),
        curveRate: settlement.curveRate === null ? null : toNumber(settlement.curveRate),
        rateOffset: toNumber(settlement.rateOffset),
        overrunQuantity: settlement.overrunQuantity,
        overrunAmount: toNumber(settlement.overrunAmount),
        nextBlockQuantity: settlement.nextBlockQuantity,
        nextBlockAmount: toNumber(settlement.nextBlockAmount),
        totalCharged: total,
        skippedReason: null,
      },
    });

    outcomes.push({
      settlementId: settlement.id,
      status: result.paymentStatus ?? SettlementPaymentStatus.FAILED,
    });
  }

  return outcomes;
}

/**
 * Charge settlements that were computed but never sent, because the process
 * died between writing the row and placing the debit.
 *
 * Deliberately NOT part of an ordinary run. An ordinary run that resumed a
 * PENDING row would reopen the race the unique insert closes: two runs starting
 * together would each see the other's fresh PENDING row and both charge. So
 * this only touches rows older than `staleAfterMinutes`, by which time no run
 * can still be in flight, and it charges with attempt number 1 -- the same
 * idempotency key the interrupted run would have used, so Stripe returns the
 * same payment intent rather than a second debit if it did get through.
 */
export async function resumeStalledSettlements(
  options: {
    prisma?: PrismaClient;
    gateway?: PaymentGateway;
    now?: Date;
    staleAfterMinutes?: number;
  } = {}
): Promise<Array<{ settlementId: string; status: SettlementPaymentStatus }>> {
  const prisma = options.prisma ?? getPrismaClient();
  const gateway = options.gateway ?? paymentGateway();
  const now = options.now ?? new Date();
  const staleAfter = options.staleAfterMinutes ?? 30;

  const cutoff = new Date(now.getTime() - staleAfter * 60_000);

  const stalled = await prisma.dailySettlement.findMany({
    where: {
      paymentStatus: SettlementPaymentStatus.PENDING,
      computedAt: { lt: cutoff },
      attempts: { none: {} },
    },
    orderBy: { deliveryDay: 'asc' },
  });

  const outcomes: Array<{ settlementId: string; status: SettlementPaymentStatus }> = [];

  for (const settlement of stalled) {
    const terms = await loadAgencyTerms(settlement.tenantId, { prisma });
    const total = toNumber(settlement.totalCharged);

    const result = await chargeAndFinalise({
      prisma,
      gateway,
      settlementId: settlement.id,
      tenantId: settlement.tenantId,
      deliveryDay: settlement.deliveryDay,
      totalCharged: total,
      attemptNumber: 1,
      customerId: terms.stripeCustomerId,
      paymentMethodId: terms.settlementPaymentMethodId,
      paymentMethod: terms.paymentMethod,
      nextBlockQuantity: settlement.nextBlockQuantity,
      nextBlockRate: settlement.rate === null ? null : toNumber(settlement.rate),
      curveVersionId: settlement.curveVersionId,
      curveVersion: settlement.curveVersion,
      now,
      result: {
        tenantId: settlement.tenantId,
        deliveryDay: settlement.deliveryDay,
        settlementId: settlement.id,
        alreadySettled: false,
        paymentStatus: settlement.paymentStatus,
        deliveredCalls: settlement.deliveredCalls,
        submittedApplications: settlement.submittedApplications,
        rate: settlement.rate === null ? null : toNumber(settlement.rate),
        curveRate: settlement.curveRate === null ? null : toNumber(settlement.curveRate),
        rateOffset: toNumber(settlement.rateOffset),
        overrunQuantity: settlement.overrunQuantity,
        overrunAmount: toNumber(settlement.overrunAmount),
        nextBlockQuantity: settlement.nextBlockQuantity,
        nextBlockAmount: toNumber(settlement.nextBlockAmount),
        totalCharged: total,
        skippedReason: null,
      },
    });

    outcomes.push({
      settlementId: settlement.id,
      status: result.paymentStatus ?? SettlementPaymentStatus.FAILED,
    });
  }

  return outcomes;
}
