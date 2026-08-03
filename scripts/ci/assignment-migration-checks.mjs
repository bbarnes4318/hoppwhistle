#!/usr/bin/env node
/**
 * Database-side verification for the campaign-agent assignment migration.
 *
 * Lives in a file rather than inline in the workflow because these are real
 * assertions with real logic, and YAML-embedded `node -e` blocks cannot be
 * linted, cannot be run locally, and quote-escape into something nobody can
 * review.
 *
 * ── Why rows are seeded generically ──────────────────────────────────────────
 *
 * The first version hand-wrote the INSERTs and guessed at column names. It
 * failed in CI with `column "role" of relation "users" does not exist` — `User`
 * has no `role` column, it has a `roles` relation. Guessing at another schema's
 * columns from inside a migration check is a fragile way to prove anything, and
 * it fails for a reason that has nothing to do with the migration under test.
 *
 * So the seeder reads `information_schema` and fills exactly the columns the
 * database says are required: NOT NULL, no default. It stays correct when the
 * referenced tables change, which they will.
 *
 * Usage: node scripts/ci/assignment-migration-checks.mjs <command>
 *   at-base-state | objects-exist | duplicate-rejected
 *   rollback-clean | reapplied | columns-match
 */

import pg from 'pg';

const { Client } = pg;
const command = process.argv[2];

const REQUIRED_INDEXES = [
  'campaign_agents_tenantId_userId_status_idx',
  'campaign_agents_tenantId_campaignId_userId_key',
  'campaign_agents_tenantId_idx',
  'campaign_agents_campaignId_idx',
  'campaign_agents_userId_idx',
];

/** Columns the model declares, with the nullability the database should hold. */
const EXPECTED_COLUMNS = [
  'campaignId:NO',
  'createdAt:NO',
  'id:NO',
  'priority:YES',
  'status:NO',
  'tenantId:NO',
  'updatedAt:NO',
].join(',');

const client = new Client({ connectionString: process.env.DATABASE_URL });

function fail(message) {
  process.stdout.write(`::error::${message}\n`);
  process.exitCode = 1;
  throw new Error(message);
}

/**
 * Insert one row into `table`, filling every column the DATABASE says is
 * required, and nothing else. Values are synthetic and typed from the column's
 * own data type, so this does not need to know the model.
 */
