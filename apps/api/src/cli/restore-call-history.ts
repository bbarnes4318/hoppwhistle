/**
 * Copy call history out of an old database and into the live one.
 *
 * ── What this is for ─────────────────────────────────────────────────────────
 *
 * When a stack moves hosts and the new database is stood up fresh rather than
 * restored, the history does not follow it. The rows are not gone — they are in
 * the old database, or in a dump of it — and the live database simply never
 * received them. This command is the second half of that restore: point it at a
 * copy of the old database, name the agency the rows belong to, and it copies
 * calls and everything hanging off them into the live one.
 *
 * ── The four rules it is built on ────────────────────────────────────────────
 *
 * 1. IT IS A DRY RUN UNTIL YOU PASS `--commit`. The default prints what it
 *    would insert and touches nothing.
 *
 * 2. IT ONLY INSERTS. There is no UPDATE and no DELETE in this file. Every
 *    insert carries `ON CONFLICT DO NOTHING`, so a row already in the live
 *    database wins and re-running the command is safe. Interrupt it and run it
 *    again; it resumes.
 *
 * 3. IT READS THE OLD SCHEMA AS IT FINDS IT. The source is older than the
 *    current `schema.prisma` — that is the normal case, not the exception — so
 *    the columns copied are the INTERSECTION of what the source has and what
 *    the target has, computed from `information_schema` at run time. A column
 *    the old database never had is left to the target's default; a column it
 *    has that the target dropped is not carried over.
 *
 * 4. A DANGLING REFERENCE IS NULLED, NOT FOLLOWED. A call row points at a
 *    campaign, a phone number, a publisher, a buyer and a creating user. Those
 *    rows may not exist in the live database, and a foreign key violation would
 *    abort the batch and lose the call. The call is the thing being rescued, so
 *    the optional reference is set to NULL and the call lands. What is lost is
 *    a link; what is kept is the record.
 *
 * ── Running it ───────────────────────────────────────────────────────────────
 *
 *   # See what it would do. Change nothing.
 *   pnpm --filter @hopwhistle/api calls:restore -- \
 *     --from "postgresql://user:pass@old-host:5432/callfabric" \
 *     --into-tenant <live tenant id>
 *
 *   # Do it.
 *   pnpm --filter @hopwhistle/api calls:restore -- \
 *     --from "postgresql://…" --into-tenant <id> --commit
 *
 * `--from-tenant <id>` limits the copy to one tenant in the source, for a
 * source that holds more than one agency. `--into` overrides the target, which
 * otherwise comes from DATABASE_URL.
 *
 * RESTORE THE OLD DUMP INTO ITS OWN DATABASE FIRST, and point `--from` at that.
 * Never restore a dump over the live database: the live one holds everything
 * written since the cutover, and a restore on top of it destroys exactly the
 * rows this command cannot recover from anywhere.
 *
 * Run `calls:inventory` against both databases before and after. The numbers it
 * prints are how you know this worked.
 */

import { Client } from 'pg';

interface Args {
  from: string;
  into: string;
  intoTenant: string;
  fromTenant?: string;
  commit: boolean;
  batch: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    from: '',
    into: process.env.DATABASE_URL || '',
    intoTenant: '',
    commit: false,
    batch: 500,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--from') args.from = argv[++i];
    else if (arg.startsWith('--from=')) args.from = arg.slice('--from='.length);
    else if (arg === '--into') args.into = argv[++i];
    else if (arg.startsWith('--into=')) args.into = arg.slice('--into='.length);
    else if (arg === '--into-tenant') args.intoTenant = argv[++i];
    else if (arg.startsWith('--into-tenant=')) args.intoTenant = arg.slice('--into-tenant='.length);
    else if (arg === '--from-tenant') args.fromTenant = argv[++i];
    else if (arg.startsWith('--from-tenant=')) args.fromTenant = arg.slice('--from-tenant='.length);
    else if (arg === '--commit') args.commit = true;
    else if (arg === '--batch') args.batch = Number(argv[++i]);
    else if (arg.startsWith('--batch=')) args.batch = Number(arg.slice('--batch='.length));
  }

  if (!Number.isFinite(args.batch) || args.batch < 1) args.batch = 500;
  return args;
}

/**
 * The optional references on a call, and the table each points at.
 *
 * `tenantId` is deliberately absent: it is not nulled, it is REWRITTEN to the
 * agency named by `--into-tenant`, because a call with no tenant is a call no
 * portal can ever show.
 */
