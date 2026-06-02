#!/usr/bin/env tsx
import 'dotenv-flow/config';
import { getPrismaClient } from '../lib/prisma.js';
import { billingService } from '../services/billing-service.js';

async function main() {
  const args = process.argv.slice(2);
  const helpArg = args.includes('--help') || args.includes('-h');

  if (helpArg) {
    console.log(`
Usage: tsx src/cli/recalculate-call-billing.ts [options]

Options:
  --tenant-id=ID       Tenant ID (required)
  --start-date=DATE    Start date in YYYY-MM-DD format (default: 30 days ago)
  --end-date=DATE      End date in YYYY-MM-DD format (default: now)
  --campaign-id=ID     Filter by Campaign ID (optional)
  --dry-run            Dry run simulation mode (do not commit changes to DB)
  --help, -h           Show this help message
`);
    process.exit(0);
  }

  const tenantIdArg = args.find(a => a.startsWith('--tenant-id='));
  const startDateArg = args.find(a => a.startsWith('--start-date='));
  const endDateArg = args.find(a => a.startsWith('--end-date='));
  const campaignIdArg = args.find(a => a.startsWith('--campaign-id='));
  const dryRun = args.includes('--dry-run') || args.includes('--dryRun');

  if (!tenantIdArg) {
    console.error('Error: --tenant-id=ID is required');
    process.exit(1);
  }

  const tenantId = tenantIdArg.split('=')[1];
  const campaignId = campaignIdArg ? campaignIdArg.split('=')[1] : undefined;

  let startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  if (startDateArg) {
    startDate = new Date(startDateArg.split('=')[1]);
  }

  let endDate = new Date();
  if (endDateArg) {
    endDate = new Date(endDateArg.split('=')[1]);
  }

  console.log(`Starting call billing recalculation...`);
  console.log(`  Tenant: ${tenantId}`);
  console.log(`  Start Date: ${startDate.toISOString()}`);
  console.log(`  End Date: ${endDate.toISOString()}`);
  if (campaignId) console.log(`  Campaign: ${campaignId}`);
  console.log(`  Mode: ${dryRun ? 'DRY RUN (Simulation)' : 'LIVE RUN (Writing to Database)'}`);

  const prisma = getPrismaClient();

  try {
    const results = await billingService.recalculateBillingForDateRange({
      tenantId,
      startDate,
      endDate,
      campaignId,
      dryRun,
    });

    console.log(`\n=================== SUMMARY ===================`);
    console.log(`Total Calls Scanned:       ${results.scanned}`);
    console.log(`Total Calls Updated:       ${results.updated}`);
    console.log(`Billable Calls:            ${results.billable}`);
    console.log(`Non-Billable Calls:        ${results.nonBillable}`);
    console.log(`Total Buyer Revenue:       $${results.totalRevenue}`);
    console.log(`Total Publisher Payout:    $${results.totalPayout}`);
    console.log(`Total Profit:              $${results.totalProfit}`);
    console.log(`===============================================`);

    if (results.changes.length > 0) {
      console.log(`\nChanges detected (${results.changes.length} calls):`);
      for (const change of results.changes) {
        console.log(`Call ID: ${change.callId} (${change.callSid})`);
        console.log(`  Before: Billable: ${change.before.billable}, Revenue: $${change.before.revenue}, Payout: $${change.before.payout}`);
        console.log(`  After:  Billable: ${change.after.billable}, Revenue: $${change.after.revenue}, Payout: $${change.after.payout}`);
      }
    } else {
      console.log(`\nNo billing changes detected.`);
    }

  } catch (error) {
    console.error('Error during recalculation:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
