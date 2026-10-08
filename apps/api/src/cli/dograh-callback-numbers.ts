#!/usr/bin/env tsx
/**
 * Mark the numbers whose callbacks go to the Dograh AI agent. Dry-run by default.
 *
 * The file is the list deploy/dograh/inbound-callback/install_inbound_callback.py
 * writes: one number per line, exactly the numbers Dograh has an inbound agent
 * on. Numbers no longer in the list are unmarked; an empty file unmarks all.
 * See services/dograh-callback-routing.ts.
 *
 * Usage:
 *   tsx src/cli/dograh-callback-numbers.ts --file=numbers.txt [--apply]
 *
 * In the production image (no tsx): node dist/cli/dograh-callback-numbers.js ...
 */

import 'dotenv-flow/config';
import { readFileSync } from 'fs';

import { getPrismaClient } from '../lib/prisma.js';
import { markDograhCallbackNumbers } from '../services/dograh-callback-routing.js';

const args = process.argv.slice(2);
const file = args.find(a => a.startsWith('--file='))?.slice('--file='.length);
const apply = args.includes('--apply');

if (!file) {
  console.error('Usage: dograh-callback-numbers --file=numbers.txt [--apply]');
  process.exit(1);
}

async function main() {
  const numbers = readFileSync(file!, 'utf-8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  const result = await markDograhCallbackNumbers(numbers, {
    apply,
    prismaClient: getPrismaClient(),
  });

  console.log(
    `${apply ? '' : '[DRY RUN] '}AI callback numbers: ${numbers.length} from Dograh, ` +
      `marked=${result.marked} alreadyMarked=${result.alreadyMarked} unmarked=${result.unmarked} ` +
      `notInHopwhistle=${result.notInHopwhistle.length}`
  );
  if (result.notInHopwhistle.length > 0) {
    console.log(
      'Not in Hopwhistle (calls to these are not routed at all yet): ' +
        result.notInHopwhistle.slice(0, 20).join(', ') +
        (result.notInHopwhistle.length > 20 ? ', …' : '')
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Marking failed:', err);
    process.exit(1);
  });
