/**
 * The delivery gate: may NetEnroll hand this agency's agents another call?
 *
 * ── One function, and every delivery path calls it ───────────────────────────
 *
 * The paths that deliver a call to an agent are enumerated in docs/BILLING.md
 * and each of them calls `evaluateDeliveryGate()` before routing. There is no
 * second copy of these conditions anywhere: a gate written twice is a gate that
 * disagrees with itself, and the half that says yes is the one that bills
 * somebody.
 *
 * ── Derived live, never a stored flag ────────────────────────────────────────
 *
 * Nothing here reads a "paused" boolean. Every condition is recomputed from the
 * rows that decide it -- the ledger, the settlements, the rating state, the
 * billing profile -- because a stored flag is stale the instant a settlement
 * fails or the last credit is spent, and the direction it goes stale in is the
 * one that keeps delivering calls to an agency that should have stopped.
 *
 * `delivery_hold_events` rows are written when the gate first refuses on a
 * Delivery Day. They are a record, not the decision: they exist so the portal
 * can say WHEN delivery stopped, and so platform admins are told once rather
 * than once per refused call.
 *
 * ── The conditions, in the order they are checked ────────────────────────────
 *
 * The order is severity, not convenience: an agency that is suspended AND at
 * its ceiling should be told it is suspended, because that is the thing a human
 * has to act on.
 *
 *   ADMIN_SUSPENDED        a platform admin suspended the account.
 *   NO_MANDATE             no valid ACH mandate. No mandate, no delivery.
 *   BELOW_MINIMUM_CLOSING  the trailing window fell below 5.0%. An agency
 *                          cannot resume itself; only a platform admin clears
 *                          the flag.
 *   SETTLEMENT_UNPAID      a settlement is unpaid past its grace period, which
 *                          is five BUSINESS Days -- weekdays excluding US
 *                          federal holidays -- and not five Delivery Days.
 *   NO_OPENING_AGREEMENT   no opening rate and block were ever agreed, so there
 *                          is no price and nothing has been bought.
 *   CEILING_REACHED        the balance is spent and the day's Overrun has
 *                          reached the ceiling.
 *
 * ── Paused is not terminated ─────────────────────────────────────────────────
 *
 * Nothing in this module writes to the ledger. Paid applications survive every
 * pause untouched and are available the moment the condition clears, because
 * the balance is the sum of rows nobody removed.
 *
 * ── A call already connected finishes normally ───────────────────────────────
 *
 * The gate is consulted when a call is about to be OFFERED to an agent. It is
 * not consulted again for a call that is already up, and no path in this
 * codebase tears down a live channel on a billing condition -- see the delivery
 * path survey in docs/BILLING.md.
 */

import type { PrismaClient } from '@prisma/client';
import {
  AgencyRatingStatus,
  DeliveryHoldReason,
  Prisma,
  SettlementPaymentStatus,
} from '@prisma/client';

import { logger } from '../../lib/logger.js';
import { getPrismaClient } from '../../lib/prisma.js';
import { businessDayPeriodEnd, CONTRACT_PERIODS } from '../rating/business-day.js';
import { calendarDayOf } from '../rating/calendar-day.js';
import type { CalendarDayKey } from '../rating/calendar-day.js';

import { creditBalance, ledgerCountsForDay } from './credit-ledger.js';
import { BillingNotificationKind, notify } from './notifications.js';
import { loadAgencyTerms } from './terms.js';
import type { AgencyTerms } from './terms.js';

export interface DeliveryGateDecision {
  tenantId: string;
  deliveryDay: CalendarDayKey;
  /** Whether another call may be offered to one of this agency's agents. */
  allowed: boolean;
  /** Why not. Null when `allowed`. */
  reason: DeliveryHoldReason | null;
  /** A sentence for the agency's portal. Null when `allowed`. */
  detail: string | null;

