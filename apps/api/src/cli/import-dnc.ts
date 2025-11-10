#!/usr/bin/env tsx
/**
 * CLI tool to import DNC list entries from CSV or text file
 * Usage: tsx src/cli/import-dnc.ts --tenant-id=xxx --list-id=xxx --file=dnc.csv
 */

import 'dotenv-flow/config';
import { readFileSync } from 'fs';

import { parse } from 'csv-parse/sync';

import { getPrismaClient } from '../lib/prisma.js';

interface ImportOptions {
  tenantId: string;
  listId: string;
  file: string;
  format?: 'csv' | 'txt';
  skipHeader?: boolean;
  phoneColumn?: number;
  reasonColumn?: number;
  sourceColumn?: number;
}

async function importDnc(options: ImportOptions) {
  const prisma = getPrismaClient();

  console.log(`Importing DNC entries from ${options.file}...`);

  // Read file
  const fileContent = readFileSync(options.file, 'utf-8');
  
  let entries: Array<{ phoneNumber: string; reason?: string; source?: string }> = [];

  if (options.format === 'csv' || options.file.endsWith('.csv')) {
    // Parse CSV
    const records = parse(fileContent, {
      skip_empty_lines: true,
      columns: options.skipHeader !== false,
    });

    entries = records.map((record: any, index: number) => {
      const phoneNumber = options.phoneColumn !== undefined
        ? record[Object.keys(record)[options.phoneColumn]]
        : record.phoneNumber || record.phone || record.number || record[0];

      const reason = options.reasonColumn !== undefined
        ? record[Object.keys(record)[options.reasonColumn]]
        : record.reason || record[1];

      const source = options.sourceColumn !== undefined
        ? record[Object.keys(record)[options.sourceColumn]]
        : record.source || record[2];

      return {
        phoneNumber: normalizePhoneNumber(phoneNumber),
        reason: reason || undefined,
        source: source || undefined,
      };
    });
  } else {
    // Parse text file (one phone number per line)
    entries = fileContent
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => ({
        phoneNumber: normalizePhoneNumber(line),
      }));
  }

  console.log(`Found ${entries.length} entries to import`);

  // Import in batches
  const batchSize = 1000;
  let imported = 0;
  let skipped = 0;

  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);

    await Promise.all(
      batch.map(async (entry) => {
        try {
          await prisma.dncListEntry.upsert({
            where: {
              dncListId_phoneNumber: {
                dncListId: options.listId,
                phoneNumber: entry.phoneNumber,
              },
            },
            create: {
              dncListId: options.listId,
              phoneNumber: entry.phoneNumber,
              reason: entry.reason,
              source: entry.source,
            },
            update: {
              reason: entry.reason,
              source: entry.source,
            },
          });
          imported++;
        } catch (error) {
          console.error(`Failed to import ${entry.phoneNumber}:`, error);
          skipped++;
        }
      })
    );

    console.log(`Processed ${Math.min(i + batchSize, entries.length)}/${entries.length} entries...`);
  }

  console.log(`\n✅ Import complete:`);
  console.log(`   Imported: ${imported}`);
  console.log(`   Skipped: ${skipped}`);
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

// Parse command line arguments
const args = process.argv.slice(2);
const options: Partial<ImportOptions> = {};

for (const arg of args) {
  if (arg.startsWith('--tenant-id=')) {
    options.tenantId = arg.split('=')[1];
  } else if (arg.startsWith('--list-id=')) {
    options.listId = arg.split('=')[1];
  } else if (arg.startsWith('--file=')) {
    options.file = arg.split('=')[1];
  } else if (arg.startsWith('--format=')) {
    options.format = arg.split('=')[1] as 'csv' | 'txt';
  } else if (arg === '--skip-header') {
    options.skipHeader = true;
  } else if (arg.startsWith('--phone-column=')) {
    options.phoneColumn = parseInt(arg.split('=')[1], 10);
  } else if (arg.startsWith('--reason-column=')) {
    options.reasonColumn = parseInt(arg.split('=')[1], 10);
  } else if (arg.startsWith('--source-column=')) {
    options.sourceColumn = parseInt(arg.split('=')[1], 10);
  }
}

if (!options.tenantId || !options.listId || !options.file) {
  console.error('Usage: tsx src/cli/import-dnc.ts --tenant-id=xxx --list-id=xxx --file=dnc.csv [options]');
  console.error('\nOptions:');
  console.error('  --format=csv|txt          File format (default: auto-detect)');
  console.error('  --skip-header            Skip first line (CSV header)');
  console.error('  --phone-column=N         Column index for phone number (CSV)');
  console.error('  --reason-column=N         Column index for reason (CSV)');
  console.error('  --source-column=N         Column index for source (CSV)');
  process.exit(1);
}

importDnc(options as ImportOptions)
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('Import failed:', error);
    process.exit(1);
  });

