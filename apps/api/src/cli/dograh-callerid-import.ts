#!/usr/bin/env tsx
/**
 * Import Dograh state-matched caller-ID DIDs into the canonical PhoneNumber
 * inventory + the "Dograh State Caller IDs" pool. Dry-run by default.
 *
 * Usage:
 *   tsx src/cli/dograh-callerid-import.ts --file=../data/dograh-state-caller-ids.csv \
 *       --tenant=<tenantId> [--provider=fractel] [--apply]
 */

import 'dotenv-flow/config';
import { readFileSync } from 'fs';

import { parse } from 'csv-parse/sync';

import { getPrismaClient } from '../lib/prisma.js';
import { runImport, type ImportRow } from '../services/dograh-caller-id-import.js';

const args = process.argv.slice(2);
const getArg = (name: string): string | undefined =>
  args
    .find(a => a.startsWith(`--${name}=`))
    ?.split('=')
    .slice(1)
    .join('=');

const file = getArg('file');
const tenantArg = getArg('tenant');
const provider = getArg('provider') || 'fractel';
const apply = args.includes('--apply');

if (!file) {
  console.error(
    'Usage: tsx src/cli/dograh-callerid-import.ts --file=numbers.csv --tenant=<tenantId> [--provider=fractel] [--apply]'
  );
  console.error('Dry-run by default; pass --apply to write.');
  process.exit(1);
}

async function main() {
  const prisma = getPrismaClient();

  let tenantId = tenantArg;
  if (!tenantId) {
    const tenants = await prisma.tenant.findMany({ select: { id: true, slug: true } });
    if (tenants.length === 1) {
      tenantId = tenants[0].id;
      console.log(`No --tenant given; using sole tenant ${tenantId} (${tenants[0].slug})`);
    } else {
      console.error(
        `--tenant is required (found ${tenants.length} tenants: ${tenants
          .map(t => `${t.id}[${t.slug}]`)
          .join(', ')})`
      );
      process.exit(1);
    }
  }

  const content = readFileSync(file!, 'utf-8');
  const records = parse(content, { skip_empty_lines: true, columns: true }) as Array<
    Record<string, string>
  >;
  const rows: ImportRow[] = records.map(r => ({ number: r.number, state: r.state }));

  const result = await runImport(rows, {
    tenantId: tenantId,
    provider,
    dryRun: !apply,
    prismaClient: prisma,
  });

  console.log(JSON.stringify(result, null, 2));
  const okTotal = result.inserted + result.updated + result.alreadyCorrect;
  console.log(
    `\n${result.dryRun ? '[DRY RUN] ' : ''}supplied=${result.totalSupplied} valid=${result.valid.length} ` +
      `ok=${okTotal} (inserted=${result.inserted} updated=${result.updated} unchanged=${result.alreadyCorrect}) ` +
      `rejected=${result.rejected.length} duplicates=${result.duplicates.length}` +
      (result.dbConfirmedPoolTotal !== null
        ? ` dbConfirmedPoolTotal=${result.dbConfirmedPoolTotal}`
        : '')
  );
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Import failed:', err);
    process.exit(1);
  });
