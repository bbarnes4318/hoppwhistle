/**
 * The application credit ledger.
 *
 * ── One table, append-only, and the balance is never stored ──────────────────
 *
 *     balance = SUM(quantity) WHERE tenantId = $1
 *
 * There is no counter column, here or anywhere else. A counter is wrong the
 * first time a write is retried or a job is re-run, and this number decides
 * whether a call is delivered and whether an application is billed tonight.
 * `application_credit_ledger` also carries a database trigger that refuses
 * every UPDATE and DELETE, so "append-only" is a property of the database
 * rather than a convention in this file. A correction is a later row.
 *
 * ── Three kinds of row ───────────────────────────────────────────────────────
 *
 *   PURCHASE     a block of credits bought for one Delivery Day at one rate,
 *                carrying the Stripe payment reference and the rate curve
 *                version that priced it. `quantity` is positive.
 *   CONSUMPTION  one application that reached submitted state and spent one
 *                credit. `quantity` is -1. The row names the application AND
 *                the exact unit of the exact purchase lot the credit came from.
 *   OVERRUN      one application that reached submitted state with no credit
 *                left. `quantity` is 0 -- an overrun does not move a balance,
 *                because there was no balance to move. It is billed that
 *                evening at the rate the settlement derives.
 *
 * There is no REFUND, CREDIT, REVERSAL, REBATE or MAKE-GOOD row type, and no
 * function below returns a credit. A carrier's decision after an application is
 * submitted -- issued, declined, rescinded, lapsed -- is not an input to
 * anything here. The absence of the enum member is what makes that true.
 *
 * Credits never expire. Nothing scans for old lots, and no purchase carries an
 * expiry column.
 *
 * ── Why two applications cannot spend the same credit ────────────────────────
 *
 * A consumption claims a specific unit of a specific lot: the unique index on
 * `(purchaseEntryId, lotIndex)` is what serialises the claim. Two applications
 * reaching submitted state at the same instant both compute the same next free
 * index; Postgres admits one insert and rejects the other, and the loser
 * retries onto the next unit. That is a constraint, not a check-then-act, and
 * `settlement.test.ts` drives it with real concurrent writers.
 *
 * The unique index on `applicationId` -- across the whole table, not per type --
 * is the other half: an application that reaches submitted state twice has one
 * row, either the credit it spent or the overrun it was recorded as, never both
 * and never two.
 *
 * ── Oldest lot first ─────────────────────────────────────────────────────────
 *
 * Where credits span purchases at different rates, the oldest lot is consumed
 * first: ordered by the Delivery Day the block was bought for, then by when the
 * row was written. The rate the credit was bought at is copied onto the
 * consumption, so the row values itself without a join and still reads
 * correctly after a new curve version is published.
 */

import { CreditLedgerEntryType, Prisma, PrismaClient } from '@prisma/client';

import { getPrismaClient } from '../../lib/prisma.js';
import { calendarDayOf } from '../rating/calendar-day.js';
import type { CalendarDayKey } from '../rating/calendar-day.js';
import { toNumber } from '../rating/rate-curve.js';

/**
 * Anything that can run the queries below: the client, or a transaction handle.
 * Typed off `PrismaClient` so a renamed column is a compile error here.
 */
export type LedgerClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/** Postgres' unique-violation, as Prisma reports it. */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * The agency's balance: unused paid applications.
 *
 * Summed from the ledger every time it is asked for. It is deliberately not
 * memoised anywhere -- the one place a stale balance would show up is the
 * decision to deliver a call, and a call delivered against a balance that no
 * longer exists is an application nobody agreed to pay for.
 */
export async function creditBalance(
  prisma: LedgerClient,
  tenantId: string
): Promise<number> {
  const result = await prisma.applicationCreditLedgerEntry.aggregate({
    where: { tenantId },
    _sum: { quantity: true },
  });
  return result._sum.quantity ?? 0;
}

/** How many applications of a Delivery Day's block went unused, per lot. */
export interface OpenLot {
  id: string;
  quantity: number;
  used: number;
  remaining: number;
  unitRate: number | null;
  deliveryDay: CalendarDayKey;
}