const CALL_FOREIGN_KEYS: Array<{ column: string; table: string }> = [
  { column: 'campaignId', table: 'campaigns' },
  { column: 'fromNumberId', table: 'phone_numbers' },
  { column: 'createdById', table: 'users' },
  { column: 'publisherId', table: 'publishers' },
  { column: 'buyerId', table: 'buyers' },
];

/** The child tables, in insert order. Each is keyed to a call by `callId`. */
const CHILD_TABLES: Array<{ table: string; foreignKeys: Array<{ column: string; table: string }> }> =
  [
    { table: 'recordings', foreignKeys: [] },
    { table: 'cdrs', foreignKeys: [] },
    { table: 'call_legs', foreignKeys: [{ column: 'phoneNumberId', table: 'phone_numbers' }] },
    { table: 'transcriptions', foreignKeys: [] },
  ];

async function tableExists(client: Client, table: string): Promise<boolean> {
  const res = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = $1
     ) AS exists`,
    [table]
  );
  return res.rows[0]?.exists === true;
}

async function columnsOf(client: Client, table: string): Promise<string[]> {
  const res = await client.query<{ column_name: string }>(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position`,
    [table]
  );
  return res.rows.map(r => r.column_name);
}

/**
 * The columns to carry across: present in both, and not generated by the target.
 *
 * `updatedAt` is excluded on purpose. Prisma's `@updatedAt` is applied by the
 * client, not by a database default, so on a raw insert it is an ordinary NOT
 * NULL column — and if the source lacks it the insert fails. Supplying it as
 * `now()` on the target keeps the row insertable without pretending the value
 * means anything.
 */
async function sharedColumns(
  source: Client,
  target: Client,
  table: string
): Promise<{ copy: string[]; needsUpdatedAt: boolean }> {
  const [sourceColumns, targetColumns] = await Promise.all([
    columnsOf(source, table),
    columnsOf(target, table),
  ]);

  const targetSet = new Set(targetColumns);
  const copy = sourceColumns.filter(c => targetSet.has(c) && c !== 'updatedAt');

  return { copy, needsUpdatedAt: targetSet.has('updatedAt') };
}

/** Which of these ids exist in the target's table. One query per batch. */
async function existingIds(client: Client, table: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  if (!(await tableExists(client, table))) return new Set();

  const res = await client.query<{ id: string }>(
    `SELECT "id" FROM "${table}" WHERE "id" = ANY($1::text[])`,
    [ids]
  );
  return new Set(res.rows.map(r => r.id));
}

/**
 * Insert one batch, skipping anything already present.
 *
 * Built as a single multi-row INSERT with numbered parameters rather than a
 * statement per row: the difference on 70,000 calls is minutes against hours,
 * and `ON CONFLICT DO NOTHING` with no conflict target covers every unique
 * constraint on the table — the primary key, `callSid`, `externalId` — so a row
 * that arrived by any other route is left exactly as it is.
 */
async function insertBatch(
  target: Client,
  table: string,
  columns: string[],
  needsUpdatedAt: boolean,
  rows: Array<Record<string, unknown>>
): Promise<number> {
  if (rows.length === 0) return 0;

  const insertColumns = needsUpdatedAt ? [...columns, 'updatedAt'] : columns;
  const values: unknown[] = [];
  const tuples: string[] = [];

  for (const row of rows) {
    const placeholders: string[] = [];
    for (const column of columns) {
      values.push(row[column] ?? null);
      placeholders.push(`$${values.length}`);
    }
    if (needsUpdatedAt) placeholders.push('now()');
    tuples.push(`(${placeholders.join(', ')})`);
  }

  const sql =
    `INSERT INTO "${table}" (${insertColumns.map(c => `"${c}"`).join(', ')}) ` +
    `VALUES ${tuples.join(', ')} ON CONFLICT DO NOTHING`;

  const res = await target.query(sql, values);
  return res.rowCount ?? 0;
}

interface CopyResult {
  table: string;
  read: number;
  inserted: number;
  skipped: number;
  nulledReferences: Record<string, number>;
}

/**
 * Copy the calls themselves.
 *
 * Paged by `id` rather than by OFFSET: an OFFSET scan re-reads and discards
 * everything before it on each page, which on a table this size is the
 * difference between a restore that finishes and one that is still going in the
 * morning. Ordering by a primary key that both databases agree on also makes
 * the pass resumable — interrupt it, run it again, and the rows already
 * inserted conflict and are skipped.
 */
