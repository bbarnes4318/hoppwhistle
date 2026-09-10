/**
 * Read-only forensics for "the calls are gone from the portal".
 *
 * ── The question this answers ────────────────────────────────────────────────
 *
 * `GET /api/v1/calls` is scoped three ways before it ever reaches the database:
 *
 *   1. the ACTING TENANT, which for platform staff is the agency they entered
 *      and NOT the tenant on their own user row (see middleware/api-v1-auth.ts
 *      `applyPlatformContext`, which overwrites `principal.tenantId` with the
 *      `PlatformActingTenant` selection, or with nothing when there is none);
 *   2. the caller's ROLES -- anybody who is not ADMIN or OWNER of the acting
 *      agency is narrowed to calls they created or that touched one of their
 *      own numbers (`buildCallWhere` in routes/index.ts);
 *   3. the publisher/buyer LINK on their user row, for the same reason.
 *
 * So an empty call list has five completely different causes, and the portal
 * renders four of them identically. This script separates them by reading the
 * database directly and reporting, in order:
 *
 *   A. every Call row on the platform, grouped by the agency that owns it
 *   B. the last N months, month by month, so a stopped INGEST is visible
 *   C. the operator: their user row, roles, links, platform capability and
 *      which agency (if any) they are currently inside
 *   D. the acting tenant the API would compute for them right now
 *   E. the exact count the portal query returns for them, replayed
 *   F. a verdict naming which of the five it is, and what fixes it
 *
 * THIS SCRIPT ONLY READS. No inserts, no updates, no deletes. Nothing it finds
 * is repaired by running it; decide what to do from the verdict and do that
 * deliberately.
 *
 *   pnpm --filter @hopwhistle/api calls:diagnose -- --email you@example.com
 *   pnpm --filter @hopwhistle/api calls:diagnose -- --email you@example.com --months 12
 *   pnpm --filter @hopwhistle/api calls:diagnose -- --json > calls-diagnosis.json
 *
 * `--email` is optional: without it, sections A and B still run and tell you
 * where the rows are. With it, the whole chain from operator to query runs.
 *
 * Requires DATABASE_URL to point at the database the portal reads. Point it at
 * production; that is the one with the missing calls.
 */

import { getPrismaClient } from '../lib/prisma.js';

interface Args {
  email?: string;
  months: number;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { months: 6, json: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--email') {
      args.email = argv[++i];
    } else if (arg.startsWith('--email=')) {
      args.email = arg.slice('--email='.length);
    } else if (arg === '--months') {
      args.months = Number(argv[++i]);
    } else if (arg.startsWith('--months=')) {
      args.months = Number(arg.slice('--months='.length));
    } else if (arg === '--json') {
      args.json = true;
    }
  }

  if (!Number.isFinite(args.months) || args.months < 1) args.months = 6;
  return args;
}

/** One agency's share of the calls table. */
interface TenantCalls {
  tenantId: string;
  tenantName: string | null;
  tenantSlug: string | null;
  tenantStatus: string | null;
  /** True when `calls.tenantId` points at a tenant row that does not exist. */
  orphaned: boolean;
  calls: number;
  earliest: string | null;
  latest: string | null;
}

interface MonthRow {
  month: string;
  tenantId: string;
  calls: number;
}

/** What the API would decide about this operator, without asking the API. */
interface Operator {
  userId: string;
  email: string;
  status: string;
  /** The tenant on the user's own row. NOT necessarily the acting tenant. */
  homeTenantId: string | null;
  homeTenantName: string | null;
  roles: string[];
  buyerId: string | null;
  publisherId: string | null;
  isPlatformAdmin: boolean;
  actingTenantId: string | null;
  actingTenantName: string | null;
  /** The tenant every agency-scoped query would run under. Null means refusal. */
  effectiveTenantId: string | null;
  /** Whether `buildCallWhere` would show them the whole agency or narrow them. */
  isAdminOrOwner: boolean;
}

const line = (s = '') => console.log(s);
const rule = () => line('─'.repeat(78));

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

/**
 * Section A — every call row, by the agency that owns it.
 *
 * `groupBy` over the whole table, plus a left join for the tenant names. The
 * join is a raw query because a `calls.tenantId` with no `tenants` row is
 * exactly the kind of thing worth reporting, and the relation loader cannot
 * express "rows whose parent is missing".
 */
