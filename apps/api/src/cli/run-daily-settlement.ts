/**
 * Settle every agency for the Delivery Day that just closed.
 *
 *   pnpm --filter @hopwhistle/api settlement:run
 *   pnpm --filter @hopwhistle/api settlement:run -- --day 2026-09-07
 *   pnpm --filter @hopwhistle/api settlement:run -- --tenant <id>
 *   pnpm --filter @hopwhistle/api settlement:run -- --plan-only
 *   pnpm --filter @hopwhistle/api settlement:run -- --settle-without-charge
 *   pnpm --filter @hopwhistle/api settlement:run -- --retry-failed
 *   pnpm --filter @hopwhistle/api settlement:run -- --resume-stalled
 *
 * ── The two safe modes, and why they are not named alike ─────────────────────
 *
 *   --plan-only               Writes NOTHING. Computes what tonight would be
 *                             and prints it. No settlement row, no ledger row,
 *                             no charge. A preview.
 *
 *   --settle-without-charge   Writes EVERYTHING except the debit. The full
 *                             settlement row is recorded with every figure on
 *                             it, the next day's block is sold, and Stripe is
 *                             never called. The row reads DRY_RUN and
 *                             `totalCharged` is what it would have taken.
 *
 * These were `--dry-run` and `--no-charge`, which is two flags a character
 * apart where one writes nothing and the other writes almost everything. That
 * is a mistake waiting to be made at eleven at night on a system that moves
 * money, so they are now named for what they do and share no prefix. The old
 * spellings are REFUSED rather than ignored -- an unrecognised flag would leave
 * the run charging people, which is the worst of the three outcomes.
 *
 * `--settle-without-charge` is the one to run a real agency on for a few days
 * before money moves, and it is one-directional: it can only turn charging off.
 * An agency whose profile has `chargesEnabled: false` is already in that mode
 * and this flag changes nothing for it.
 *
 * ── Agencies not enrolled in billing are skipped ─────────────────────────────
 *
 * Every active tenant is walked and the unenrolled ones report a skip without a
 * settlement row. Enrolment is explicit, per tenant, and defaults to off, so on
 * a platform where nobody has been enrolled this command settles nobody and
 * says so for each.
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
 * ── --plan-only charges nobody and writes nothing ────────────────────────────
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

  /*
   * The retired spellings, refused loudly.
   *
   * `--dry-run` and `--no-charge` were renamed because they were a character
   * apart and did almost opposite things. Silently ignoring an unrecognised
   * flag would leave this command doing a full charging run, so anybody with
   * the old names in their fingers or in a cron gets an error and an exit code
   * instead.
   */
  const retired: Array<[string, string]> = [
    ['--dry-run', '--plan-only'],
    ['--no-charge', '--settle-without-charge'],
  ];
  for (const [old, replacement] of retired) {
    if (process.argv.includes(old)) {
      console.error(
        `${old} no longer exists. Use ${replacement}.\n\n` +
          '  --plan-only              compute and PRINT; writes nothing, charges nobody\n' +
          '  --settle-without-charge  compute and RECORD the settlement; charges nobody\n\n' +
          'They were renamed because the old names were one character apart and ' +
          'did almost opposite things. Nothing has been run.'
      );
      process.exitCode = 2;
      return;
    }
  }

  const tenantFilter = argValue('--tenant');
  const planOnly = process.argv.includes('--plan-only');
  const settleWithoutCharge = process.argv.includes('--settle-without-charge');

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

  if (planOnly) {
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

    console.log('PLAN ONLY — nothing is written and nobody is charged.\n');
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

      // Not enrolled means nothing would happen, and printing a row of zeroes
      // beside the agencies that are being billed reads as though it did.
      if (!terms.enrolled) {
        console.log(`${tenant.name.slice(0, 24).padEnd(24)}   not enrolled in billing — skipped`);
        continue;
      }

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

  if (settleWithoutCharge) {
    console.log(
      '--settle-without-charge: settlements will be computed and RECORDED in full; ' +
        'no debit will be placed.'
    );
    console.log('');
  }

  const result = await runDailySettlement({
    deliveryDay: day,
    prisma,
    tenantIds: tenantFilter ? [tenantFilter] : undefined,
    settleWithoutCharge,
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
        `total ${money(settlement.totalCharged)}` +
        (settlement.paymentStatus === 'DRY_RUN' ? '   (recorded; nothing charged)' : '')
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
