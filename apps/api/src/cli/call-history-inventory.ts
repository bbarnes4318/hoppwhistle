/**
 * What call history does THIS database hold?
 *
 * ── Why it uses `pg` and not the Prisma client ───────────────────────────────
 *
 * The whole point of this command is to be pointed at a database that is NOT
 * the current one: an old host, a restored dump, a snapshot mounted to check
 * what is in it. Those carry an older schema, and the generated Prisma client
 * is bound to the current one — `prisma.call.findMany()` selects every column
 * in today's schema and errors on a database that predates half of them. So
 * this reads `information_schema` first, counts only what is actually there,
 * and reports the rest as absent rather than failing.
 *
 * It answers one question per database, and the answer is a number you can
 * compare against another database's number:
 *
 *   - which database am I actually connected to (name, host, size)
 *   - how many rows in calls, cdrs, call_legs, recordings, transcriptions
 *   - per tenant: call count, and the first and last call it holds
 *   - whether this database was built by seeding or carries real history
 *
 * THIS COMMAND ONLY READS.
 *
 *   pnpm --filter @hopwhistle/api calls:inventory
 *   pnpm --filter @hopwhistle/api calls:inventory -- --url "postgresql://…/callfabric_legacy"
 *   pnpm --filter @hopwhistle/api calls:inventory -- --json
 *
 * With no `--url` it reads DATABASE_URL. Run it against the live database and
 * against a restored copy of the old one, and the two outputs side by side are
 * the before-and-after of a recovery.
 */

import { Client } from 'pg';

interface Args {
  url: string;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  let url = process.env.DATABASE_URL || '';
  let json = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--url') url = argv[++i];
    else if (arg.startsWith('--url=')) url = arg.slice('--url='.length);
    else if (arg === '--json') json = true;
  }

  return { url, json };
}

/** One call-bearing table, and what is in it. */
interface TableReport {
  table: string;
  exists: boolean;
  rows: number;
  earliest: string | null;
  latest: string | null;
}

interface TenantReport {
  tenantId: string;
  tenantName: string | null;
  calls: number;
  earliest: string | null;
  latest: string | null;
}