  /** Unused paid applications, summed from the ledger. */
  balance: number;
  /** The agency's configured Daily Block, in applications. */
  dailyBlockApplications: number;
  /** Applications submitted today that spent a credit. */
  consumedToday: number;
  /** Applications submitted today beyond the block. */
  overrunToday: number;
  /** How many overrun applications are permitted today. */
  overrunCeiling: number;
  /** Ceiling minus overrun used. Never negative. */
  overrunRemaining: number;
  /** The percentage above the block the ceiling was computed from. */
  ceilingPct: number;
  ceilingSource: AgencyTerms['ceilingSource'];
  consecutiveCleanSettlements: number;
  /** True when an unpaid settlement has withdrawn overrun for now. */
  overrunWithheldForUnpaidSettlement: boolean;
  hasValidMandate: boolean;
  /** The settlement holding delivery, if one is. */
  unpaidSettlement: {
    id: string;
    deliveryDay: string;
    totalCharged: number;
    paymentStatus: SettlementPaymentStatus;
    gracePeriodEndsOn: string | null;
    graceExpired: boolean;
  } | null;
}

export interface GateOptions {
  prisma?: PrismaClient;
  now?: Date;
  /**
   * Record a `delivery_hold_events` row and notify when the gate refuses.
   * On by default. The portal's read-only "where do I stand" view passes false,
   * because looking at a screen is not an event.
   */
  record?: boolean;
}

/**
 * A settlement that has not been paid, and how long it has had.
 *
 * The grace period is counted in BUSINESS Days -- Monday to Friday excluding US
 * federal holidays -- because that is what the signed agreement counts it in.
 * Reading it as calendar days would shorten it and stop delivery two days
 * early; reading it as Delivery Days would be a different length again for
 * every agency. `business-day.ts` is the only definition, and
 * `businessDayPeriodEnd` counts the first day as day one, which is the reading
 * the agreement uses.
 */
async function findUnpaidSettlement(
  prisma: PrismaClient,
  tenantId: string,
  today: CalendarDayKey
): Promise<DeliveryGateDecision['unpaidSettlement']> {
  const row = await prisma.dailySettlement.findFirst({
    where: {
      tenantId,
      paymentStatus: {
        in: [
          SettlementPaymentStatus.FAILED,
          SettlementPaymentStatus.HALTED_MAX_DEBIT,
          SettlementPaymentStatus.HALTED_NO_MANDATE,
        ],
      },
    },
    orderBy: { deliveryDay: 'asc' },
  });

  if (!row) return null;

  /*
   * `gracePeriodEndsOn` is written when the settlement first fails. Computing
   * it here as a fallback rather than treating a missing value as "no grace"
   * (which would stop delivery immediately) or as "unlimited grace" (which
   * would never stop it): the failure day plus five Business Days is the
   * contractual answer either way.
   */
  const graceEnd =
    row.gracePeriodEndsOn ??
    businessDayPeriodEnd(row.deliveryDay, CONTRACT_PERIODS.SETTLEMENT_GRACE_BUSINESS_DAYS);

  return {
    id: row.id,
    deliveryDay: row.deliveryDay,
    totalCharged: Number(row.totalCharged),
    paymentStatus: row.paymentStatus,
    gracePeriodEndsOn: graceEnd,
    graceExpired: today > graceEnd,
  };
}

/**
 * Decide whether another call may be delivered to this agency, and say why not.
 */
