/**
 * Rate every agency for the business day that just closed.
 *
 *   pnpm --filter @hopwhistle/api rating:run
 *   pnpm --filter @hopwhistle/api rating:run -- --day 2026-09-07
 *   pnpm --filter @hopwhistle/api rating:run -- --dry-run
 *
 * ── When to run it ───────────────────────────────────────────────────────────
 *
 * After the close of a business day, which is 23:59:59 America/New_York. A cron
 * a little after midnight Eastern is the intended shape:
 *
 *   5 0 * * *   (America/New_York)
 *
 * It is safe to run more than once. One rating decision exists per agency per
 * effective day, enforced by a unique index, so a second run reports
 * `alreadyRated` and writes nothing rather than producing a second, conflicting
 * price. That property is what makes it safe to put on a cron at all.
 *
 * ── Why a command and not the worker ─────────────────────────────────────────
 *
 * `apps/worker` talks to Postgres through raw `pg` and has no Prisma client.
 * The rating engine is Prisma-native and lives beside the models it writes;
 * duplicating it against raw SQL to fit the worker would give the platform two
 * implementations of the arithmetic Phase 3 bills from, which is exactly the
 * thing this phase exists to prevent. So the engine stays in one place and this
 * is the entry point a scheduler calls.
 *
 * It changes nothing about the deploy path and runs no migrations.
 *
 * Requires DATABASE_URL.
 */

import { getPrismaClient } from '../lib/prisma.js';
import { lastClosedBusinessDay, nextBusinessDay } from '../services/rating/business-day.js';
import { measureTrailingWindow } from '../services/rating/measurement.js';
import { rateFor } from '../services/rating/rate-curve.js';
import {
  loadActiveCurve,
  loadWindowBusinessDays,
  runDailyRating,
} from '../services/rating/rating-engine.js';

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function money(value: number | null): string {
  return value === null ? '     —' : `$${value.toFixed(0).padStart(5)}`;
}

function pct(value: number | null): string {
  return value === null ? '    —' : `${value.toFixed(2)}%`;
}

async function main(): Promise<void> {
  const prisma = getPrismaClient();

  const day = argValue('--day') ?? lastClosedBusinessDay();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    console.error(`--day must be YYYY-MM-DD (America/New_York), got ${JSON.stringify(day)}`);
    process.exitCode = 1;
    return;
  }

  const dryRun = process.argv.includes('--dry-run');

  console.log(`Rating window closes:  ${day} 23:59:59 America/New_York`);
  console.log(`Rate applies to:       ${nextBusinessDay(day)}`);

  if (dryRun) {
    // Computes and prints, writes nothing. For checking what a run WOULD do
    // before letting it write an immutable record.
    const [curve, windowBusinessDays, tenants] = await Promise.all([
      loadActiveCurve(prisma),
      loadWindowBusinessDays(prisma),
      prisma.tenant.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    console.log(`Curve v${curve.version}, ${windowBusinessDays}-business-day window (dry run)\n`);

    for (const tenant of tenants) {
      const measured = await measureTrailingWindow(
        { calls: prisma.call, applications: prisma.insuranceCarrierApplication },
        tenant.id,
        day,
        windowBusinessDays
      );

      const verdict =
        measured.closingPct === null ? null : rateFor(curve, measured.closingPct);

      const rate =
        verdict === null ? null : verdict.kind === 'BELOW_MINIMUM' ? null : verdict.rate;

      const note =
        measured.closingPct === null
          ? 'no delivered calls — previous rate stands'
          : verdict?.kind === 'BELOW_MINIMUM'
            ? `below ${curve.minimumClosingPct}% — flagged for review, no rate`
            : '';

      console.log(
        `  ${tenant.name.padEnd(28)} ` +
          `${String(measured.deliveredCalls).padStart(6)} calls  ` +
          `${String(measured.submittedApplications).padStart(5)} apps  ` +
          `${pct(measured.closingPct).padStart(7)}  ${money(rate)}  ${note}`
      );
    }
    return;
  }

  const run = await runDailyRating({ closedBusinessDay: day, prisma });

  for (const result of run.results) {
    console.log(
      `  ${result.tenantId}  ${result.status.padEnd(14)} ` +
        `${String(result.deliveredCalls).padStart(6)} calls  ` +
        `${String(result.submittedApplications).padStart(5)} apps  ` +
        `${pct(result.closingPct).padStart(7)}  ` +
        `${money(result.previousRate)} → ${money(result.newRate)}` +
        (result.alreadyRated ? '  (already rated; nothing written)' : '')
    );
  }

  for (const failure of run.failures) {
    console.error(`  ${failure.tenantId}  FAILED: ${failure.error}`);
  }

  console.log(
    `\n${run.results.length} agencies rated, ${run.failures.length} failed.`
  );

  // A failure for one agency leaves the others correctly rated, but the run as
  // a whole did not do its job, and a cron needs to know that.
  if (run.failures.length > 0) process.exitCode = 1;
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    void getPrismaClient().$disconnect();
  });