async function copyCalls(
  source: Client,
  target: Client,
  args: Args
): Promise<CopyResult> {
  const { copy, needsUpdatedAt } = await sharedColumns(source, target, 'calls');
  const selectList = copy.map(c => `"${c}"`).join(', ');

  const result: CopyResult = {
    table: 'calls',
    read: 0,
    inserted: 0,
    skipped: 0,
    nulledReferences: {},
  };

  const presentForeignKeys = CALL_FOREIGN_KEYS.filter(fk => copy.includes(fk.column));

  let cursor = '';
  for (;;) {
    const where: string[] = ['"id" > $1'];
    const params: unknown[] = [cursor];
    if (args.fromTenant) {
      params.push(args.fromTenant);
      where.push(`"tenantId" = $${params.length}`);
    }
    params.push(args.batch);

    const page = await source.query<Record<string, unknown>>(
      `SELECT ${selectList} FROM "calls"
        WHERE ${where.join(' AND ')}
        ORDER BY "id"
        LIMIT $${params.length}`,
      params
    );

    if (page.rows.length === 0) break;
    result.read += page.rows.length;
    cursor = String(page.rows[page.rows.length - 1].id);

    // Every call lands in the agency named on the command line.
    for (const row of page.rows) {
      row.tenantId = args.intoTenant;
    }

    // One lookup per referenced table per page, then null what is missing.
    for (const fk of presentForeignKeys) {
      const ids = [
        ...new Set(
          page.rows.map(r => r[fk.column]).filter((v): v is string => typeof v === 'string' && v !== '')
        ),
      ];
      const present = await existingIds(target, fk.table, ids);
      for (const row of page.rows) {
        const value = row[fk.column];
        if (typeof value === 'string' && value !== '' && !present.has(value)) {
          row[fk.column] = null;
          result.nulledReferences[fk.column] = (result.nulledReferences[fk.column] ?? 0) + 1;
        }
      }
    }

    if (args.commit) {
      result.inserted += await insertBatch(target, 'calls', copy, needsUpdatedAt, page.rows);
    }

    if (page.rows.length < args.batch) break;
  }

  result.skipped = args.commit ? result.read - result.inserted : 0;
  return result;
}

/**
 * Copy one child table, for the calls that are now in the target.
 *
 * The `callId IN (target's calls)` check is what keeps this from failing on a
 * recording whose call was skipped: children are inserted only where the parent
 * landed, so the pass never violates the foreign key it depends on.
 */
async function copyChildTable(
  source: Client,
  target: Client,
  args: Args,
  spec: { table: string; foreignKeys: Array<{ column: string; table: string }> }
): Promise<CopyResult | null> {
  const [inSource, inTarget] = await Promise.all([
    tableExists(source, spec.table),
    tableExists(target, spec.table),
  ]);
  if (!inSource || !inTarget) return null;

  const { copy, needsUpdatedAt } = await sharedColumns(source, target, spec.table);
  if (!copy.includes('callId')) return null;

  const selectList = copy.map(c => `"${c}"`).join(', ');
  const result: CopyResult = {
    table: spec.table,
    read: 0,
    inserted: 0,
    skipped: 0,
    nulledReferences: {},
  };

  const presentForeignKeys = spec.foreignKeys.filter(fk => copy.includes(fk.column));
  const hasTenantColumn = copy.includes('tenantId');

  let cursor = '';
  for (;;) {
    const page = await source.query<Record<string, unknown>>(
      `SELECT ${selectList} FROM "${spec.table}"
        WHERE "id" > $1
        ORDER BY "id"
        LIMIT $2`,
      [cursor, args.batch]
    );

    if (page.rows.length === 0) break;
    cursor = String(page.rows[page.rows.length - 1].id);

    // Only rows whose call actually made it across.
    const callIds = [
      ...new Set(
        page.rows.map(r => r.callId).filter((v): v is string => typeof v === 'string' && v !== '')
      ),
    ];
    const landedCalls = args.commit
      ? await existingIds(target, 'calls', callIds)
      : new Set(callIds); // dry run: report what WOULD be copied
    const keep = page.rows.filter(r => landedCalls.has(String(r.callId)));
    result.read += keep.length;

    if (hasTenantColumn) {
      for (const row of keep) row.tenantId = args.intoTenant;
    }

    for (const fk of presentForeignKeys) {
      const ids = [
        ...new Set(
          keep.map(r => r[fk.column]).filter((v): v is string => typeof v === 'string' && v !== '')
        ),
      ];
      const present = await existingIds(target, fk.table, ids);
      for (const row of keep) {
        const value = row[fk.column];
        if (typeof value === 'string' && value !== '' && !present.has(value)) {
          row[fk.column] = null;
          result.nulledReferences[fk.column] = (result.nulledReferences[fk.column] ?? 0) + 1;
        }
      }
    }

    if (args.commit) {
      result.inserted += await insertBatch(target, spec.table, copy, needsUpdatedAt, keep);
    }

    if (page.rows.length < args.batch) break;
  }

  result.skipped = args.commit ? result.read - result.inserted : 0;
  return result;
}