/**
 * Purchase lots with credits still on them, oldest first.
 *
 * The `used` count is a subquery rather than a stored column, for the same
 * reason the balance is: a lot's remaining credits are the rows that reference
 * it, and nothing else can be true.
 */
export async function openLots(
  prisma: LedgerClient,
  tenantId: string
): Promise<OpenLot[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      quantity: number;
      used: bigint;
      retired: boolean;
      unitRate: Prisma.Decimal | null;
      deliveryDay: string;
    }>
  >`
    SELECT p."id",
           p."quantity",
           p."unitRate",
           p."deliveryDay",
           -- CONSUMPTION only. A DRY_RUN_CLOSEOUT row also references the lot,
           -- and counting it as a used unit would silently shrink the lot by
           -- one instead of retiring it.
           (SELECT COUNT(*) FROM "application_credit_ledger" c
             WHERE c."purchaseEntryId" = p."id"
               AND c."entryType" = 'CONSUMPTION'::"CreditLedgerEntryType") AS "used",
           EXISTS (SELECT 1 FROM "application_credit_ledger" x
                    WHERE x."purchaseEntryId" = p."id"
                      AND x."entryType" = 'DRY_RUN_CLOSEOUT'::"CreditLedgerEntryType") AS "retired"
      FROM "application_credit_ledger" p
     WHERE p."tenantId" = ${tenantId}
       AND p."entryType" = 'PURCHASE'::"CreditLedgerEntryType"
     ORDER BY p."deliveryDay" ASC, p."createdAt" ASC, p."id" ASC
  `;

  return rows
    .map(row => ({
      id: row.id,
      quantity: row.quantity,
      used: Number(row.used),
      remaining: row.quantity - Number(row.used),
      unitRate: row.unitRate === null ? null : toNumber(row.unitRate),
      deliveryDay: row.deliveryDay,
    }))
    // A retired lot has nothing left to spend whatever its arithmetic says: its
    // credits were issued for a dry run and never paid for.
    .filter((lot, index) => lot.remaining > 0 && !rows[index].retired);
}

export interface PurchaseInput {
  tenantId: string;
  /** The Delivery Day this block is for. */
  deliveryDay: CalendarDayKey;
  quantity: number;
  /** Dollars per application. */
  unitRate: number;
  /** The Stripe payment the block was bought with. */
  stripePaymentIntentId: string | null;
  /** The settlement that sold it. Null for an agency's opening purchase. */
  settlementId?: string | null;
  curveVersionId?: string | null;
  curveVersion?: number | null;
}

/**
 * Write one purchase.
 *
 * `amount` is stored as well as `quantity * unitRate` being derivable from
 * them, because an agency disputing a charge is answered from the row and a row
 * that needs arithmetic performed on it to say what it cost is a row somebody
 * can perform the arithmetic differently on.
 */
export async function recordPurchase(
  prisma: LedgerClient,
  input: PurchaseInput
): Promise<{ id: string }> {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new Error(`A purchase must be a positive whole number of applications, got ${input.quantity}`);
  }
  if (!Number.isFinite(input.unitRate) || input.unitRate <= 0) {
    throw new Error(`A purchase must have a positive unit rate, got ${input.unitRate}`);
  }

  const row = await prisma.applicationCreditLedgerEntry.create({
    data: {
      tenantId: input.tenantId,
      entryType: CreditLedgerEntryType.PURCHASE,
      quantity: input.quantity,
      deliveryDay: input.deliveryDay,
      unitRate: new Prisma.Decimal(input.unitRate.toFixed(2)),
      amount: new Prisma.Decimal((input.quantity * input.unitRate).toFixed(2)),
      curveVersionId: input.curveVersionId ?? null,
      curveVersion: input.curveVersion ?? null,
      stripePaymentIntentId: input.stripePaymentIntentId,
      settlementId: input.settlementId ?? null,
    },
    select: { id: true },
  });

  return row;
}

