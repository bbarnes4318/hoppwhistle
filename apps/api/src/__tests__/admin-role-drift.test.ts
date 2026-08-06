import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * `isAdminOrOwner` must mean ADMIN or OWNER. Nothing else.
 *
 * Four copies of this check had independently drifted to also accept AGENT:
 * two in routes/index.ts (the reporting surface — campaign profitability,
 * reconciliation, buyer costs, publisher revenue) and two across the billing
 * routes (rate cards, buyer wallets and transactions). Every one of them is
 * consumed as `if (!isAdminOrOwner) return 403`, and one sits directly above an
 * error message that reads "Admin access required".
 *
 * The checks are duplicated by hand in half a dozen files, so a review of any
 * single one cannot catch the next drift. This test reads the source instead,
 * and fails on any admin check that admits a non-admin role.
 */

const ROUTES_DIR = join(__dirname, '..', 'routes');

/** Roles that may never satisfy an admin-or-owner check. */
const NEVER_ADMIN = ['AGENT', 'READONLY', 'PUBLISHER', 'BUYER'];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Each `isAdminOrOwner = ...` assignment, flattened to a single line and cut at
 * the end of the expression, so a multi-line definition is still one string.
 */
function adminChecks(source: string): string[] {
  const flat = source.replace(/\s+/g, ' ');
  return [...flat.matchAll(/isAdminOrOwner\s*=\s*(.*?);/g)].map(m => m[1]);
}

describe('isAdminOrOwner never admits a non-admin role', () => {
  const files = sourceFiles(ROUTES_DIR);

  it('finds the admin checks it is meant to be guarding', () => {
    // Guards the test itself: a refactor that renames the variable would
    // otherwise make this suite vacuously pass.
    const total = files.reduce((n, f) => n + adminChecks(readFileSync(f, 'utf8')).length, 0);
    expect(total).toBeGreaterThan(0);
  });

  it.each(NEVER_ADMIN)('never treats %s as admin or owner', role => {
    const offenders: string[] = [];

    for (const file of files) {
      for (const check of adminChecks(readFileSync(file, 'utf8'))) {
        if (check.includes(`'${role}'`) || check.includes(`"${role}"`)) {
          offenders.push(`${file.split(/[\\/]/).pop()}: ${check.slice(0, 120)}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
