/**
 * Buying application credits outside the nightly settlement.
 *
 * Two callers, one charge-and-record path:
 *
 *   PLATFORM_OPENING    a platform admin selling an agency its opening block
 *                       (`POST /api/v1/platform/delivery/agencies/:id/opening-purchase`).
 *                       Quantity and rate are what was commercially agreed.
 *   AGENCY_SELF_SERVE   an agency OWNER/ADMIN buying credits for itself
 *                       (`POST /api/v1/delivery/credits/purchase`). The quantity
 *                       is theirs; the rate is ALWAYS the agency's current rate,
 *                       computed here from the rating state. Nothing about the
 *                       price is read from the request.
 *
 * ── What the agency can and cannot do ────────────────────────────────────────
 *
 * Self-serve is refused -- with a code the web app renders as the reason --
 * for an agency that is not enrolled, is invoiced outside the platform
 * (OFFLINE / MELIO: nothing here can debit it), has a disputed payment, is
 * suspended, is still in its dry run (charging not enabled), has no usable
 * payment instrument, or has no rate in force. And it is capped: the self-serve
 * purchases of one Delivery Day may not together exceed the agency's maximum
 * daily debit, which is the contractual ceiling on a single day's debit.
 *
 * ── Idempotency ──────────────────────────────────────────────────────────────
 *
 * The browser sends a key per purchase. It is used twice:
 *
 *   1. As (part of) Stripe's idempotency key, so a retried request cannot
 *      place a second debit even if it reaches Stripe.
 *   2. On the ledger row, under a unique (tenantId, idempotencyKey) index, and
 *      looked up first -- so a replay returns the purchase it already made and
 *      never reaches the gateway at all.
 *
 * The whole self-serve purchase runs under a per-tenant advisory lock, so two
 * concurrent purchases for one agency are serialised: a double click cannot
 * charge twice, and two different purchases cannot both squeeze under the
 * daily cap.
 */

import {
  AgencyPaymentMethod,
  CreditLedgerEntryType,
  Prisma,
  type PrismaClient,
} from '@prisma/client';

import { getPrismaClient } from '../../lib/prisma.js';
import { auditLog } from '../audit.js';
import { currentCalendarDay, type CalendarDayKey } from '../rating/calendar-day.js';
import { toNumber } from '../rating/rate-curve.js';
import { getRatingSummary } from '../rating/rating-summary.js';

import type { AchChargeResult, PaymentGateway } from './ach.js';
import { creditBalance, recordPurchase } from './credit-ledger.js';
import { hasOpenDispute } from './disputes.js';
import { gatewayForProvider, providerChargesInPlatform } from './payment-gateways.js';
import { loadAgencyTerms, type AgencyTerms } from './terms.js';

export type CreditPurchaseSource = 'AGENCY_SELF_SERVE' | 'PLATFORM_OPENING';

/** The most credits one self-serve purchase may buy. */
export const SELF_SERVE_MAX_QUANTITY = 1000;

export interface PurchaseCreditsInput {
  tenantId: string;
  quantity: number;
  /** Dollars per application. For self-serve, the server-derived current rate. */
  unitRate: number;
  /**
   * PLATFORM_OPENING: Stripe's idempotency key, as the route derives it.
   * AGENCY_SELF_SERVE: the browser's key. It is namespaced for Stripe and
   * stored on the ledger row.
   */
  idempotencyKey: string;
  actor: { userId: string | null };
  source: CreditPurchaseSource;
  /** The Delivery Day the credits are for. Today unless stated. */
  deliveryDay?: CalendarDayKey;
  /** PLATFORM_OPENING only: the admin's choice of instrument. */
  method?: 'ACH' | 'CARD';
  /** PLATFORM_OPENING only: an explicit Stripe payment method. */
  paymentMethodId?: string;
  /** PLATFORM_OPENING only, and required for an agency billed off-platform. */
  externalPaymentReference?: string;
}

export interface PurchaseRecord {
  ledgerEntryId: string;
  quantity: number;
  unitRate: number;
  amount: number;
  deliveryDay: CalendarDayKey;
  /** Whether money moved through this platform for it. */
  charged: boolean;
  method: 'ACH' | 'CARD' | 'OFFLINE';
  paymentIntentId: string | null;
  externalPaymentReference: string | null;
  createdAt: Date;
}

export type PurchaseCreditsResult =
  | { ok: true; replayed: boolean; purchase: PurchaseRecord; balance: number }
  | { ok: false; httpStatus: 400 | 402 | 409; code: string; message: string };