export type ConsumeOutcome =
  /** A credit was spent. */
  | 'CONSUMED'
  /** No credit was available; the application was recorded as overrun. */
  | 'OVERRUN'
  /**
   * This application already had a ledger row. It reached submitted state
   * before -- a retried automation run, a replayed completion, a reconciliation
   * pass -- and it costs exactly what it cost the first time.
   */
  | 'ALREADY_RECORDED';

export interface ConsumeResult {
  outcome: ConsumeOutcome;
  entryId: string;
  entryType: CreditLedgerEntryType;
  /** The rate the credit was bought at. Null for an overrun, which is priced tonight. */
  unitRate: number | null;
}

/**
 * How many times to re-read the lots when another writer took the unit we were
 * aiming at.
 *
 * Each retry means a genuine simultaneous submission. Forty-five agents cannot
 * produce forty-five in the same microsecond, and a bound that is reached is
 * better than a loop that is not: it surfaces as a failed consumption that the
 * settlement's reconciliation pass will pick up, rather than as a request that
 * never returns.
 */
const MAX_CLAIM_ATTEMPTS = 64;

/**
 * Spend one credit for one application, or record it as overrun.
 *
 * Called when an application reaches submitted state, and again by the
 * settlement's reconciliation pass for anything the first call missed. Both are
 * safe because the row is keyed on the application: the second call returns
 * ALREADY_RECORDED and writes nothing.
 *
 * Deliberately NOT run inside the caller's transaction. The application is
 * already SUBMITTED by the time this runs, and the credit is owed from that
 * fact; wrapping the two together would mean a ledger failure could roll back a
 * submission the carrier has already accepted.
 */
export async function consumeCreditForApplication(params: {
  prisma?: LedgerClient;
  tenantId: string;
  applicationId: string;
  /** The Delivery Day the application was submitted on. */
  deliveryDay?: CalendarDayKey;
  now?: Date;
}): Promise<ConsumeResult> {
  const prisma = params.prisma ?? getPrismaClient();
  const now = params.now ?? new Date();
  const deliveryDay = params.deliveryDay ?? calendarDayOf(now);

  const existing = await findEntryForApplication(prisma, params.applicationId);
  if (existing) return existing;

  for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt++) {
    const lots = await openLots(prisma, params.tenantId);

    if (lots.length === 0) {
      /*
       * Nothing left to spend. The application is recorded as Overrun and
       * delivery does NOT stop because of it -- the ceiling decides that, and
       * it is checked on the delivery path, not here. An application that has
       * already been submitted is owed whether or not the ceiling has since
       * been reached; refusing to record it would be losing money we are owed
       * rather than declining to extend credit.
       */
      try {
        const row = await prisma.applicationCreditLedgerEntry.create({
          data: {
            tenantId: params.tenantId,
            entryType: CreditLedgerEntryType.OVERRUN,
            quantity: 0,
            deliveryDay,
            applicationId: params.applicationId,
            // No unitRate: an overrun is priced that evening at the rate the
            // settlement derives, and the settlement row for this Delivery Day
            // carries that rate, the quantity and the amount.
            unitRate: null,
            amount: null,
          },
          select: { id: true },
        });
        return { outcome: 'OVERRUN', entryId: row.id, entryType: CreditLedgerEntryType.OVERRUN, unitRate: null };
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const raced = await findEntryForApplication(prisma, params.applicationId);
        if (raced) return raced;
        continue;
      }
    }

    const lot = lots[0];

    try {
      const row = await prisma.applicationCreditLedgerEntry.create({
        data: {
          tenantId: params.tenantId,
          entryType: CreditLedgerEntryType.CONSUMPTION,
          quantity: -1,
          deliveryDay,
          applicationId: params.applicationId,
          purchaseEntryId: lot.id,
          // The next free unit of this lot. Two writers computing the same
          // number is the point: the unique index admits one of them.
          lotIndex: lot.used,
          unitRate: lot.unitRate === null ? null : new Prisma.Decimal(lot.unitRate.toFixed(2)),
          amount: lot.unitRate === null ? null : new Prisma.Decimal((-lot.unitRate).toFixed(2)),
        },
        select: { id: true },
      });
      return {
        outcome: 'CONSUMED',
        entryId: row.id,
        entryType: CreditLedgerEntryType.CONSUMPTION,
        unitRate: lot.unitRate,
      };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;

      /*
       * Either another application took this unit, or this application already
       * has a row. The second is decided by looking, not by parsing the error's
       * constraint name -- which Prisma reports differently across drivers and
       * which is the sort of detail that changes underneath a release.
       */
      const raced = await findEntryForApplication(prisma, params.applicationId);
      if (raced) return raced;
    }
  }

  throw new Error(
    `Could not claim a credit for application ${params.applicationId} after ${MAX_CLAIM_ATTEMPTS} ` +
      'attempts. The settlement reconciliation pass will record it.'
  );
}

