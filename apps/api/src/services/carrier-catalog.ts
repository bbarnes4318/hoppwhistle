import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { logger } from '../lib/logger.js';
import { getPrismaClient } from '../lib/prisma.js';

/**
 * Make sure every tenant has the carrier catalog behind Settings → Carrier
 * Routing.
 *
 * ── Why this runs at boot rather than in a migration ────────────────────────
 *
 * Nothing in this repository runs `prisma/migrations/*∕migration.sql` except
 * scripts/deploy-netenroll.sh, and only for the files named in its
 * REQUIRED_MIGRATIONS list. `prisma migrate deploy` is refused outright
 * (apps/api/scripts/refuse-migrate-deploy.sh), and CI and every fresh checkout
 * build with `prisma db push`, which never reads a migration.
 *
 * Twilio and Vonage were added as a data-only migration and were therefore
 * invisible on every database, including production. Adding the SQL file to
 * the deploy script fixed the deploys that use it -- but this platform is
 * deployed with Coolify, which builds an image and runs it, and never invokes
 * that script either.
 *
 * So the only mechanism that reaches every environment is the application
 * itself. The API carries `prisma/` in its image (see apps/api/Dockerfile), so
 * the same file the deploy script applies is on disk in the container.
 *
 * ── Safety ──────────────────────────────────────────────────────────────────
 *
 * The SQL is append-only by construction -- every statement is ON CONFLICT DO
 * NOTHING or guarded by NOT EXISTS -- so this adds what is missing and changes
 * nothing that is there. A carrier order, an enabled/disabled choice, a tech
 * prefix and a caller-ID strategy all survive every boot untouched, and new
 * carriers land disabled, so a restart never moves a call.
 *
 * It is also never allowed to stop the API starting. Routing degrades to the
 * legacy chain without it; refusing to serve would be far worse than a page
 * that is missing a row.
 */

/** `off`/`0`/`false` disables it, for an operator who wants the boot quiet. */
function isEnabled(): boolean {
  const raw = (process.env.CARRIER_CATALOG_BOOTSTRAP ?? '').trim().toLowerCase();
  return !['off', '0', 'false', 'no'].includes(raw);
}

/**
 * The catalog file, in the built image and in a source checkout.
 *
 * `dist/services/…` and `src/services/…` are both two levels under the package
 * root, so one relative path covers both; the extra candidates are there so a
 * flattened build does not silently skip the bootstrap.
 */
function candidatePaths(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  return [
    join(here, '..', '..', 'prisma', 'sql', 'carrier-catalog.sql'),
    join(here, '..', 'prisma', 'sql', 'carrier-catalog.sql'),
    join(process.cwd(), 'prisma', 'sql', 'carrier-catalog.sql'),
    join(process.cwd(), 'apps', 'api', 'prisma', 'sql', 'carrier-catalog.sql'),
  ];
}

async function readCatalog(): Promise<{ sql: string; path: string } | null> {
  for (const path of candidatePaths()) {
    try {
      return { sql: await readFile(path, 'utf8'), path };
    } catch {
      // Next candidate. A missing file is not an error until all of them are.
    }
  }
  return null;
}

/**
 * Split the file into statements.
 *
 * Comment lines go first so that a `;` inside prose can never end a statement,
 * which is the one way a naive split on `;` gets this wrong.
 */
export function splitStatements(sql: string): string[] {
  return sql
    .split('\n')
    .filter(line => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map(statement => statement.trim())
    .filter(statement => statement.length > 0);
}

export async function ensureCarrierCatalog(): Promise<void> {
  if (!isEnabled()) {
    logger.info({ msg: '[carrier-catalog] disabled by CARRIER_CATALOG_BOOTSTRAP' });
    return;
  }

  const catalog = await readCatalog();
  if (!catalog) {
    logger.warn({
      msg: '[carrier-catalog] carrier-catalog.sql not found; skipping',
      looked: candidatePaths(),
    });
    return;
  }

  const prisma = getPrismaClient();

  // A database that has not been built yet is not a failure to report loudly:
  // the tables arrive with `db push`, and the next boot picks them up.
  const [{ present }] = await prisma.$queryRawUnsafe<Array<{ present: boolean }>>(
    `SELECT to_regclass('public.carriers') IS NOT NULL AS present`
  );
  if (!present) {
    logger.warn({ msg: '[carrier-catalog] carriers table absent; skipping' });
    return;
  }

  const statements = splitStatements(catalog.sql);
  await prisma.$transaction(async tx => {
    for (const statement of statements) {
      await tx.$executeRawUnsafe(statement);
    }
  });

  const [{ count }] = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT count(*)::bigint AS count FROM "carriers" WHERE "code" IN ('TWILIO', 'VONAGE')`
  );

  logger.info({
    msg: '[carrier-catalog] catalog ensured',
    source: catalog.path,
    statements: statements.length,
    twilioAndVonageRows: Number(count),
  });
}