async function callsByTenant(): Promise<TenantCalls[]> {
  const prisma = getPrismaClient();

  const grouped = await prisma.call.groupBy({
    by: ['tenantId'],
    _count: { _all: true },
    _min: { createdAt: true },
    _max: { createdAt: true },
  });

  const tenantIds = grouped.map(g => g.tenantId);
  const tenants = await prisma.tenant.findMany({
    where: { id: { in: tenantIds } },
    select: { id: true, name: true, slug: true, status: true },
  });
  const byId = new Map(tenants.map(t => [t.id, t]));

  return grouped
    .map(g => {
      const tenant = byId.get(g.tenantId);
      return {
        tenantId: g.tenantId,
        tenantName: tenant?.name ?? null,
        tenantSlug: tenant?.slug ?? null,
        tenantStatus: tenant?.status ?? null,
        orphaned: !tenant,
        calls: g._count._all,
        earliest: iso(g._min.createdAt),
        latest: iso(g._max.createdAt),
      };
    })
    .sort((a, b) => b.calls - a.calls);
}

/**
 * Section B — the last N months, month by month.
 *
 * A read problem and a write problem look identical in the portal and nothing
 * alike here: a tenant-scoping fault leaves the histogram full and the portal
 * empty, while a broken ingest leaves a cliff on the month it broke. Grouped by
 * tenant as well so a cutover from one agency to another is visible as one
 * column ending where another begins.
 */
async function callsByMonth(months: number): Promise<MonthRow[]> {
  const prisma = getPrismaClient();
  const since = new Date();
  since.setMonth(since.getMonth() - months);
  since.setHours(0, 0, 0, 0);

  const rows = await prisma.$queryRaw<Array<{ month: Date; tenantId: string; calls: bigint }>>`
    SELECT date_trunc('month', "createdAt") AS month,
           "tenantId",
           count(*) AS calls
      FROM calls
     WHERE "createdAt" >= ${since}
     GROUP BY 1, 2
     ORDER BY 1 DESC, 3 DESC
  `;

  return rows.map(r => ({
    month: r.month.toISOString().slice(0, 7),
    tenantId: r.tenantId,
    calls: Number(r.calls),
  }));
}

/**
 * Section C/D — the operator, and the tenant the API would act as.
 *
 * This mirrors `applyPlatformContext` deliberately rather than importing it:
 * that function needs a Fastify request. The rule it implements is one line and
 * is the whole reason an owner can be looking at an empty portal --
 *
 *     principal.tenantId = platform.actingTenantId ?? undefined
 *
 * -- so for a platform admin the tenant on their own user row does not decide
 * anything, and with no agency entered there is no tenant at all.
 */
async function loadOperator(email: string): Promise<Operator | null> {
  const prisma = getPrismaClient();

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      status: true,
      tenantId: true,
      buyerId: true,
      publisherId: true,
      metadata: true,
      tenant: { select: { name: true } },
      roles: { select: { role: { select: { name: true } } } },
      platformAdmin: { select: { id: true } },
      platformActingTenant: {
        select: { tenantId: true, tenant: { select: { name: true, status: true } } },
      },
    },
  });

  if (!user) return null;

  const roles = user.roles.map(r => r.role.name);
  const isPlatformAdmin = user.platformAdmin !== null;

  // A selection into a suspended agency is not honoured — loadPlatformContext()
  // drops the operator back to the cross-agency view rather than acting inside
  // a tenant the platform has switched off. Same rule here.
  const selection =
    user.platformActingTenant && user.platformActingTenant.tenant.status === 'ACTIVE'
      ? user.platformActingTenant
      : null;

  const effectiveTenantId = isPlatformAdmin ? (selection?.tenantId ?? null) : (user.tenantId ?? null);

  // Inside an agency a platform operator carries ADMIN and OWNER for it
  // (ACTING_TENANT_ROLES); in the cross-agency view they carry none.
  const effectiveRoles = isPlatformAdmin && selection ? [...roles, 'ADMIN', 'OWNER'] : roles;

  return {
    userId: user.id,
    email: user.email,
    status: user.status,
    homeTenantId: user.tenantId ?? null,
    homeTenantName: user.tenant?.name ?? null,
    roles,
    buyerId: user.buyerId ?? null,
    publisherId:
      user.publisherId ?? ((user.metadata as { publisherId?: string } | null)?.publisherId ?? null),
    isPlatformAdmin,
    actingTenantId: selection?.tenantId ?? null,
    actingTenantName: selection?.tenant.name ?? null,
    effectiveTenantId,
    isAdminOrOwner: effectiveRoles.some(r => r === 'ADMIN' || r === 'OWNER'),
  };
}

