/**
 * `pnpm statements:close [YYYY-MM] [--rebuild]` -- write a closed month's statements.
 *
 * Run on the 1st, after `pnpm numbers:bill-month`, so the agency statements
 * carry the month's number charges. With no month it closes the previous one,
 * in America/New_York: run at 00:30 New York on 1 October, it closes September.
 *
 * For every tenant it writes one statement per buyer, per publisher, the agency
 * itself, and each child agency (`services/statements/statements.ts`).
 *
 * Idempotent: a statement already written is left alone, so a second run
 * writes nothing. `--rebuild` rewrites them -- for a template fix, never to move
 * a figure: a closed month's numbers do not change.
 *
 * A statement that cannot be written -- an UPFRONT buyer whose wallet does not
 * reconcile -- is reported with the reason and the exit code is 1; every other
 * party's statement is still written.
 */

import { getPrismaClient } from '../lib/prisma.js';
import {
  currentMonth,
  isStatementMonth,
  previousMonth,
} from '../services/statements/statement-month.js';
import { closeMonth } from '../services/statements/statements.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const rebuild = args.includes('--rebuild');
  const positional = args.filter(arg => !arg.startsWith('--'));

  const month = positional[0] ?? previousMonth(currentMonth());
  if (!isStatementMonth(month)) {
    console.error(`The month must be YYYY-MM, got ${JSON.stringify(month)}`);
    process.exitCode = 1;
    return;
  }

  const prisma = getPrismaClient();
  const result = await closeMonth(prisma, month, { rebuild });

  console.log(
    `Statements for ${result.month}: ${result.written} written, ${result.skipped} already closed` +
      (rebuild ? ' (rebuild)' : '') +
      `, ${result.errors.length} failed.`
  );
  for (const failure of result.errors) {
    console.error(
      `  FAILED ${failure.party.partyType} ${failure.party.partyId} (tenant ${failure.party.tenantId}): ${failure.message}`
    );
  }
  if (result.errors.length > 0) process.exitCode = 1;
}

main()
  .catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    void getPrismaClient().$disconnect();
  });