async function findEntryForApplication(
  prisma: LedgerClient,
  applicationId: string
): Promise<ConsumeResult | null> {
  const row = await prisma.applicationCreditLedgerEntry.findUnique({
    where: { applicationId },
    select: { id: true, entryType: true, unitRate: true },
  });
  if (!row) return null;
  return {
    outcome: 'ALREADY_RECORDED',
    entryId: row.id,
    entryType: row.entryType,
    unitRate: row.unitRate === null ? null : toNumber(row.unitRate),
  };
}

/**
 * Every application this agency submitted on a Delivery Day that has no ledger
 * row yet, recorded now.
 *
 * The consumption hook runs at submission time and can fail -- a database blip,
 * a process restart between the carrier's acceptance and our write. Without
 * this, that application would be delivered, submitted and never charged. It is
 * safe to run at any time and any number of times, because the row is keyed on
 * the application.
 *
 * It runs at the start of settlement, before the day's overrun is counted, so
 * the settlement bills what was actually submitted rather than what happened to
 * get written.
 */
export async function reconcileDeliveryDay(params: {
  prisma?: LedgerClient;
  tenantId: string;
  deliveryDay: CalendarDayKey;
  bounds: { start: Date; endExclusive: Date };
}): Promise<{ reconciled: number }> {
  const prisma = params.prisma ?? getPrismaClient();

  const missing = await prisma.insuranceCarrierApplication.findMany({
    where: {
      tenantId: params.tenantId,
      submittedAt: { gte: params.bounds.start, lt: params.bounds.endExclusive },
      // `creditLedgerEntry` is not a Prisma relation -- the ledger references
      // the application by plain id, deliberately, so that adding money to this
      // platform did not require a foreign key onto a table full of encrypted
      // applicant data. So the anti-join is done here.
    },
    select: { id: true },
    orderBy: { submittedAt: 'asc' },
  });

  if (missing.length === 0) return { reconciled: 0 };

  const already = await prisma.applicationCreditLedgerEntry.findMany({
    where: { applicationId: { in: missing.map(a => a.id) } },
    select: { applicationId: true },
  });
  const seen = new Set(already.map(row => row.applicationId));

  let reconciled = 0;
  for (const application of missing) {
    if (seen.has(application.id)) continue;
    await consumeCreditForApplication({
      prisma,
      tenantId: params.tenantId,
      applicationId: application.id,
      deliveryDay: params.deliveryDay,
    });
    reconciled++;
  }

  return { reconciled };
}

/** The day's counts, straight off the ledger. */
export interface LedgerDayCounts {
  consumed: number;
  overrun: number;
  purchased: number;
}

export async function ledgerCountsForDay(
  prisma: LedgerClient,
  tenantId: string,
  deliveryDay: CalendarDayKey
): Promise<LedgerDayCounts> {
  const rows = await prisma.applicationCreditLedgerEntry.groupBy({
    by: ['entryType'],
    where: { tenantId, deliveryDay },
    _count: { _all: true },
    _sum: { quantity: true },
  });

  const find = (type: CreditLedgerEntryType): (typeof rows)[number] | undefined =>
    rows.find(row => row.entryType === type);

  return {
    consumed: find(CreditLedgerEntryType.CONSUMPTION)?._count._all ?? 0,
    overrun: find(CreditLedgerEntryType.OVERRUN)?._count._all ?? 0,
    purchased: find(CreditLedgerEntryType.PURCHASE)?._sum.quantity ?? 0,
  };
}

