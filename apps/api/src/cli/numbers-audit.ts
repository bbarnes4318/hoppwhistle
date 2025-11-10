#!/usr/bin/env tsx
/**
 * CLI tool to audit phone number inventory
 * Usage: tsx src/cli/numbers-audit.ts --provider=signalwire [--tenant=t_123]
 */

import 'dotenv-flow/config';
import { provisioningService } from '../services/provisioning/provisioning-service.js';
import type { Provider } from '../services/provisioning/types.js';

interface AuditOptions {
  provider: Provider;
  tenantId?: string;
}

async function auditInventory(options: AuditOptions) {
  console.log(`Auditing inventory for provider: ${options.provider}`);
  if (options.tenantId) {
    console.log(`Tenant filter: ${options.tenantId}`);
  }
  console.log('');

  try {
    const result = await provisioningService.auditInventory(
      options.provider,
      options.tenantId
    );

    console.log(`📊 Audit Results:`);
    console.log(`   Local numbers: ${result.localNumbers.length}`);
    console.log(`   Provider numbers: ${result.providerNumbers.length}`);
    console.log('');

    // Discrepancies
    const { discrepancies } = result;

    if (discrepancies.missingInProvider.length > 0) {
      console.log(`⚠️  Missing in Provider (${discrepancies.missingInProvider.length}):`);
      discrepancies.missingInProvider.slice(0, 10).forEach((num) => {
        console.log(`   - ${num.number} (${num.id})`);
      });
      if (discrepancies.missingInProvider.length > 10) {
        console.log(`   ... and ${discrepancies.missingInProvider.length - 10} more`);
      }
      console.log('');
    }

    if (discrepancies.missingInLocal.length > 0) {
      console.log(`⚠️  Missing in Local DB (${discrepancies.missingInLocal.length}):`);
      discrepancies.missingInLocal.slice(0, 10).forEach((num) => {
        console.log(`   - ${num.number} (${num.providerId})`);
      });
      if (discrepancies.missingInLocal.length > 10) {
        console.log(`   ... and ${discrepancies.missingInLocal.length - 10} more`);
      }
      console.log('');
    }

    if (discrepancies.statusMismatch.length > 0) {
      console.log(`⚠️  Status Mismatches (${discrepancies.statusMismatch.length}):`);
      discrepancies.statusMismatch.slice(0, 10).forEach(({ local, provider }) => {
        console.log(`   - ${local.number}: local=${local.status}, provider=${provider.status}`);
      });
      if (discrepancies.statusMismatch.length > 10) {
        console.log(`   ... and ${discrepancies.statusMismatch.length - 10} more`);
      }
      console.log('');
    }

    if (
      discrepancies.missingInProvider.length === 0 &&
      discrepancies.missingInLocal.length === 0 &&
      discrepancies.statusMismatch.length === 0
    ) {
      console.log('✅ No discrepancies found. Inventory is in sync!');
    } else {
      console.log('❌ Discrepancies found. Review the output above.');
      process.exit(1);
    }
  } catch (error) {
    console.error('Audit failed:', error);
    process.exit(1);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const options: Partial<AuditOptions> = {};

for (const arg of args) {
  if (arg.startsWith('--provider=')) {
    options.provider = arg.split('=')[1] as Provider;
  } else if (arg.startsWith('--tenant=')) {
    options.tenantId = arg.split('=')[1];
  }
}

if (!options.provider) {
  console.error('Usage: tsx src/cli/numbers-audit.ts --provider=signalwire [--tenant=t_123]');
  console.error('\nOptions:');
  console.error('  --provider=PROVIDER      Provider to audit (local, signalwire, telnyx, bandwidth)');
  console.error('  --tenant=ID              Optional tenant ID filter');
  console.error('\nAvailable providers:');
  const available = provisioningService.getAvailableProviders();
  available.forEach((p) => console.error(`   - ${p}`));
  process.exit(1);
}

auditInventory(options as AuditOptions)
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('Audit failed:', error);
    process.exit(1);
  });