interface Deps {
  prisma?: PrismaClient;
  /** Tests install a fake here; production resolves it from the provider. */
  gateway?: PaymentGateway;
  now?: Date;
}

function amountOf(quantity: number, unitRate: number): number {
  return Number((quantity * unitRate).toFixed(2));
}

// ─────────────────────────────────────────────────────────────────────────────
// What an agency may buy right now
// ─────────────────────────────────────────────────────────────────────────────

export interface SelfServeState {
  terms: AgencyTerms;
  balance: number;
  /** The rate in force: the same figure the Delivery page calls the current rate. */
  currentRate: number | null;
  /** Dollars of self-serve purchases already made for today's Delivery Day. */
  selfServeSpentToday: number;
  /** The most one purchase may buy right now. Zero when blocked. */
  maxPurchaseQuantity: number;
  blocked: { code: string; message: string } | null;
}

/** Dollars of self-serve purchases already made for one Delivery Day. */
async function selfServeSpentOn(
  prisma: Pick<PrismaClient, 'applicationCreditLedgerEntry'>,
  tenantId: string,
  deliveryDay: CalendarDayKey
): Promise<number> {
  const sum = await prisma.applicationCreditLedgerEntry.aggregate({
    where: {
      tenantId,
      deliveryDay,
      entryType: CreditLedgerEntryType.PURCHASE,
      // Only self-serve purchases carry a key.
      idempotencyKey: { not: null },
    },
    _sum: { amount: true },
  });
  return sum._sum.amount == null ? 0 : toNumber(sum._sum.amount);
}