/** The tables call history lives across, and the column each dates rows by. */
const CALL_TABLES: Array<{ table: string; dateColumn: string }> = [
  { table: 'calls', dateColumn: 'createdAt' },
  { table: 'cdrs', dateColumn: 'createdAt' },
  { table: 'call_legs', dateColumn: 'createdAt' },
  { table: 'recordings', dateColumn: 'createdAt' },
  { table: 'transcriptions', dateColumn: 'createdAt' },
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

async function columnExists(client: Client, table: string, column: string): Promise<boolean> {
  const res = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
     ) AS exists`,
    [table, column]
  );
  return res.rows[0]?.exists === true;
}

async function reportTable(
  client: Client,
  table: string,
  dateColumn: string
): Promise<TableReport> {
  if (!(await tableExists(client, table))) {
    return { table, exists: false, rows: 0, earliest: null, latest: null };
  }

  const hasDate = await columnExists(client, table, dateColumn);

  const sql = hasDate
    ? `SELECT count(*)::bigint AS rows,
              min("${dateColumn}") AS earliest,
              max("${dateColumn}") AS latest
         FROM "${table}"`
    : `SELECT count(*)::bigint AS rows, NULL AS earliest, NULL AS latest FROM "${table}"`;

  const res = await client.query<{ rows: string; earliest: Date | null; latest: Date | null }>(sql);
  const row = res.rows[0];

  return {
    table,
    exists: true,
    rows: Number(row?.rows ?? 0),
    earliest: row?.earliest ? row.earliest.toISOString() : null,
    latest: row?.latest ? row.latest.toISOString() : null,
  };
}

/**
 * Calls per tenant, with the tenant's name when this database still has one.
 *
 * A left join, deliberately: a `calls.tenantId` pointing at no tenant row is
 * worth seeing rather than dropping, and on a restored dump where the tenants
 * table came across separately it is a normal intermediate state.
 */
async function reportTenants(client: Client): Promise<TenantReport[]> {
  if (!(await tableExists(client, 'calls'))) return [];

  const hasTenants = await tableExists(client, 'tenants');

  const sql = hasTenants
    ? `SELECT c."tenantId"        AS "tenantId",
              t."name"            AS "tenantName",
              count(*)::bigint    AS calls,
              min(c."createdAt")  AS earliest,
              max(c."createdAt")  AS latest
         FROM "calls" c
         LEFT JOIN "tenants" t ON t."id" = c."tenantId"
        GROUP BY c."tenantId", t."name"
        ORDER BY count(*) DESC`
    : `SELECT c."tenantId"        AS "tenantId",
              NULL                AS "tenantName",
              count(*)::bigint    AS calls,
              min(c."createdAt")  AS earliest,
              max(c."createdAt")  AS latest
         FROM "calls" c
        GROUP BY c."tenantId"
        ORDER BY count(*) DESC`;

  const res = await client.query<{
    tenantId: string;
    tenantName: string | null;
    calls: string;
    earliest: Date | null;
    latest: Date | null;
  }>(sql);

  return res.rows.map(r => ({
    tenantId: r.tenantId,
    tenantName: r.tenantName,
    calls: Number(r.calls),
    earliest: r.earliest ? r.earliest.toISOString() : null,
    latest: r.latest ? r.latest.toISOString() : null,
  }));
}

/** Which database this actually is, so two runs cannot be confused. */
async function identify(client: Client): Promise<{
  database: string;
  host: string;
  sizePretty: string;
  hasPrismaMigrations: boolean;
}> {
  const res = await client.query<{
    database: string;
    host: string | null;
    size: string;
  }>(
    `SELECT current_database() AS database,
            inet_server_addr()::text AS host,
            pg_size_pretty(pg_database_size(current_database())) AS size`
  );

  return {
    database: res.rows[0]?.database ?? '(unknown)',
    host: res.rows[0]?.host ?? 'local socket',
    sizePretty: res.rows[0]?.size ?? '(unknown)',
    hasPrismaMigrations: await tableExists(client, '_prisma_migrations'),
  };
}

const line = (s = '') => console.log(s);

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.url) {
    console.error('No database URL. Set DATABASE_URL or pass --url "postgresql://…".');
    process.exitCode = 1;
    return;
  }

  const client = new Client({ connectionString: args.url });

  try {
    await client.connect();

    const identity = await identify(client);
    const tables: TableReport[] = [];
    for (const { table, dateColumn } of CALL_TABLES) {
      tables.push(await reportTable(client, table, dateColumn));
    }
    const tenants = await reportTenants(client);

    if (args.json) {
      console.log(JSON.stringify({ identity, tables, tenants }, null, 2));
      return;
    }

    line('─'.repeat(74));
    line('  CALL HISTORY IN THIS DATABASE');
    line('─'.repeat(74));
    line();
    line(`  database   ${identity.database}`);
    line(`  host       ${identity.host}`);
    line(`  size       ${identity.sizePretty}`);
    line(`  migrations ${identity.hasPrismaMigrations ? '_prisma_migrations present' : 'no _prisma_migrations table'}`);
    line();

    line('  TABLE            ROWS        EARLIEST      LATEST');
    for (const t of tables) {
      if (!t.exists) {
        line(`  ${t.table.padEnd(16)} (table does not exist in this database)`);
        continue;
      }
      line(
        `  ${t.table.padEnd(16)}${t.rows.toLocaleString().padStart(9)}  ` +
          `${(t.earliest ?? '—').slice(0, 10).padEnd(12)}  ${(t.latest ?? '—').slice(0, 10)}`
      );
    }

    line();
    line('  CALLS BY TENANT');
    if (tenants.length === 0) {
      line('    (no call rows)');
    } else {
      for (const t of tenants) {
        line(
          `    ${t.calls.toLocaleString().padStart(9)}  ` +
            `${(t.tenantName ?? `<no tenant row> ${t.tenantId}`).slice(0, 30).padEnd(31)}` +
            `${(t.earliest ?? '—').slice(0, 10)} → ${(t.latest ?? '—').slice(0, 10)}`
        );
      }
    }
    line();
  } catch (error) {
    console.error('Inventory failed:', error);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}

void main();