/**
 * Section E — replay the portal's own query.
 *
 * `buildCallWhere` lives inside routes/index.ts alongside the route tree, and
 * importing that module from a CLI drags in every plugin it registers. So the
 * two clauses that decide whether an operator sees an agency or a keyhole are
 * rebuilt here, and only those two: the tenant scope, and the non-admin
 * narrowing to calls they created or that touched one of their own numbers.
 *
 * If this count and the portal disagree, the fault is between the route and the
 * browser, not in the data — which is itself a useful answer, and one the
 * verdict says out loud.
 */
async function replayPortalQuery(op: Operator): Promise<{
  scopedToTenant: number;
  visibleToThisOperator: number;
}> {
  const prisma = getPrismaClient();

  if (!op.effectiveTenantId) return { scopedToTenant: 0, visibleToThisOperator: 0 };

  const scopedToTenant = await prisma.call.count({ where: { tenantId: op.effectiveTenantId } });

  if (op.isAdminOrOwner) {
    return { scopedToTenant, visibleToThisOperator: scopedToTenant };
  }

  const where: Record<string, unknown> = { tenantId: op.effectiveTenantId };

  if (op.buyerId) {
    where.buyerId = op.buyerId;
  } else if (op.publisherId) {
    where.publisherId = op.publisherId;
  } else {
    const owned = await prisma.phoneNumber.findMany({
      where: { tenantId: op.effectiveTenantId, userId: op.userId },
      select: { number: true },
    });

    const variants: string[] = [];
    for (const { number } of owned) {
      variants.push(number);
      if (number.startsWith('+1')) {
        variants.push(number.slice(2), number.slice(1));
      } else if (number.startsWith('1') && number.length === 11) {
        variants.push(`+${number}`, number.slice(1));
      } else if (number.length === 10) {
        variants.push(`+1${number}`, `1${number}`);
      }
    }

    where.OR = [
      { createdById: op.userId },
      { fromNumber: { userId: op.userId } },
      { callerId: { in: variants } },
      { toNumber: { in: variants } },
      { did: { in: variants } },
    ];
  }

  const visibleToThisOperator = await prisma.call.count({ where: where as never });
  return { scopedToTenant, visibleToThisOperator };
}

/**
 * Section F — say which of the five it is.
 *
 * Ordered by what has to be true first: a request with no tenant never reaches
 * a row, so that verdict comes before "the wrong agency", which comes before
 * "the right agency, narrowed by role", which comes before "the query works and
 * the browser is not showing you its answer".
 */