export async function loadSelfServeState(
  tenantId: string,
  deps: Deps = {}
): Promise<SelfServeState> {
  const prisma = deps.prisma ?? getPrismaClient();
  const now = deps.now ?? new Date();
  const today = currentCalendarDay(now);

  const [terms, balance, rating, disputed, spent] = await Promise.all([
    loadAgencyTerms(tenantId, { prisma }),
    creditBalance(prisma, tenantId),
    getRatingSummary(tenantId, { prisma, now }),
    hasOpenDispute(prisma, tenantId),
    selfServeSpentOn(prisma, tenantId, today),
  ]);

  const currentRate = rating.currentRate;
  const remainingDebit = Math.max(0, terms.maxDailyDebit - spent);
  const affordable =
    currentRate !== null && currentRate > 0 ? Math.floor(remainingDebit / currentRate) : 0;
  const cap = Math.min(SELF_SERVE_MAX_QUANTITY, affordable);

  const blocked = ((): SelfServeState['blocked'] => {
    if (!terms.enrolled) {
      return {
        code: 'NOT_ENROLLED',
        message:
          'This account is not enrolled in NetEnroll billing, so there are no credits to buy.',
      };
    }
    if (!terms.chargesInPlatform) {
      return {
        code: 'INVOICED_AGENCY',
        message:
          'Your account is invoiced by NetEnroll, so credits cannot be bought here. ' +
          'Contact NetEnroll to add credits.',
      };
    }
    if (disputed) {
      return {
        code: 'PAYMENT_DISPUTED',
        message:
          'A payment on this account is disputed. Credits cannot be bought until NetEnroll ' +
          'has reviewed it.',
      };
    }
    if (terms.suspended) {
      return {
        code: 'ACCOUNT_SUSPENDED',
        message: 'This account is suspended by NetEnroll. Contact NetEnroll to add credits.',
      };
    }
    if (!terms.chargesEnabled) {
      return {
        code: 'CHARGES_NOT_ENABLED',
        message:
          'Billing for this account is still in its trial run, so no payment can be taken yet. ' +
          'Contact NetEnroll to add credits.',
      };
    }
    if (!terms.hasValidMandate || !terms.stripeCustomerId || !terms.settlementPaymentMethodId) {
      return {
        code: 'NO_PAYMENT_METHOD',
        message:
          terms.paymentMethod === AgencyPaymentMethod.CARD
            ? 'There is no usable card on file. Add one before buying credits.'
            : 'There is no verified bank account (ACH mandate) on file. Add one before buying credits.',
      };
    }
    if (currentRate === null || currentRate <= 0) {
      return {
        code: 'NO_RATE',
        message:
          'There is no rate in force for this account right now, so credits cannot be priced. ' +
          'Contact NetEnroll.',
      };
    }
    if (cap < 1) {
      return {
        code: 'DAILY_LIMIT_REACHED',
        message:
          `Today's purchases have reached this account's maximum daily debit of ` +
          `$${terms.maxDailyDebit.toFixed(2)}. More credits can be bought tomorrow.`,
      };
    }
    return null;
  })();

  return {
    terms,
    balance,
    currentRate,
    selfServeSpentToday: spent,
    maxPurchaseQuantity: blocked ? 0 : cap,
    blocked,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Charge and record
// ─────────────────────────────────────────────────────────────────────────────

function recordFromRow(
  row: {
    id: string;
    quantity: number;
    unitRate: Prisma.Decimal | null;
    amount: Prisma.Decimal | null;
    deliveryDay: string;
    stripePaymentIntentId: string | null;
    externalPaymentReference: string | null;
    createdAt: Date;
  },
  method: PurchaseRecord['method']
): PurchaseRecord {
  return {
    ledgerEntryId: row.id,
    quantity: row.quantity,
    unitRate: row.unitRate == null ? 0 : toNumber(row.unitRate),
    amount: row.amount == null ? 0 : toNumber(row.amount),
    deliveryDay: row.deliveryDay,
    charged: row.stripePaymentIntentId !== null,
    method,
    paymentIntentId: row.stripePaymentIntentId,
    externalPaymentReference: row.externalPaymentReference,
    createdAt: row.createdAt,
  };
}

/**
 * Charge the agency's instrument and write the purchase.
 *
 * Returns a refusal rather than throwing for every expected failure, with the
 * HTTP status and code the route answers with.
 */
export async function purchaseCredits(
  input: PurchaseCreditsInput,
  deps: Deps = {}
): Promise<PurchaseCreditsResult> {
  return input.source === 'PLATFORM_OPENING'
    ? purchaseOpening(input, deps)
    : purchaseSelfServe(input, deps);
}

/**
 * The platform admin's opening purchase. Behaviour is exactly that of the
 * route before this was extracted: an off-platform agency is recorded against
 * the reference it paid under, and everything else is charged -- ACH
 * off-session, or card on-session when the admin says CARD.
 */
async function purchaseOpening(
  input: PurchaseCreditsInput,
  deps: Deps
): Promise<PurchaseCreditsResult> {
  const prisma = deps.prisma ?? getPrismaClient();
  const { tenantId, quantity, unitRate } = input;
  const amount = amountOf(quantity, unitRate);
  const deliveryDay = input.deliveryDay ?? currentCalendarDay(deps.now);
  const externalReference = input.externalPaymentReference?.trim() ?? '';

  const profile = await prisma.agencyBillingProfile.findUnique({ where: { tenantId } });
  if (!profile) {
    return {
      ok: false,
      httpStatus: 409,
      code: 'NO_BILLING_PROFILE',
      message: 'Record the agency terms before selling it an opening block',
    };
  }

  if (!providerChargesInPlatform(profile.paymentProvider)) {
    if (!externalReference) {
      return {
        ok: false,
        httpStatus: 400,
        code: 'EXTERNAL_REFERENCE_REQUIRED',
        message:
          "This agency's payment provider is OFFLINE, so no debit can be placed. " +
          'Send externalPaymentReference naming where the money was collected ' +
          '(a check number, a wire reference, an invoice id).',
      };
    }

    const entry = await recordPurchase(prisma, {
      tenantId,
      deliveryDay,
      quantity,
      unitRate,
      stripePaymentIntentId: null,
      externalPaymentReference: externalReference,
      settlementId: null,
    });

    await auditLog({
      tenantId,
      userId: input.actor.userId ?? undefined,
      action: 'platform.delivery.opening_purchase.external',
      entityType: 'application_credit_ledger',
      entityId: entry.id,
      changes: {
        quantity,
        unitRate,
        amount,
        method: 'OFFLINE',
        externalPaymentReference: externalReference,
      },
    });

    return {
      ok: true,
      replayed: false,
      balance: await creditBalance(prisma, tenantId),
      purchase: {
        ledgerEntryId: entry.id,
        quantity,
        unitRate,
        amount,
        deliveryDay,
        charged: false,
        method: 'OFFLINE',
        paymentIntentId: null,
        externalPaymentReference: externalReference,
        createdAt: new Date(),
      },
    };
  }

  if (externalReference) {
    return {
      ok: false,
      httpStatus: 400,
      code: 'EXTERNAL_REFERENCE_NOT_APPLICABLE',
      message:
        'externalPaymentReference applies only to an agency whose payment provider is ' +
        'OFFLINE. This agency is charged through the platform, and this request would ' +
        'have placed a real debit.',
    };
  }

  const gateway = deps.gateway ?? gatewayForProvider(profile.paymentProvider);
  const paymentMethodId = input.paymentMethodId ?? profile.achPaymentMethodId;

  if (!profile.stripeCustomerId || !paymentMethodId) {
    return {
      ok: false,
      httpStatus: 409,
      code: 'NO_PAYMENT_METHOD',
      message: 'This agency has no Stripe customer or payment method recorded',
    };
  }

  const request = {
    customerId: profile.stripeCustomerId,
    paymentMethodId,
    amountCents: Math.round(amount * 100),
    description: `NetEnroll opening block ${deliveryDay}`,
    idempotencyKey: input.idempotencyKey,
    metadata: { tenantId, deliveryDay, kind: 'opening_purchase' },
  };
  const charge =
    input.method === 'CARD'
      ? await gateway.chargeCardOnSession(request)
      : await gateway.chargeAchOffSession(request);

  if (!charge.ok) {
    return {
      ok: false,
      httpStatus: 402,
      code: 'PAYMENT_FAILED',
      message: charge.failureMessage ?? 'The opening purchase was declined',
    };
  }

  const entry = await recordPurchase(prisma, {
    tenantId,
    deliveryDay,
    quantity,
    unitRate,
    stripePaymentIntentId: charge.paymentIntentId,
    // No settlement sold this: it is the opening purchase, agreed before the
    // agency's first Delivery Day.
    settlementId: null,
  });

  await auditLog({
    tenantId,
    userId: input.actor.userId ?? undefined,
    action: 'platform.delivery.opening_purchase',
    entityType: 'application_credit_ledger',
    entityId: entry.id,
    changes: { quantity, unitRate, amount, method: input.method ?? 'ACH' },
  });

  return {
    ok: true,
    replayed: false,
    balance: await creditBalance(prisma, tenantId),
    purchase: {
      ledgerEntryId: entry.id,
      quantity,
      unitRate,
      amount,
      deliveryDay,
      charged: true,
      method: input.method ?? 'ACH',
      paymentIntentId: charge.paymentIntentId,
      externalPaymentReference: null,
      createdAt: new Date(),
    },
  };
}

const KEY_REUSED: PurchaseCreditsResult & { ok: false } = {
  ok: false,
  httpStatus: 409,
  code: 'IDEMPOTENCY_KEY_REUSED',
  message: 'This purchase key was already used for a different quantity. Start a new purchase.',
};

/** The purchase an idempotency key already made, if it made one. */
async function findReplay(
  prisma: PrismaClient,
  tenantId: string,
  idempotencyKey: string,
  quantity: number,
  method: PurchaseRecord['method']
): Promise<PurchaseCreditsResult | null> {
  const existing = await prisma.applicationCreditLedgerEntry.findUnique({
    where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } },
  });
  if (!existing) return null;
  if (existing.quantity !== quantity) return KEY_REUSED;
  return {
    ok: true,
    replayed: true,
    purchase: recordFromRow(existing, method),
    balance: await creditBalance(prisma, tenantId),
  };
}

