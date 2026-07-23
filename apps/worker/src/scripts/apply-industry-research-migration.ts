import 'dotenv-flow/config';
import { readFileSync } from 'fs';
import { join } from 'path';

import { PrismaClient } from '@prisma/client';

// Idempotently apply ONLY the industry-research additive tables. Does not run
// `prisma migrate deploy` (which would apply unrelated pending migrations to a
// shared DB). Safe to re-run: skips if the tables already exist.

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.$queryRawUnsafe<Array<{ reg: string | null }>>(
    `SELECT to_regclass('public.research_runs')::text AS reg`
  );
  if (existing[0]?.reg) {
    console.log('research_runs already exists — migration already applied. Skipping.');
    await prisma.$disconnect();
    return;
  }

  const sqlPath = join(
    process.cwd(),
    '..',
    'api',
    'prisma',
    'migrations',
    '20260718000000_add_industry_research',
    'migration.sql'
  );
  const sql = readFileSync(sqlPath, 'utf8');
  const statements = sql
    .split(';')
    .map((s) => s.replace(/--.*$/gm, '').trim())
    .filter((s) => s.length > 0);

  console.log(`Applying ${statements.length} statements…`);
  for (const stmt of statements) {
    await prisma.$executeRawUnsafe(stmt);
  }

  const check = await prisma.$queryRawUnsafe<Array<{ reg: string | null }>>(
    `SELECT to_regclass('public.research_runs')::text AS reg`
  );
  console.log('Applied. research_runs present:', Boolean(check[0]?.reg));
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('Migration apply failed:', e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exit(1);
});