export async function evaluateDeliveryGate(
  tenantId: string,
  options: GateOptions = {}
): Promise<DeliveryGateDecision> {
  const prisma = options.prisma ?? getPrismaClient();
  const now = options.now ?? new Date();
  const today = calendarDayOf(now);
  const record = options.record !== false;

  const [terms, balance, counts, ratingState, openFlag, unpaid] = await Promise.all([
    loadAgencyTerms(tenantId, { prisma }),
    creditBalance(prisma, tenantId),
    ledgerCountsForDay(prisma, tenantId, today),
    prisma.agencyRatingState.findUnique({ where: { tenantId } }),
    prisma.ratingReviewFlag.findFirst({
      where: { tenantId, clearedAt: null },
      select: { id: true, closingPct: true },
    }),
    findUnpaidSettlement(prisma, tenantId, today),
  ]);

  /*
   * No overrun is extended to an agency with an unpaid settlement. Not reduced:
   * withdrawn. Delivery holds at the current PAID balance, which is what the
   * agency has already bought and which nothing takes away.
   */
  const overrunWithheld = unpaid !== null;
  const overrunCeiling = overrunWithheld ? 0 : terms.ceilingApplications;
  const overrunRemaining = Math.max(0, overrunCeiling - counts.overrun);

  const base = {
    tenantId,
    deliveryDay: today,
    balance,
    dailyBlockApplications: terms.dailyBlockApplications,
    consumedToday: counts.consumed,
    overrunToday: counts.overrun,
    overrunCeiling,
    overrunRemaining,
    ceilingPct: overrunWithheld ? 0 : terms.ceilingPct,
    ceilingSource: terms.ceilingSource,
    consecutiveCleanSettlements: terms.consecutiveCleanSettlements,
    overrunWithheldForUnpaidSettlement: overrunWithheld,
    hasValidMandate: terms.hasValidMandate,
    unpaidSettlement: unpaid,
  };

  const refuse = async (
    reason: DeliveryHoldReason,
    detail: string
  ): Promise<DeliveryGateDecision> => {
    if (record) await recordHold(prisma, tenantId, today, reason, detail, base);
    return { ...base, allowed: false, reason, detail };
  };

  if (terms.suspended) {
    return refuse(
      DeliveryHoldReason.ADMIN_SUSPENDED,
      terms.suspensionReason
        ? `Delivery is suspended by NetEnroll: ${terms.suspensionReason}`
        : 'Delivery is suspended by NetEnroll.'
    );
  }

  if (!terms.hasValidMandate) {
    return refuse(
      DeliveryHoldReason.NO_MANDATE,
      'There is no valid ACH mandate on this account. Delivery resumes when one is in place.'
    );
  }

  /*
   * Below the curve's minimum. Two sources, and both are checked: the rating
   * state's status is what the engine last wrote, and an open review flag is
   * what a platform admin has to clear. A recovered window does not un-flag an
   * agency -- "only a platform admin can clear it" would mean nothing if the
   * next day's numbers could do it instead -- so the flag is the stronger of
   * the two and delivery stays off while it is open.
   */
  if (openFlag || ratingState?.status === AgencyRatingStatus.UNDER_REVIEW) {
    return refuse(
      DeliveryHoldReason.BELOW_MINIMUM_CLOSING,
      'The trailing rating window closed below the minimum closing percentage. ' +
        'Delivery is paused until NetEnroll clears the review. Applications you have ' +
        'already paid for are untouched and available when it resumes.'
    );
  }

  if (unpaid && unpaid.graceExpired) {
    return refuse(
      DeliveryHoldReason.SETTLEMENT_UNPAID,
      `The settlement for ${unpaid.deliveryDay} is unpaid and its grace period ended on ` +
        `${unpaid.gracePeriodEndsOn}. Delivery has stopped. Applications you have already ` +
        'paid for are untouched.'
    );
  }

  /*
   * No opening agreement. An agency's opening rate and opening block are agreed
   * BEFORE its first Delivery Day and recorded per tenant; there is no
   * introductory rate to fall back on and no default price. An agency that
   * reaches here has never been priced, so there is nothing to bill and nothing
   * to deliver against.
   */
  const priced =
    ratingState != null &&
    (ratingState.currentRate != null || ratingState.openingRate != null) &&
    terms.profile !== null;

  if (!priced) {
    return refuse(
      DeliveryHoldReason.NO_OPENING_AGREEMENT,
      'No opening rate and opening block have been agreed for this agency yet.'
    );
  }

  /*
   * The balance is spent and the day's Overrun has reached the ceiling.
   *
   * Delivery does NOT stop when the balance alone hits zero: applications
   * beyond the Daily Block are recorded as Overrun and billed that evening. It
   * stops here, at the ceiling, for the rest of this Delivery Day.
   */
  if (balance <= 0 && overrunRemaining <= 0) {
    return refuse(
      DeliveryHoldReason.CEILING_REACHED,
      overrunWithheld
        ? 'Delivery is held at your paid balance while a settlement is unpaid. No overrun is ' +
            'extended with a settlement outstanding.'
        : `Today's overrun ceiling of ${overrunCeiling} applications above a Daily Block of ` +
            `${terms.dailyBlockApplications} has been reached. Delivery resumes on the next ` +
            'Delivery Day.'
    );
  }

  return { ...base, allowed: true, reason: null, detail: null };
}

