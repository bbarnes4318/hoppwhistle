/**
 * `pnpm numbers:bill-month` -- write this month's MONTHLY number charges.
 *
 * Run on the 1st. Writes one MONTHLY row per ACTIVE phone number for the UTC
 * calendar month containing today (or `--month YYYY-MM`), at the price that
 * applies to the tenant being billed -- the parent white-label for a child
 * agency. See `services/numbers/number-charges.ts`.
 *
 * Idempotent: run it twice and the second run writes nothing. A number whose
 * purchase already wrote a prorated row for the month is skipped.
 *
 * Nothing is collected. The rows are read by the agency owner's statement.
 */

import { getPrismaClient } from '../lib/prisma.js';
import { billMonth } from '../services/numbers/number-charges.js';

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const prisma = getPrismaClient();

  const month = argValue('--month');
  let at = new Date();
  if (month !== undefined) {
    if (!/^\d{4}-\d{2}$/.test(month)) {
      console.error(`--month must be YYYY-MM, got ${JSON.stringify(month)}`);
      process.exitCode = 1;
      return;
    }
    const [year, mm] = month.split('-').map(Number);
    at = new Date(Date.UTC(year, mm - 1, 1));
  }

  const result = await billMonth(prisma, at);
  console.log(
    `Monthly number charges for ${result.periodStart.toISOString().slice(0, 7)}: ` +
      `${result.written} row(s) written.`
  );
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void getPrismaClient().$disconnect();
  });