async function countCalls(client: Client, tenantId?: string): Promise<number> {
  if (!(await tableExists(client, 'calls'))) return 0;
  const res = tenantId
    ? await client.query<{ n: string }>(
        `SELECT count(*)::bigint AS n FROM "calls" WHERE "tenantId" = $1`,
        [tenantId]
      )
    : await client.query<{ n: string }>(`SELECT count(*)::bigint AS n FROM "calls"`);
  return Number(res.rows[0]?.n ?? 0);
}

const line = (s = '') => console.log(s);

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.from || !args.into || !args.intoTenant) {
    console.error(
      'Usage: calls:restore -- --from "postgresql://…old…" --into-tenant <tenantId> [--commit]\n' +
        '  --from        the OLD database (restore its dump into its own database first)\n' +
        '  --into        the live database; defaults to DATABASE_URL\n' +
        '  --into-tenant the agency in the live database these calls belong to\n' +
        '  --from-tenant only copy this tenant from the source\n' +
        '  --commit      actually write. Without it this is a dry run.'
    );
    process.exitCode = 1;
    return;
  }

  const source = new Client({ connectionString: args.from });
  const target = new Client({ connectionString: args.into });

  try {
    await source.connect();
    await target.connect();

    // Refuse to copy into an agency that does not exist: every call would fail
    // the tenant foreign key, and the error would arrive 70,000 rows in.
    const tenant = await target.query<{ id: string; name: string }>(
      `SELECT "id", "name" FROM "tenants" WHERE "id" = $1`,
      [args.intoTenant]
    );
    if (tenant.rows.length === 0) {
      console.error(
        `No tenant ${args.intoTenant} in the target database. ` +
          'Run calls:inventory against it to list the agencies it has.'
      );
      process.exitCode = 1;
      return;
    }

    const beforeSource = await countCalls(source, args.fromTenant);
    const beforeTarget = await countCalls(target);
    const beforeTenant = await countCalls(target, args.intoTenant);

    line('─'.repeat(74));
    line(args.commit ? '  RESTORING CALL HISTORY' : '  DRY RUN — nothing will be written');
    line('─'.repeat(74));
    line();
    line(`  source calls        ${beforeSource.toLocaleString()}${args.fromTenant ? ` (tenant ${args.fromTenant})` : ''}`);
    line(`  target calls        ${beforeTarget.toLocaleString()}`);
    line(`  into agency         ${tenant.rows[0].name}  (${args.intoTenant})`);
    line(`  it currently holds  ${beforeTenant.toLocaleString()}`);
    line();

    const results: CopyResult[] = [];
    results.push(await copyCalls(source, target, args));
    for (const spec of CHILD_TABLES) {
      const result = await copyChildTable(source, target, args, spec);
      if (result) results.push(result);
    }

    line('  TABLE            READ      INSERTED   ALREADY PRESENT');
    for (const r of results) {
      line(
        `  ${r.table.padEnd(16)}${r.read.toLocaleString().padStart(8)}  ` +
          `${(args.commit ? r.inserted.toLocaleString() : '—').padStart(10)}  ` +
          `${(args.commit ? r.skipped.toLocaleString() : '—').padStart(15)}`
      );
      for (const [column, count] of Object.entries(r.nulledReferences)) {
        line(`      ${column}: ${count.toLocaleString()} reference(s) not in the target, set to NULL`);
      }
    }

    line();
    if (args.commit) {
      const afterTenant = await countCalls(target, args.intoTenant);
      line(`  ${tenant.rows[0].name} now holds ${afterTenant.toLocaleString()} calls ` +
        `(was ${beforeTenant.toLocaleString()}).`);
      line();
      line('  Verify with:  pnpm --filter @hopwhistle/api calls:inventory');
    } else {
      line('  Nothing was written. Re-run with --commit to do it.');
    }
    line();
  } catch (error) {
    console.error('Restore failed:', error);
    process.exitCode = 1;
  } finally {
    await source.end().catch(() => {});
    await target.end().catch(() => {});
  }
}

void main();