/** The overrun rows for one Delivery Day, oldest first. Used to bill them. */
export async function overrunEntriesForDay(
  prisma: LedgerClient,
  tenantId: string,
  deliveryDay: CalendarDayKey
): Promise<Array<{ id: string; applicationId: string | null; createdAt: Date }>> {
  return prisma.applicationCreditLedgerEntry.findMany({
    where: { tenantId, deliveryDay, entryType: CreditLedgerEntryType.OVERRUN },
    select: { id: true, applicationId: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
}

/** What retiring an agency's dry-run credits actually retired. */
export interface DryRunCloseout {
  /** Purchase lots retired. Zero when there was nothing to retire. */
  lotsRetired: number;
  /** Credits retired across those lots. */
  creditsRetired: number;
  /** The balance after, which is what the first charged settlement sees. */
  balanceAfter: number;
  entryIds: string[];
}

/**
 * Retire every unused credit that came from a dry-run settlement.
 *
 * ── When this runs, and why it has to ────────────────────────────────────────
 *
 * At the moment an agency moves from dry run to live charging, and only then.
 *
 * A dry-run settlement sells the next Delivery Day's block so the agency keeps
 * delivering the way it would if the charge had gone through -- without it the
 * balance is zero, every application is Overrun, and delivery stops at the
 * ceiling on day one, so what was being watched would not be the real system.
 * Those blocks are never charged for.
 *
 * Left on the balance they carry into the first charged settlement and reduce
 * its block, because the block is the daily target minus unused paid
 * applications and the ledger cannot tell an unpaid dry-run credit from a
 * bought one. The agency would be delivered a short block, on credits nobody
 * paid for, on its first real billing day.
 *
 * So the transition retires them, by appending rows. The balance starts at zero
 * and the first real settlement sells a full block.
 *
 * ── It is not a reversal ─────────────────────────────────────────────────────
 *
 * Nothing is returned to anybody and no money moves, because no money ever
 * moved. This is not a refund, a credit, a rebate or a make-good, and the entry
 * type is its own thing precisely so it cannot be mistaken for one: it retires
 * credits that were issued to make an observation possible and were never sold.
 *
 * ── Append-only, and idempotent ──────────────────────────────────────────────
 *
 * Nothing is updated or deleted; the purchases stay exactly as they were and
 * the retirement is a later row, which is the only correction this ledger has.
 * Each closeout claims slot -1 of its lot, and `(purchaseEntryId, lotIndex)` is
 * unique, so turning charging on twice retires nothing the second time.
 *
 * ── What is NOT retired ──────────────────────────────────────────────────────
 *
 * Only lots sold by a settlement whose payment status is DRY_RUN. An agency's
 * opening purchase was paid for by card or ACH and carries no settlement at
 * all; a block sold by a settlement that was charged was paid for. Neither is
 * touched, and both keep their credits.
 */
export async function closeOutDryRunLots(params: {
  prisma?: LedgerClient;
  tenantId: string;
  /** For the record: what the closeout is attributed to. */
  note?: string;
}): Promise<DryRunCloseout> {
  const prisma = params.prisma ?? getPrismaClient();

  /*
   * Lots sold by a DRY_RUN settlement that still have credits on them and have
   * not already been retired. The join onto `daily_settlements` is what limits
   * this to dry-run blocks: a lot with no settlement is an opening purchase and
   * was paid for.
   */
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      quantity: number;
      used: bigint;
      unitRate: Prisma.Decimal | null;
      deliveryDay: string;
      settlementId: string;
      curveVersionId: string | null;
      curveVersion: number | null;
    }>
  >`
    SELECT p."id",
           p."quantity",
           p."unitRate",
           p."deliveryDay",
           p."settlementId",
           p."curveVersionId",
           p."curveVersion",
           (SELECT COUNT(*) FROM "application_credit_ledger" c
             WHERE c."purchaseEntryId" = p."id"
               AND c."entryType" = 'CONSUMPTION'::"CreditLedgerEntryType") AS "used"
      FROM "application_credit_ledger" p
      JOIN "daily_settlements" s ON s."id" = p."settlementId"
     WHERE p."tenantId" = ${params.tenantId}
       AND p."entryType" = 'PURCHASE'::"CreditLedgerEntryType"
       AND s."paymentStatus" = 'DRY_RUN'::"SettlementPaymentStatus"
       AND NOT EXISTS (
             SELECT 1 FROM "application_credit_ledger" x
              WHERE x."purchaseEntryId" = p."id"
                AND x."entryType" = 'DRY_RUN_CLOSEOUT'::"CreditLedgerEntryType")
     ORDER BY p."deliveryDay" ASC, p."createdAt" ASC, p."id" ASC
  `;

  const entryIds: string[] = [];
  let creditsRetired = 0;

  for (const lot of rows) {
    const remaining = lot.quantity - Number(lot.used);
    if (remaining <= 0) continue;

    try {
      const entry = await prisma.applicationCreditLedgerEntry.create({
        data: {
          tenantId: params.tenantId,
          entryType: CreditLedgerEntryType.DRY_RUN_CLOSEOUT,
          // Negative: these credits stop counting toward the balance.
          quantity: -remaining,
          // The Delivery Day the retired block was FOR, so the row says which
          // block it retired rather than when somebody pressed the button.
          deliveryDay: lot.deliveryDay,
          // The rate the block was nominally sold at, so the row reads on its
          // own. `amount` stays null: no money moved, in either direction, and
          // a figure there would read as one that did.
          unitRate: lot.unitRate,
          amount: null,
          curveVersionId: lot.curveVersionId,
          curveVersion: lot.curveVersion,
          purchaseEntryId: lot.id,
          // Slot -1. A real unit index is never negative, so the existing
          // unique index on (purchaseEntryId, lotIndex) makes this at most once
          // per lot.
          lotIndex: -1,
          settlementId: lot.settlementId,
        },
        select: { id: true },
      });
      entryIds.push(entry.id);
      creditsRetired += remaining;
    } catch (error) {
      // Already retired by a concurrent or earlier call. Nothing to do: the
      // unique index is the guarantee and this is it holding.
      if (!isUniqueViolation(error)) throw error;
    }
  }

  return {
    lotsRetired: entryIds.length,
    creditsRetired,
    balanceAfter: await creditBalance(prisma, params.tenantId),
    entryIds,
  };
}

/**
 * What retiring the dry-run credits WOULD do, without writing anything.
 *
 * For the go-live runbook: an operator should be able to see the number before
 * they turn charging on, not discover it in the response.
 */
export async function previewDryRunCloseout(
  prisma: LedgerClient,
  tenantId: string
): Promise<{ lots: number; credits: number }> {
  /*
   * A fully spent lot is excluded, matching `closeOutDryRunLots()` exactly: it
   * writes no row for a lot with nothing left, so counting one here would tell
   * an operator a lot was about to be retired that then is not.
   */
  const rows = await prisma.$queryRaw<Array<{ lots: bigint; credits: bigint }>>`
    SELECT COUNT(*) AS "lots", COALESCE(SUM("remaining"), 0) AS "credits"
      FROM (
        SELECT p."quantity" - (
                 SELECT COUNT(*) FROM "application_credit_ledger" c
                  WHERE c."purchaseEntryId" = p."id"
                    AND c."entryType" = 'CONSUMPTION'::"CreditLedgerEntryType"
               ) AS "remaining"
          FROM "application_credit_ledger" p
          JOIN "daily_settlements" s ON s."id" = p."settlementId"
         WHERE p."tenantId" = ${tenantId}
           AND p."entryType" = 'PURCHASE'::"CreditLedgerEntryType"
           AND s."paymentStatus" = 'DRY_RUN'::"SettlementPaymentStatus"
           AND NOT EXISTS (
                 SELECT 1 FROM "application_credit_ledger" x
                  WHERE x."purchaseEntryId" = p."id"
                    AND x."entryType" = 'DRY_RUN_CLOSEOUT'::"CreditLedgerEntryType")
      ) AS "lots"
     WHERE "remaining" > 0
  `;

  return { lots: Number(rows[0]?.lots ?? 0), credits: Number(rows[0]?.credits ?? 0) };
}