/**
 * Record the first refusal of a Delivery Day, and tell the people who need to
 * know.
 *
 * The unique index on `(tenantId, deliveryDay, reason)` is the de-duplication:
 * the insert either wins -- in which case this is the first time today and the
 * notice goes out -- or loses, in which case nothing happens. That is why the
 * notification is inside the `catch`-free path after a successful insert rather
 * than guarded by a read.
 *
 * Never throws. A failure to record why delivery stopped must not become a
 * failure to stop it.
 */
async function recordHold(
  prisma: PrismaClient,
  tenantId: string,
  deliveryDay: CalendarDayKey,
  reason: DeliveryHoldReason,
  detail: string,
  facts: Omit<DeliveryGateDecision, 'allowed' | 'reason' | 'detail'>
): Promise<void> {
  try {
    await prisma.deliveryHoldEvent.create({
      data: {
        tenantId,
        deliveryDay,
        reason,
        detail: {
          message: detail,
          balance: facts.balance,
          overrunToday: facts.overrunToday,
          overrunCeiling: facts.overrunCeiling,
          dailyBlockApplications: facts.dailyBlockApplications,
        } as Prisma.InputJsonObject,
      },
    });
  } catch (error) {
    // Already recorded for this agency, day and reason. Nothing to send.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return;
    logger.error({ msg: 'Could not record delivery hold', error, tenantId, reason });
    return;
  }

  const kind =
    reason === DeliveryHoldReason.CEILING_REACHED
      ? BillingNotificationKind.CEILING_REACHED
      : reason === DeliveryHoldReason.NO_MANDATE
        ? BillingNotificationKind.MANDATE_MISSING
        : BillingNotificationKind.DELIVERY_PAUSED;

  const tenant = await prisma.tenant
    .findUnique({ where: { id: tenantId }, select: { name: true } })
    .catch(() => null);

  await notify(
    {
      tenantId,
      kind,
      subjectKey: `${deliveryDay}:${reason}`,
      subject: `Delivery stopped for ${tenant?.name ?? tenantId} — ${reason}`,
      body:
        `${detail}\n\n` +
        `Agency: ${tenant?.name ?? tenantId}\n` +
        `Delivery Day: ${deliveryDay} (America/New_York)\n` +
        `Paid applications remaining: ${facts.balance}\n` +
        `Overrun today: ${facts.overrunToday} of ${facts.overrunCeiling}\n`,
      toAgency: true,
      toPlatform: true,
      detail: {
        reason,
        balance: facts.balance,
        overrunToday: facts.overrunToday,
        overrunCeiling: facts.overrunCeiling,
      } as Prisma.InputJsonObject,
    },
    { prisma }
  );
}

/**
 * The gate, for a delivery path that must not fail closed on an infrastructure
 * error.
 *
 * Every caller on a live call path uses this. The distinction matters: if the
 * database is unreachable we cannot tell whether this agency has credit, and
 * the two ways to be wrong are not symmetric. Refusing a call that was paid for
 * loses the agency a sale it had bought; delivering one it had not is a charge
 * we cannot substantiate. Both are bad, and the second is the one that ends up
 * on a bank statement, so an unreadable gate refuses.
 */
export async function isDeliveryAllowed(
  tenantId: string,
  options: GateOptions = {}
): Promise<{ allowed: boolean; reason: DeliveryHoldReason | null; detail: string | null }> {
  try {
    const decision = await evaluateDeliveryGate(tenantId, options);
    return { allowed: decision.allowed, reason: decision.reason, detail: decision.detail };
  } catch (error) {
    logger.error({
      msg: 'Delivery gate could not be evaluated; refusing delivery',
      error,
      tenantId,
    });
    return {
      allowed: false,
      reason: null,
      detail: 'Delivery eligibility could not be determined.',
    };
  }
}
