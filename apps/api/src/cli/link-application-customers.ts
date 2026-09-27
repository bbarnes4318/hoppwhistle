/**
 * `pnpm applications:link-customers [--tenant <id>]` -- give every submitted
 * application its customer record.
 *
 * Runs `linkApplicationCustomer` (services/applications/customer-link.ts) for
 * each submitted application with no `insuranceLeadId`: the writing agent's
 * customer on that phone, else the agency's unassigned one, else a new sold
 * customer. Run once after the deploy that added it; the Applications page
 * does the same thing row by row on click, so this only saves the first click.
 *
 * Idempotent: a linked application is not selected again, so a second run
 * reports nothing to do. Applications with no phone are skipped and counted.
 */

import { getPrismaClient } from '../lib/prisma.js';
import { backfillApplicationCustomers } from '../services/applications/customer-link.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const tenantFlag = args.indexOf('--tenant');
  const tenantId = tenantFlag >= 0 ? args[tenantFlag + 1] : undefined;

  const counts = await backfillApplicationCustomers(getPrismaClient(), { tenantId });

  console.log(
    `Applications: ${counts.linked + counts.existing} linked to an existing customer, ` +
      `${counts.created} customers created, ` +
      `${counts.skippedNoPhone} skipped (no phone)` +
      (tenantId ? ` for tenant ${tenantId}` : '') +
      '.'
  );
}

main()
  .catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    void getPrismaClient().$disconnect();
  });
