#!/usr/bin/env tsx
/**
 * CLI tool to import phone numbers from CSV
 * Usage: tsx src/cli/numbers-import.ts --file=numbers.csv
 */

import 'dotenv-flow/config';
import { readFileSync } from 'fs';

import { parse } from 'csv-parse/sync';

import { getPrismaClient } from '../lib/prisma.js';
import type { Provider } from '../services/provisioning/types.js';

interface ImportOptions {
  file: string;
  skipHeader?: boolean;
  numberColumn?: number;
  tenantColumn?: number;
  campaignColumn?: number;
  providerColumn?: number;
}

function normalizePhoneNumber(phoneNumber: string): string {
  // Remove all non-digit characters except +
  let normalized = phoneNumber.replace(/[^\d+]/g, '');

  // If doesn't start with +, assume US number and add +1
  if (!normalized.startsWith('+')) {
    if (normalized.length === 10) {
      normalized = `+1${normalized}`;
    } else if (normalized.length === 11 && normalized.startsWith('1')) {
      normalized = `+${normalized}`;
    }
  }

  return normalized;
}

async function importNumbers(options: ImportOptions) {
  const prisma = getPrismaClient();

  console.log(`Importing phone numbers from ${options.file}...`);

  // Read file
  const fileContent = readFileSync(options.file, 'utf-8');

  // Parse CSV
  const records = parse(fileContent, {
    skip_empty_lines: true,
    columns: options.skipHeader !== false,
  });

  console.log(`Found ${records.length} records to import`);

  // Import in batches
  const batchSize = 100;
  let imported = 0;
  let skipped = 0;
  const errors: Array<{ row: number; error: string }> = [];

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);

    await Promise.all(
      batch.map(async (record: any, index: number) => {
        const rowNum = i + index + 1;
        try {
          // Extract fields
          const number = options.numberColumn !== undefined
            ? record[Object.keys(record)[options.numberColumn]]
            : record.number || record.phone || record.phoneNumber || record[0];

          const tenantId = options.tenantColumn !== undefined
            ? record[Object.keys(record)[options.tenantColumn]]
            : record.tenantId || record.tenant_id || record.tenant || record[1];

          const campaignId = options.campaignColumn !== undefined
            ? record[Object.keys(record)[options.campaignColumn]]
            : record.campaignId || record.campaign_id || record.campaign || record[2];

          const provider = options.providerColumn !== undefined
            ? record[Object.keys(record)[options.providerColumn]]
            : record.provider || record[3] || 'local';

          if (!number) {
            throw new Error('Phone number is required');
          }

          const normalizedNumber = normalizePhoneNumber(number);
          const validProvider = (['local', 'signalwire', 'telnyx', 'bandwidth', 'clec'] as Provider[]).includes(provider as Provider)
            ? (provider as Provider)
            : 'local';

          // Check if tenant exists
          if (tenantId) {
            const tenant = await prisma.tenant.findUnique({
              where: { id: tenantId },
            });
            if (!tenant) {
              throw new Error(`Tenant not found: ${tenantId}`);
            }
          }

          // Check if campaign exists
          if (campaignId && tenantId) {
            const campaign = await prisma.campaign.findFirst({
              where: {
                id: campaignId,
                tenantId: tenantId,
              },
            });
            if (!campaign) {
              throw new Error(`Campaign not found: ${campaignId}`);
            }
          }

          // Create or update phone number
          await prisma.phoneNumber.upsert({
            where: {
              tenantId_number: {
                tenantId: tenantId || '00000000-0000-0000-0000-000000000000',
                number: normalizedNumber,
              },
            },
            create: {
              tenantId: tenantId || '00000000-0000-0000-0000-000000000000',
              number: normalizedNumber,
              campaignId: campaignId || null,
              provider: validProvider,
              status: 'ACTIVE',
              capabilities: { voice: true },
              metadata: {
                importedAt: new Date().toISOString(),
                source: 'csv_import',
              },
              purchasedAt: new Date(),
            },
            update: {
              campaignId: campaignId || undefined,
              provider: validProvider,
              metadata: {
                importedAt: new Date().toISOString(),
                source: 'csv_import',
              },
            },
          });

          imported++;
        } catch (error) {
          skipped++;
          const errorMsg = error instanceof Error ? error.message : String(error);
          errors.push({ row: rowNum, error: errorMsg });
          console.error(`Row ${rowNum}: ${errorMsg}`);
        }
      })
    );

    console.log(`Processed ${Math.min(i + batchSize, records.length)}/${records.length} records...`);
  }

  console.log(`\n✅ Import complete:`);
  console.log(`   Imported: ${imported}`);
  console.log(`   Skipped: ${skipped}`);
  
  if (errors.length > 0) {
    console.log(`\n❌ Errors:`);
    errors.slice(0, 10).forEach(({ row, error }) => {
      console.log(`   Row ${row}: ${error}`);
    });
    if (errors.length > 10) {
      console.log(`   ... and ${errors.length - 10} more errors`);
    }
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const options: Partial<ImportOptions> = {};

for (const arg of args) {
  if (arg.startsWith('--file=')) {
    options.file = arg.split('=')[1];
  } else if (arg === '--skip-header') {
    options.skipHeader = true;
  } else if (arg.startsWith('--number-column=')) {
    options.numberColumn = parseInt(arg.split('=')[1], 10);
  } else if (arg.startsWith('--tenant-column=')) {
    options.tenantColumn = parseInt(arg.split('=')[1], 10);
  } else if (arg.startsWith('--campaign-column=')) {
    options.campaignColumn = parseInt(arg.split('=')[1], 10);
  } else if (arg.startsWith('--provider-column=')) {
    options.providerColumn = parseInt(arg.split('=')[1], 10);
  }
}

if (!options.file) {
  console.error('Usage: tsx src/cli/numbers-import.ts --file=numbers.csv [options]');
  console.error('\nOptions:');
  console.error('  --skip-header            Skip first line (CSV header)');
  console.error('  --number-column=N        Column index for phone number (default: auto-detect)');
  console.error('  --tenant-column=N        Column index for tenant ID (default: auto-detect)');
  console.error('  --campaign-column=N      Column index for campaign ID (default: auto-detect)');
  console.error('  --provider-column=N      Column index for provider (default: auto-detect or "local")');
  console.error('\nCSV Format:');
  console.error('  number,tenant_id,campaign_id,provider');
  console.error('  +15551234567,t_123,c_abc,signalwire');
  process.exit(1);
}

importNumbers(options as ImportOptions)
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('Import failed:', error);
    process.exit(1);
  });

