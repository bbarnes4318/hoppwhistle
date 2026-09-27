/**
 * What phone numbers cost the agency that holds them.
 *
 * ── The price ────────────────────────────────────────────────────────────────
 *
 * $2.49 to set a number up and $1.49 a month to keep it, the figures the Anveo
 * purchase screen already quoted (`routes/anveo-procurement.ts`). A platform
 * admin overrides either per tenant on Admin -> Agencies, stored as
 * `Tenant.metadata.numberPricing = { setup, monthly }`.
 *
 * ── Who is charged ───────────────────────────────────────────────────────────
 *
 * The agency that bought the number -- unless it is a child agency, in which
 * case the row is written to its PARENT white-label tenant with
 * `metadata.childTenantId` naming the child. NetEnroll bills the white-label;
 * the white-label bills its own agencies. The parent's price applies, since it
 * is the parent NetEnroll is billing.
 *
 * ── When ─────────────────────────────────────────────────────────────────────
 *
 * At purchase: a SETUP row, and a MONTHLY row for the rest of the current
 * calendar month, prorated by the days remaining (today included). On the 1st:
 * `pnpm numbers:bill-month` writes a MONTHLY row for every ACTIVE number
 * (`cli/number-charges-monthly.ts`). Months are UTC.
 *
 * Nothing here collects payment. The rows are what the agency owner's monthly
 * statement reads.
 */

import { Prisma, type PrismaClient } from '@prisma/client';

export const DEFAULT_NUMBER_PRICING = { setup: 2.49, monthly: 1.49 } as const;

export interface NumberPricing {
  setup: number;
  monthly: number;
}

type Db = Pick<PrismaClient, 'tenant' | 'numberCharge'> | Prisma.TransactionClient;

/** A price read from metadata, or the default when it is missing or nonsense. */
function priceOr(value: unknown, fallback: number): number {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0
    ? Math.round(n * 100) / 100
    : fallback;
}

/** A tenant's number pricing from its metadata. */
export function pricingFromMetadata(metadata: unknown): NumberPricing {
  const raw = (metadata as { numberPricing?: { setup?: unknown; monthly?: unknown } } | null)
    ?.numberPricing;
  return {
    setup: priceOr(raw?.setup, DEFAULT_NUMBER_PRICING.setup),
    monthly: priceOr(raw?.monthly, DEFAULT_NUMBER_PRICING.monthly),
  };
}

/**
 * Who pays for `tenantId`'s numbers, and at what price.
 *
 * `billedTenantId` is the tenant the rows are written to: the parent for a
 * child agency, the tenant itself otherwise.
 */
export async function numberBillingFor(
  db: Db,
  tenantId: string
): Promise<{ billedTenantId: string; childTenantId: string | null; pricing: NumberPricing }> {
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { metadata: true, parentTenantId: true, parent: { select: { metadata: true } } },
  });

  if (tenant?.parentTenantId) {
    return {
      billedTenantId: tenant.parentTenantId,
      childTenantId: tenantId,
      pricing: pricingFromMetadata(tenant.parent?.metadata),
    };
  }
  return {
    billedTenantId: tenantId,
    childTenantId: null,
    pricing: pricingFromMetadata(tenant?.metadata),
  };
}

/** The first instant of the UTC month containing `at`. */
export function monthStart(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
}

/** The first instant of the UTC month after the one containing `at`. */
export function nextMonthStart(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
}