/**
 * An agency buying credits for itself, at its current rate, on the instrument
 * its settlement debits.
 */
async function purchaseSelfServe(
  input: PurchaseCreditsInput,
  deps: Deps
): Promise<PurchaseCreditsResult> {
  const prisma = deps.prisma ?? getPrismaClient();
  const { tenantId, quantity, unitRate, idempotencyKey } = input;
  const deliveryDay = input.deliveryDay ?? currentCalendarDay(deps.now);
  const amount = amountOf(quantity, unitRate);

  if (!Number.isInteger(quantity) || quantity < 1 || quantity > SELF_SERVE_MAX_QUANTITY) {
    return {
      ok: false,
      httpStatus: 400,
      code: 'VALIDATION_ERROR',
      message: `quantity must be a whole number from 1 to ${SELF_SERVE_MAX_QUANTITY}`,
    };
  }

  const terms = await loadAgencyTerms(tenantId, { prisma });
  const method: 'ACH' | 'CARD' = terms.paymentMethod === AgencyPaymentMethod.CARD ? 'CARD' : 'ACH';

  /*
   * A replay first, outside the lock and before any refusal: a purchase that
   * already happened is answered with itself, even if -- because of it -- the
   * agency could not make it again now (the daily cap, say).
   */
  const replay = await findReplay(prisma, tenantId, idempotencyKey, quantity, method);
  if (replay) return replay;

  if (!Number.isFinite(unitRate) || unitRate <= 0) {
    return {
      ok: false,
      httpStatus: 409,
      code: 'NO_RATE',
      message: 'There is no rate in force for this account right now, so credits cannot be priced.',
    };
  }

  if (!terms.chargesInPlatform) {
    // Defence in depth: the route refuses this before it gets here.
    return {
      ok: false,
      httpStatus: 409,
      code: 'INVOICED_AGENCY',
      message:
        'Your account is invoiced by NetEnroll, so credits cannot be bought here. ' +
        'Contact NetEnroll to add credits.',
    };
  }
  if (!terms.stripeCustomerId || !terms.settlementPaymentMethodId || !terms.hasValidMandate) {
    return {
      ok: false,
      httpStatus: 409,
      code: 'NO_PAYMENT_METHOD',
      message: 'There is no usable payment method on file for this account.',
    };
  }

  const gateway = deps.gateway ?? gatewayForProvider(terms.paymentProvider);
  const customerId = terms.stripeCustomerId;
  const paymentMethodId = terms.settlementPaymentMethodId;

  type Outcome =
    | { kind: 'replayed'; row: Parameters<typeof recordFromRow>[0] }
    | { kind: 'refused'; result: PurchaseCreditsResult & { ok: false } }
    | { kind: 'recorded'; row: Parameters<typeof recordFromRow>[0]; charge: AchChargeResult };

  const outcome = await prisma.$transaction(
    async (tx): Promise<Outcome> => {
      // One self-serve purchase at a time per agency.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`credit-purchase:${tenantId}`}))`;

      const existing = await tx.applicationCreditLedgerEntry.findUnique({
        where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } },
      });
      if (existing) {
        return existing.quantity === quantity
          ? { kind: 'replayed', row: existing }
          : { kind: 'refused', result: KEY_REUSED };
      }

      // The daily cap, re-checked under the lock so two purchases cannot both
      // fit under it on a stale reading.
      const spent = await selfServeSpentOn(tx, tenantId, deliveryDay);
      if (spent + amount > terms.maxDailyDebit + 0.000001) {
        return {
          kind: 'refused',
          result: {
            ok: false,
            httpStatus: 409,
            code: 'EXCEEDS_DAILY_LIMIT',
            message:
              `$${amount.toFixed(2)} would take today's purchases past this account's maximum ` +
              `daily debit of $${terms.maxDailyDebit.toFixed(2)}` +
              (spent > 0 ? ` ($${spent.toFixed(2)} already bought today)` : '') +
              '. Buy fewer credits.',
          },
        };
      }

      const request = {
        customerId,
        paymentMethodId,
        amountCents: Math.round(amount * 100),
        description: `NetEnroll application credits ${deliveryDay}`,
        idempotencyKey: `self-serve:${tenantId}:${idempotencyKey}`,
        metadata: { tenantId, deliveryDay, kind: 'self_serve_purchase' },
      };
      // Off-session for both instruments: the agency authorised this
      // instrument for unattended debits when it saved it, which is what the
      // nightly settlement relies on too.
      const charge =
        method === 'CARD'
          ? await gateway.chargeCardOffSession(request)
          : await gateway.chargeAchOffSession(request);

      if (!charge.ok) {
        return {
          kind: 'refused',
          result: {
            ok: false,
            httpStatus: 402,
            code: 'PAYMENT_FAILED',
            message: charge.failureMessage ?? 'The payment was declined.',
          },
        };
      }

      const { id } = await recordPurchase(tx as unknown as PrismaClient, {
        tenantId,
        deliveryDay,
        quantity,
        unitRate,
        stripePaymentIntentId: charge.paymentIntentId,
        settlementId: null,
        idempotencyKey,
      });
      const row = await tx.applicationCreditLedgerEntry.findUniqueOrThrow({ where: { id } });
      return { kind: 'recorded', row, charge };
    },
    // The charge happens inside the lock, so allow for a slow gateway.
    { timeout: 60_000, maxWait: 15_000 }
  );

  if (outcome.kind === 'refused') return outcome.result;

  const purchase = recordFromRow(outcome.row, method);

  if (outcome.kind === 'recorded') {
    await auditLog({
      tenantId,
      userId: input.actor.userId ?? undefined,
      action: 'delivery.credits.purchase',
      entityType: 'application_credit_ledger',
      entityId: purchase.ledgerEntryId,
      changes: {
        quantity,
        unitRate,
        amount,
        method,
        paymentIntentId: purchase.paymentIntentId,
        idempotencyKey,
      },
    });
  }

  return {
    ok: true,
    replayed: outcome.kind === 'replayed',
    purchase,
    balance: await creditBalance(prisma, tenantId),
  };
}
