#!/usr/bin/env tsx
/**
 * CLI tool to pull the Anveo account's DIDs into `phone_numbers`.
 *
 * The Numbers page lists that table and nothing else, so a DID bought in the
 * Anveo portal instead of through the product never appeared there. This is the
 * same reconciliation POST /api/v1/anveo/sync performs, for an operator who has
 * database and Anveo credentials but no session in the app.
 *
 * Usage: tsx src/cli/numbers-sync-anveo.ts --tenant=<tenantId> [--did-type=GEOGRAPHIC]
 */

import 'dotenv-flow/config';

import { getPrismaClient } from '../lib/prisma.js';
import { syncAnveoNumbers } from '../services/provisioning/anveo-sync.js';

interface SyncOptions {
  tenantId: string;
  didType?: string;
}

async function run(options: SyncOptions): Promise<void> {
  const prisma = getPrismaClient();

  // A wrong tenant id here files the whole account's inventory under a tenant
  // that does not own it, so confirm it exists before spending the API call.
  const tenant = await prisma.tenant.findUnique({
    where: { id: options.tenantId },
    select: { id: true, name: true },
  });

  if (!tenant) {
    console.error(`❌ Tenant not found: ${options.tenantId}`);
    process.exit(1);
  }

  console.log(`Syncing Anveo DIDs into tenant ${tenant.name} (${tenant.id})...`);

  const result = await syncAnveoNumbers(tenant.id, { didType: options.didType });

  console.log('');
  console.log(`📞 Anveo reported ${result.found} DID(s) on the account`);
  console.log(`   created:   ${result.created}`);
  console.log(`   updated:   ${result.updated}`);
  console.log(`   unchanged: ${result.unchanged}`);
  console.log(
    `   carrier:   ${result.carrier ? `${result.carrier.name} (${result.carrier.id})` : 'none linked — set Carrier.numberProvider = "anveo" to group these under a carrier'}`
  );
  console.log('');

  for (const n of result.numbers) {
    const where = [n.areaName, n.areaCode].filter(Boolean).join(' ');
    console.log(`   ${n.action.padEnd(9)} ${n.number}${where ? `  (${where})` : ''}`);
  }
}

const options: Partial<SyncOptions> = {};

for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('--tenant=')) {
    options.tenantId = arg.split('=')[1];
  } else if (arg.startsWith('--did-type=')) {
    options.didType = arg.split('=')[1];
  }
}

if (!options.tenantId) {
  console.error(
    'Usage: tsx src/cli/numbers-sync-anveo.ts --tenant=<tenantId> [--did-type=GEOGRAPHIC]'
  );
  console.error('\nOptions:');
  console.error('  --tenant=ID        Tenant the DIDs are filed under (required)');
  console.error('  --did-type=TYPE    Optional Anveo DID type filter (GEOGRAPHIC, TOLLFREE, ...)');
  console.error(
    '\nRequires ANVEO_API_KEY, ANVEO_EMAIL and ANVEO_SECURE_PHRASE in the environment.'
  );
  process.exit(1);
}

run(options as SyncOptions)
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Anveo sync failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