function verdict(
  op: Operator | null,
  byTenant: TenantCalls[],
  replay: { scopedToTenant: number; visibleToThisOperator: number } | null,
  months: number
): string[] {
  const out: string[] = [];
  const totalCalls = byTenant.reduce((n, t) => n + t.calls, 0);
  const withCalls = byTenant.filter(t => t.calls > 0);

  if (totalCalls === 0) {
    out.push('THE TABLE IS EMPTY. There are no Call rows at all, for any agency.');
    out.push('This is not a portal problem. Nothing is writing calls, or they were deleted.');
    return out;
  }

  if (!op) {
    out.push(`${totalCalls.toLocaleString()} call rows exist, across ${withCalls.length} agenc${withCalls.length === 1 ? 'y' : 'ies'}.`);
    out.push('Re-run with --email <the address you sign in with> to see which of them your portal is asking for.');
    return out;
  }

  if (!op.effectiveTenantId) {
    out.push('NO ACTING TENANT — this is why the portal is empty.');
    out.push('');
    out.push(
      op.isPlatformAdmin
        ? 'You hold the platform capability (a PlatformAdmin row) and have entered no agency.'
        : 'Your user row carries no tenantId at all.'
    );
    out.push(
      'Every agency-scoped route, /api/v1/calls included, answers 409 NO_ACTING_TENANT in that'
    );
    out.push('state. Your calls are untouched; nothing is being deleted. The query is refused, not empty.');
    out.push('');
    if (op.isPlatformAdmin) {
      out.push('FIX, either of:');
      out.push('  1. Enter the agency. The switcher in the topbar, or');
      out.push('     POST /api/v1/platform/acting-tenant {"tenantId":"…"} as yourself.');
      out.push('     It takes effect on the NEXT request, and the agencies holding calls are');
      out.push('     listed in section A above.');
      if (op.homeTenantId) {
        const home = byTenant.find(t => t.tenantId === op.homeTenantId);
        out.push(
          `     Yours is ${op.homeTenantName ?? op.homeTenantId}` +
            (home ? ` — ${home.calls.toLocaleString()} calls.` : ' — which holds no calls.')
        );
      }
      out.push('  2. If you are an agency owner who never wanted the cross-agency view, drop');
      out.push('     the capability and your own agency applies again, as it did before:');
      out.push(`     pnpm --filter @hopwhistle/api platform:admins -- --revoke ${op.email}`);
    } else {
      out.push('FIX: your user row needs its tenantId set to the agency that owns your calls.');
    }
    return out;
  }

  const acting = byTenant.find(t => t.tenantId === op.effectiveTenantId);
  const actingCalls = acting?.calls ?? 0;

  if (actingCalls === 0) {
    out.push('WRONG AGENCY — the portal is asking for an agency that has no calls.');
    out.push('');
    out.push(`You are acting as ${op.actingTenantName ?? op.homeTenantName ?? op.effectiveTenantId}`);
    out.push(`(${op.effectiveTenantId}), which owns 0 call rows.`);
    out.push('');
    out.push('The calls are here:');
    for (const t of withCalls.slice(0, 10)) {
      out.push(
        `  ${t.calls.toLocaleString().padStart(9)}  ${t.tenantName ?? '<no tenant row>'}  (${t.tenantId})`
      );
    }
    out.push('');
    out.push(
      op.isPlatformAdmin
        ? 'FIX: enter the agency that owns them, with the agency switcher in the topbar.'
        : 'FIX: your user row points at the wrong agency. Point it at the one holding the calls.'
    );
    return out;
  }

  if (!op.isAdminOrOwner) {
    out.push('NARROWED BY ROLE — the agency has calls, you are not being shown them.');
    out.push('');
    out.push(`Your roles are [${op.roles.join(', ') || 'none'}]. Neither ADMIN nor OWNER is among them,`);
    out.push('so buildCallWhere() narrows the list to calls you created or that touched one of your');
    out.push('own numbers, instead of the whole agency.');
    out.push('');
    out.push(`  the agency holds        ${actingCalls.toLocaleString()} calls`);
    out.push(`  you are shown           ${replay?.visibleToThisOperator.toLocaleString() ?? '?'} of them`);
    out.push('');
    out.push('FIX: grant your account ADMIN or OWNER in this agency (a UserRole row).');
    return out;
  }

  /*
   * Acting inside a real agency that holds a fraction of the platform's calls.
   *
   * Not a verdict on its own -- a small agency is allowed to be small -- but it
   * is the shape of "entered the wrong one", and it is invisible from inside the
   * portal, which shows one agency and never says there is another.
   */
  const biggest = withCalls.find(t => t.tenantId !== op.effectiveTenantId);
  if (biggest && biggest.calls > actingCalls * 5) {
    out.push('NOTE — most of the platform\'s calls are in a DIFFERENT agency.');
    out.push('');
    out.push(`  you are inside   ${acting?.tenantName ?? op.effectiveTenantId}: ${actingCalls.toLocaleString()} calls`);
    out.push(`  the largest is   ${biggest.tenantName ?? biggest.tenantId}: ${biggest.calls.toLocaleString()} calls`);
    out.push('');
    out.push('If the calls you are looking for are that agency\'s, enter it instead —');
    out.push('the switcher in the topbar. The rest of this verdict is about the one you are in.');
    out.push('');
  }

  out.push('THE QUERY IS FINE — and the portal is still showing you nothing.');
  out.push('');
  out.push(`Acting agency: ${op.actingTenantName ?? op.homeTenantName ?? op.effectiveTenantId}`);
  out.push(`Calls it owns: ${actingCalls.toLocaleString()}  (earliest ${acting?.earliest}, latest ${acting?.latest})`);
  out.push(`Rows /api/v1/calls would return for you: ${replay?.visibleToThisOperator.toLocaleString() ?? '?'}`);
  out.push('');
  out.push('So the rows exist, the scoping resolves, and the query returns them. Whatever is');
  out.push('emptying the table is between the route and the browser:');
  out.push('');
  out.push('  • the request is failing and the page is rendering the failure as "No call events');
  out.push('    found" — check the browser Network tab for the status on /api/v1/calls;');
  out.push('  • or it is timing out — the route reconciles stale recordings before it answers,');
  out.push('    and a backlog there can push it past the gateway timeout;');
  out.push('  • or a filter is set on the page (date preset, campaign, publisher, buyer, list).');
  out.push('');
  out.push(`Last ${months} months by month are in section B — if the recent months are populated`);
  out.push('there and blank in the portal, it is the wire, not the data.');
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const prisma = getPrismaClient();

  try {
    const byTenant = await callsByTenant();
    const months = await callsByMonth(args.months);
    const op = args.email ? await loadOperator(args.email) : null;
    const replay = op ? await replayPortalQuery(op) : null;

    if (args.email && !op) {
      console.error(`No user with email ${args.email}. Section A and B below still apply.`);
    }

    const lines = verdict(op, byTenant, replay, args.months);

    if (args.json) {
      console.log(
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            totalCalls: byTenant.reduce((n, t) => n + t.calls, 0),
            byTenant,
            byMonth: months,
            operator: op,
            portalQuery: replay,
            verdict: lines,
          },
          null,
          2
        )
      );
      return;
    }

    rule();
    line('  WHERE THE CALLS ARE');
    line(`  ${new Date().toISOString()}`);
    rule();

    line();
    line('A. EVERY CALL ROW, BY THE AGENCY THAT OWNS IT');
    line();
    if (byTenant.length === 0) {
      line('   (no call rows at all)');
    } else {
      line('        calls  agency                             earliest     latest');
      for (const t of byTenant) {
        const name = (t.orphaned ? `!! ${t.tenantId} (no tenant row)` : `${t.tenantName ?? t.tenantId}`)
          .slice(0, 32)
          .padEnd(32);
        line(
          `   ${t.calls.toLocaleString().padStart(10)}  ${name}  ` +
            `${(t.earliest ?? '').slice(0, 10).padEnd(11)}  ${(t.latest ?? '').slice(0, 10)}`
        );
      }
      const total = byTenant.reduce((n, t) => n + t.calls, 0);
      line(`   ${'─'.repeat(10)}`);
      line(`   ${total.toLocaleString().padStart(10)}  total`);
    }

    line();
    line(`B. THE LAST ${args.months} MONTHS`);
    line();
    if (months.length === 0) {
      line(`   (no calls in the last ${args.months} months — this is a stopped ingest, not a portal fault)`);
    } else {
      const perMonth = new Map<string, number>();
      for (const m of months) perMonth.set(m.month, (perMonth.get(m.month) ?? 0) + m.calls);
      for (const [month, n] of perMonth) {
        const bar = '█'.repeat(Math.min(40, Math.ceil(n / Math.max(1, Math.max(...perMonth.values()) / 40))));
        line(`   ${month}  ${n.toLocaleString().padStart(8)}  ${bar}`);
      }
    }

    if (op) {
      line();
      line('C. THE OPERATOR');
      line();
      line(`   email                ${op.email}`);
      line(`   user id              ${op.userId}`);
      line(`   status               ${op.status}`);
      line(`   tenant on their row  ${op.homeTenantName ?? '(none)'}  ${op.homeTenantId ?? ''}`);
      line(`   roles                ${op.roles.join(', ') || '(none)'}`);
      line(`   buyer link           ${op.buyerId ?? '(none)'}`);
      line(`   publisher link       ${op.publisherId ?? '(none)'}`);
      line(`   platform staff       ${op.isPlatformAdmin ? 'YES (PlatformAdmin row)' : 'no'}`);
      line(
        `   agency entered       ${op.actingTenantName ? `${op.actingTenantName}  ${op.actingTenantId}` : '(none — cross-agency view)'}`
      );

      line();
      line('D. THE TENANT EVERY AGENCY-SCOPED QUERY RUNS UNDER');
      line();
      line(
        `   ${op.effectiveTenantId ?? 'NONE — every agency-scoped route answers 409 NO_ACTING_TENANT'}`
      );
      if (op.effectiveTenantId) {
        line(
          `   treated as ADMIN/OWNER: ${op.isAdminOrOwner ? 'yes' : 'NO — narrowed to their own calls'}`
        );
      } else {
        line('   (no tenant to be an administrator of — the request is refused before any query)');
      }

      line();
      line('E. WHAT /api/v1/calls RETURNS FOR THEM');
      line();
      line(`   rows in the acting agency   ${replay?.scopedToTenant.toLocaleString() ?? '0'}`);
      line(`   rows this operator is shown ${replay?.visibleToThisOperator.toLocaleString() ?? '0'}`);
    }

    line();
    rule();
    line('  VERDICT');
    rule();
    line();
    for (const l of lines) line(`  ${l}`);
    line();
  } catch (error) {
    console.error('Diagnosis failed:', error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
