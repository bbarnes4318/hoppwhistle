/**
 * Settle every agency for the Delivery Day that just closed.
 *
 *   pnpm --filter @hopwhistle/api settlement:run
 *   pnpm --filter @hopwhistle/api settlement:run -- --day 2026-09-07
 *   pnpm --filter @hopwhistle/api settlement:run -- --tenant <id>
 *   pnpm --filter @hopwhistle/api settlement:run -- --dry-run
 *   pnpm --filter @hopwhistle/api settlement:run -- --retry-failed
 *   pnpm --filter @hopwhistle/api settlement:run -- --resume-stalled
 *
 * ── When to run it ───────────────────────────────────────────────────────────
 *
 * After the close of a calendar day, which is 23:59:59 America/New_York, and
 * AFTER the rating run -- though it does not depend on that ordering, because
 * it calls the rating engine itself and that engine is idempotent. A cron a
 * little after midnight Eastern is the intended shape:
 *
 *   15 0 * * *   (America/New_York)
 *
 * ── It is safe to run twice ──────────────────────────────────────────────────
 *
 * One settlement per agency per Delivery Day, enforced by a unique index. A
 * second run charges nobody, sells no second block and re-applies no rate: the
 * insert fails and the run reports `alreadySettled`. That property is what makes
 * it safe to put on a cron at all, and it is asserted by two genuinely
 * concurrent runs in `settlement.test.ts`.
 *
 * ── --dry-run charges nobody and writes nothing ──────────────────────────────
 *
 * It prints what each agency's settlement would be -- the counts, the rate the
 * curve is returning, the overrun, the block and the total -- without touching
 * the ledger, the settlements table or Stripe. Use it to read tonight's numbers
 * before the cron does.
 *
 * Requires DATABASE_URL. Placing real debits also requires STRIPE_ENABLED=true
 * and STRIPE_SECRET_KEY; without them the run records every settlement as
 * FAILED with `stripe_disabled` rather than pretending money moved.
 */

import { getPrismaClient } from '../lib/prisma.js';
import { creditBalance, ledgerCountsForDay } from '../services/billing/credit-ledger.js';
import {
  resumeStalledSettlements,
  retryFailedSettlements,
  runDailySettlement,
} from '../services/billing/settlement.js';
import { loadAgencyTerms } from '../services/billing/terms.js';
import { lastClosedCalendarDay, nextCalendarDay } from '../services/rating/calendar-day.js';
import { getRatingSummary } from '../services/rating/rating-summary.js';

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function money(value: number | null): string {
  return value === null ? '        —' : `$${value.toFixed(2).padStart(8)}`;
}

async function main(): Promise<void> {
  const prisma = getPrismaClient();

  const day = argValue('--day') ?? lastClosedCalendarDay();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    console.error(`--day must be YYYY-MM-DD (America/New_York), got ${JSON.stringify(day)}`);
    process.exitCode = 1;
    return;
  }

  const tenantFilter = argValue('--tenant');
  const dryRun = process.argv.includes('--dry-run');

  console.log(`Delivery Day settled:  ${day} (closed 23:59:59 America/New_York)`);
  console.log(`Block sold for:        ${nextCalendarDay(day)}`);
  console.log('');

  if (process.argv.includes('--retry-failed')) {
    const outcomes = await retryFailedSettlements({ prisma });
    console.log(`Retried ${outcomes.length} failed settlement(s).`);
    for (const outcome of outcomes) console.log(`  ${outcome.settlementId}  ${outcome.status}`);
    await prisma.$disconnect();
    return;
  }

  if (process.argv.includes('--resume-stalled')) {
    const outcomes = await resumeStalledSettlements({ prisma });
    console.log(`Resumed ${outcomes.length} stalled settlement(s).`);
    for (const outcome of outcomes) console.log(`  ${outcome.settlementId}  ${outcome.status}`);
    await prisma.$disconnect();
    return;
  }

  if (dryRun) {
    /*
     * Deliberately a separate read-only path rather than the real one with a
     * flag threaded through it. A "dry run" that shares the write path with the
     * real run is one `if` away from charging somebody, and this run charges
     * real bank accounts.
     */
    const tenants = tenantFilter
      ? await prisma.tenant.findMany({ where: { id: tenantFilter }, select: { id: true, name: true } })
      : await prisma.tenant.findMany({
          where: { status: 'ACTIVE' },
          select: { id: true, name: true },
          orderBy: { createdAt: 'asc' },
        });

    console.log('DRY RUN — nothing is written and nobody is charged.\n');
    console.log(
      'agency                     rate   overrun    overrun $   block    block $      total     max'
    );
    console.log('-'.repeat(96));

    for (const tenant of tenants) {
      const [terms, summary, counts, balance] = await Promise.all([
        loadAgencyTerms(tenant.id, { prisma }),
        getRatingSummary(tenant.id, { prisma }),
        ledgerCountsForDay(prisma, tenant.id, day),
        creditBalance(prisma, tenant.id),
      ]);

      const rate = summary.trackingRate ?? summary.currentRate;
      const overrunAmount = rate === null ? null : counts.overrun * rate;
      const blockQuantity =
        summary.trackingRate === null
          ? 0
          : Math.max(0, terms.dailyBlockApplications - Math.max(0, balance));
      const blockAmount = summary.trackingRate === null ? 0 : blockQuantity * summary.trackingRate;
      const total = overrunAmount === null ? null : overrunAmount + blockAmount;

      console.log(
        `${tenant.name.slice(0, 24).padEnd(24)} ${(rate === null ? '—' : `$${rate}`).padStart(6)}  ` +
          `${String(counts.overrun).padStart(7)} ${money(overrunAmount)}  ` +
          `${String(blockQuantity).padStart(6)} ${money(blockAmount)} ${money(total)} ` +
          `${money(terms.maxDailyDebit)}` +
          (total !== null && total > terms.maxDailyDebit ? '   ** WOULD HALT **' : '')
      );
    }

    await prisma.$disconnect();
    return;
  }

  const result = await runDailySettlement({
    deliveryDay: day,
    prisma,
    tenantIds: tenantFilter ? [tenantFilter] : undefined,
  });

  for (const settlement of result.results) {
    if (settlement.skippedReason) {
      console.log(`${settlement.tenantId}  skipped: ${settlement.skippedReason}`);
      continue;
    }
    if (settlement.alreadySettled) {
      console.log(`${settlement.tenantId}  already settled for ${day}; nothing charged`);
      continue;
    }
    console.log(
      `${settlement.tenantId}  ${settlement.paymentStatus}  ` +
        `overrun ${settlement.overrunQuantity} (${money(settlement.overrunAmount)})  ` +
        `block ${settlement.nextBlockQuantity} (${money(settlement.nextBlockAmount)})  ` +
        `total ${money(settlement.totalCharged)}`
    );
  }

  if (result.failures.length > 0) {
    console.error(`\n${result.failures.length} agency/agencies failed to settle:`);
    for (const failure of result.failures) {
      console.error(`  ${failure.tenantId}: ${failure.error}`);
    }
    process.exitCode = 1;
  }

  await prisma.$disconnect();
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