/** The first instant of the UTC day containing `at`. */
function dayStart(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

/**
 * The monthly price for what is left of `at`'s month, today included.
 *
 * A number bought on the 1st pays the whole month; on the last day, one day.
 */
export function proratedMonthly(monthly: number, at: Date): number {
  const start = monthStart(at);
  const end = nextMonthStart(at);
  const daysInMonth = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  const daysRemaining = Math.round((end.getTime() - dayStart(at).getTime()) / 86_400_000);
  return Math.round(((monthly * daysRemaining) / daysInMonth) * 100) / 100;
}

/**
 * The charges for buying one number: SETUP, and the prorated rest of this
 * month. Written by the caller's transaction, beside the PhoneNumber row, so a
 * number never exists without its charge nor a charge without its number.
 */
export async function recordPurchaseCharges(
  db: Db,
  params: { tenantId: string; phoneNumberId: string; at?: Date }
): Promise<{ setup: number; monthly: number; billedTenantId: string }> {
  const at = params.at ?? new Date();
  const { billedTenantId, childTenantId, pricing } = await numberBillingFor(db, params.tenantId);
  const metadata: Prisma.InputJsonObject = childTenantId
    ? { childTenantId, prorated: true }
    : { prorated: true };
  const monthly = proratedMonthly(pricing.monthly, at);

  await db.numberCharge.create({
    data: {
      tenantId: billedTenantId,
      phoneNumberId: params.phoneNumberId,
      kind: 'SETUP',
      amount: new Prisma.Decimal(pricing.setup),
      periodStart: at,
      periodEnd: at,
      metadata: childTenantId ? { childTenantId } : undefined,
    },
  });

  /*
   * `periodStart` is the start of TODAY, not the purchase instant. Bought on
   * the 1st, that is the month's first instant -- the same key the monthly
   * command writes -- so the unique index stops the month being charged twice
   * if the command runs after the purchase.
   */
  await db.numberCharge.create({
    data: {
      tenantId: billedTenantId,
      phoneNumberId: params.phoneNumberId,
      kind: 'MONTHLY',
      amount: new Prisma.Decimal(monthly),
      periodStart: dayStart(at),
      periodEnd: nextMonthStart(at),
      metadata,
    },
  });

  return { setup: pricing.setup, monthly, billedTenantId };
}

/**
 * Stop a released number's monthly charge at the moment of release.
 *
 * Nothing is refunded -- the month was started -- but the current month's row
 * says when the number stopped, and the monthly command never writes another
 * row for a number that is not ACTIVE.
 */
export async function endMonthlyCharge(
  db: Db,
  phoneNumberId: string,
  at: Date = new Date()
): Promise<void> {
  await db.numberCharge.updateMany({
    where: { phoneNumberId, kind: 'MONTHLY', periodEnd: { gt: at } },
    data: { periodEnd: at },
  });
}

/**
 * Write one MONTHLY row for every ACTIVE number, for the month containing `at`.
 *
 * Idempotent twice over: `ON CONFLICT` on (phoneNumberId, kind, periodStart)
 * stops a second run writing the same row, and `NOT EXISTS` skips a number
 * that already has a MONTHLY row starting inside the month -- the prorated row
 * its purchase wrote -- so a number bought on the 15th is not charged the whole
 * month again by a re-run.
 */
export async function billMonth(
  prisma: PrismaClient,
  at: Date = new Date()
): Promise<{ periodStart: Date; periodEnd: Date; written: number }> {
  const periodStart = monthStart(at);
  const periodEnd = nextMonthStart(at);

  const written = await prisma.$executeRaw`
    INSERT INTO "number_charges"
      ("id", "tenantId", "phoneNumberId", "kind", "amount", "periodStart", "periodEnd", "metadata", "createdAt")
    SELECT
      gen_random_uuid()::text,
      COALESCE(t."parentTenantId", t."id"),
      pn."id",
      'MONTHLY',
      ROUND(COALESCE(
        CASE WHEN (billed."metadata"->'numberPricing'->>'monthly') ~ '^[0-9]+(\\.[0-9]+)?$'
             THEN (billed."metadata"->'numberPricing'->>'monthly')::numeric END,
        ${DEFAULT_NUMBER_PRICING.monthly}::numeric
      ), 2),
      ${periodStart},
      ${periodEnd},
      CASE WHEN t."parentTenantId" IS NOT NULL
           THEN jsonb_build_object('childTenantId', t."id")
           ELSE NULL END,
      NOW()
    FROM "phone_numbers" pn
    JOIN "tenants" t ON t."id" = pn."tenantId"
    JOIN "tenants" billed ON billed."id" = COALESCE(t."parentTenantId", t."id")
    WHERE pn."status" = 'ACTIVE'
      AND NOT EXISTS (
        SELECT 1 FROM "number_charges" nc
        WHERE nc."phoneNumberId" = pn."id"
          AND nc."kind" = 'MONTHLY'
          AND nc."periodStart" >= ${periodStart}
          AND nc."periodStart" < ${periodEnd}
      )
    ON CONFLICT ("phoneNumberId", "kind", "periodStart") DO NOTHING
  `;

  return { periodStart, periodEnd, written };
}