async function seedRow(table, id, overrides = {}) {
  const { rows } = await client.query(
    `SELECT column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [table]
  );

  const cols = [];
  const vals = [];
  for (const c of rows) {
    const required = c.is_nullable === 'NO' && c.column_default === null;
    const overridden = Object.prototype.hasOwnProperty.call(overrides, c.column_name);
    if (!required && !overridden) continue;

    cols.push(`"${c.column_name}"`);
    if (overridden) {
      vals.push(overrides[c.column_name]);
      continue;
    }
    if (c.column_name === 'id') vals.push(id);
    else if (/timestamp|date/i.test(c.data_type)) vals.push(new Date());
    else if (/int|numeric|double|real/i.test(c.data_type)) vals.push(0);
    else if (/bool/i.test(c.data_type)) vals.push(false);
    else if (/json/i.test(c.data_type)) vals.push('{}');
    else vals.push(`${id}-${c.column_name}`);
  }

  const placeholders = vals.map((_, i) => `$${i + 1}`).join(',');
  await client.query(
    `INSERT INTO "${table}" (${cols.join(',')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
    vals
  );
}

async function atBaseState() {
  const { rows } = await client.query(`SELECT to_regclass('public.campaign_agents') AS t`);
  if (rows[0].t) fail('the base state still has campaign_agents');
  process.stdout.write('at the pre-migration base state\n');
}

async function objectsExist() {
  const table = await client.query(`SELECT to_regclass('public.campaign_agents') AS t`);
  if (!table.rows[0].t) fail('campaign_agents was not created');

  const idx = await client.query(
    `SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='campaign_agents'`
  );
  const names = idx.rows.map(r => r.indexname);
  for (const required of REQUIRED_INDEXES) {
    if (!names.includes(required)) fail(`missing index ${required}`);
  }

  const fks = await client.query(
    `SELECT conname FROM pg_constraint
     WHERE conrelid='public.campaign_agents'::regclass AND contype='f'`
  );
  if (fks.rows.length !== 3) fail(`expected 3 foreign keys, found ${fks.rows.length}`);

  const enumType = await client.query(`SELECT 1 FROM pg_type WHERE typname='CampaignAgentStatus'`);
  if (enumType.rowCount !== 1) fail('CampaignAgentStatus enum is missing');

  process.stdout.write(
    `forward migration produced the table, ${REQUIRED_INDEXES.length} indexes, 3 FKs and the enum\n`
  );
}

async function duplicateRejected() {
  // The unique constraint must be enforced by the DATABASE. An application-level
  // check would satisfy a behavioural test while leaving two replicas free to
  // race a duplicate in — which double-counts an agent in the capacity the
  // pacing controller multiplies by lines-per-agent.
  await seedRow('tenants', 't1');
  await seedRow('users', 'u1', { tenantId: 't1', email: 'u1@migration-check.test' });
  await seedRow('campaigns', 'c1', { tenantId: 't1' });

  const insert = `INSERT INTO campaign_agents
      ("id","tenantId","campaignId","userId","status","createdAt","updatedAt")
      VALUES ($1,'t1','c1','u1','ACTIVE',NOW(),NOW())`;

  await client.query(insert, ['ca1']);

  let rejected = false;
  try {
    await client.query(insert, ['ca2']);
  } catch (error) {
    rejected = /duplicate key/i.test(error.message);
    if (!rejected) fail(`the duplicate failed for an unexpected reason: ${error.message}`);
  }
  if (!rejected) fail('the database accepted a duplicate assignment');

  process.stdout.write('duplicate rejected by the unique index, deterministically\n');
}

async function rollbackClean() {
  const t = await client.query(`SELECT to_regclass('public.campaign_agents') AS t`);
  if (t.rows[0].t) fail('campaign_agents survived the rollback');

  const e = await client.query(`SELECT 1 FROM pg_type WHERE typname='CampaignAgentStatus'`);
  if (e.rowCount !== 0) fail('CampaignAgentStatus survived the rollback');

  // The tables the migration pointed AT must be untouched, with their rows
  // intact. A rollback that cascaded into them would be a data-loss event.
  for (const table of ['tenants', 'users', 'campaigns']) {
    const r = await client.query(`SELECT COUNT(*)::int AS n FROM "${table}"`);
    if (r.rows[0].n !== 1) {
      fail(`${table} has ${r.rows[0].n} rows after rollback, expected the 1 that was seeded`);
    }
  }

  process.stdout.write('rollback dropped the table and enum, and left referenced rows intact\n');
}

async function reapplied() {
  const t = await client.query(`SELECT to_regclass('public.campaign_agents') AS t`);
  if (!t.rows[0].t) fail('re-applying the migration did not recreate the table');
  process.stdout.write('forward -> rollback -> forward completes cleanly\n');
}

async function columnsMatch() {
  const r = await client.query(
    `SELECT column_name, is_nullable FROM information_schema.columns
     WHERE table_schema='public' AND table_name='campaign_agents'
     ORDER BY column_name`
  );
  const actual = r.rows.map(x => `${x.column_name}:${x.is_nullable}`).join(',');
  if (actual !== EXPECTED_COLUMNS) {
    fail(`column drift.\n  actual:   ${actual}\n  expected: ${EXPECTED_COLUMNS}`);
  }
  process.stdout.write('campaign_agents columns and nullability match the model\n');
}

const commands = {
  'at-base-state': atBaseState,
  'objects-exist': objectsExist,
  'duplicate-rejected': duplicateRejected,
  'rollback-clean': rollbackClean,
  reapplied,
  'columns-match': columnsMatch,
};

if (!commands[command]) {
  process.stderr.write(`unknown command: ${command}\nknown: ${Object.keys(commands).join(', ')}\n`);
  process.exit(2);
}

try {
  await client.connect();
  await commands[command]();
  await client.end();
} catch (error) {
  await client.end().catch(() => {});
  if (process.exitCode !== 1) process.stdout.write(`::error::${error.message}\n`);
  process.exit(1);
}
