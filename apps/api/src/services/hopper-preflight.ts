/**
 * Hopper preflight — STRICTLY READ-ONLY diagnostic.
 *
 * `docs/dialer-v2/CURRENT_STATE_AUDIT.md` F-1 established from static reading
 * that the production Hopper writes `'DIALING'::"LeadStatus"` while the
 * checked-in enum has no such member, so `originateCall()` is unreachable
 * whenever leads exist.
 *
 * Static reading is not proof about a live database. `schema.prisma` is not the
 * deployed schema — F-2 established that the `leads` table and the `LeadStatus`
 * enum appear in no migration, so production came from `prisma db push` and the
 * live enum could contain anything.
 *
 * This tool answers the question against the real database, and answers the
 * follow-up an operator actually needs before authorising a repair: **if the
 * Hopper started working right now, how many telephone calls would it place?**
 *
 * ── Safety contract ──────────────────────────────────────────────────────────
 * Every query in this file is a SELECT. There is no INSERT, UPDATE, DELETE,
 * ALTER, or CREATE anywhere in the module, and no FreeSWITCH command is sent —
 * the ESL check is a bare TCP connect that is closed before the banner is read.
 * Nothing here can modify a lead, campaign, enum, worker, caller ID, gateway, or
 * FreeSWITCH configuration.
 */

export interface HopperPreflightFacts {
  /** Does the `LeadStatus` type exist in the live database at all? */
  leadStatusEnumExists: boolean;
  /** Exact live enum members, in declaration order. */
  leadStatusValues: string[];
  /** Does the live enum contain the value the Hopper writes? */
  dialingValueExists: boolean;

  activeCampaigns: number;
  /** Leads matching the Hopper's own selection predicate. */
  newLeadsInActiveCampaigns: number;
  /**
   * Leads that would be dialed in the first poll cycle if the Hopper were
   * repaired — the Hopper's batch size, bounded by the global concurrency cap
   * and by how many leads actually exist.
   */
  immediatelyDialableFirstCycle: number;

  workerDialerEnabled: boolean;
  workerDialerDetail: string;
  maxConcurrentCalls: number;
  dialerBatchSize: number;

  eslReachable: boolean;
  eslDetail: string;

  fractelGatewaysConfigured: boolean;
  fractelGatewayNames: string[];
  /** Active FracTEL POOL numbers — what `getNextCallerId` rotates through. */
  fractelPoolNumberCount: number;
  /** Tenants with ACTIVE campaigns but no pool numbers — they get the hard-coded fallback. */
  tenantsWithoutCallerIdPool: number;
}

export type HopperVerdict =
  | 'HOPPER_BLOCKED_NO_CALLS_POSSIBLE'
  | 'REPAIR_WOULD_START_CALLS_IMMEDIATELY'
  | 'REPAIR_WOULD_NOT_START_CALLS'
  | 'HOPPER_MAY_ALREADY_BE_DIALING'
  | 'INDETERMINATE';

export interface HopperPreflightReport {
  facts: HopperPreflightFacts;
  /** True when the enum is missing `DIALING`, i.e. F-1 is confirmed live. */
  hopperBlockedByEnum: boolean;
  /** True when repairing the Hopper would put real calls on the wire at once. */
  repairWouldStartCallsImmediately: boolean;
  verdict: HopperVerdict;
  findings: string[];
  warnings: string[];
}

/**
 * Pure analysis. Takes gathered facts, returns a verdict. Separated from I/O so
 * every branch is testable against mocked database results without a database.
 */
export function analyzeHopperPreflight(facts: HopperPreflightFacts): HopperPreflightReport {
  const findings: string[] = [];
  const warnings: string[] = [];

  if (!facts.leadStatusEnumExists) {
    return {
      facts,
      hopperBlockedByEnum: false,
      repairWouldStartCallsImmediately: false,
      verdict: 'INDETERMINATE',
      findings: [
        'The LeadStatus enum does not exist in the live database. The Hopper query would fail for a different reason than the one the audit predicted; investigate before drawing any conclusion.',
      ],
      warnings: ['Live schema does not match apps/api/prisma/schema.prisma.'],
    };
  }

  const hopperBlockedByEnum = !facts.dialingValueExists;

  if (hopperBlockedByEnum) {
    findings.push(
      `CONFIRMED LIVE: LeadStatus has no DIALING member (live values: ${facts.leadStatusValues.join(', ')}). ` +
        "The Hopper's UPDATE ... 'DIALING'::\"LeadStatus\" raises invalid_text_representation on the first lead of every batch, so originateCall() is never reached. The Hopper is placing no outbound calls."
    );
  } else {
    findings.push(
      'LeadStatus DOES contain DIALING in the live database. Audit finding F-1 does NOT apply to this environment — the Hopper is not blocked by the enum and may be dialing right now. Do not treat this system as quiescent.'
    );
    warnings.push(
      'Live enum differs from the checked-in schema.prisma, which lists only NEW, CONTACTED, QUALIFIED, CONVERTED, LOST, DO_NOT_CALL.'
    );
  }

  // Would a repair immediately put calls on the wire?
  const hasWork = facts.immediatelyDialableFirstCycle > 0;
  const canDial =
    facts.workerDialerEnabled && facts.eslReachable && facts.fractelGatewaysConfigured;
  const repairWouldStartCallsImmediately = hopperBlockedByEnum && hasWork && canDial;

  if (hasWork) {
    findings.push(
      `${facts.newLeadsInActiveCampaigns} NEW lead(s) sit in ${facts.activeCampaigns} ACTIVE campaign(s). ` +
        `Repairing the Hopper would dial approximately ${facts.immediatelyDialableFirstCycle} of them within the first ${'poll cycle'} (~1 second), then continue.`
    );
  } else if (facts.activeCampaigns === 0) {
    findings.push('No ACTIVE campaigns. A repair would not select any lead.');
  } else {
    findings.push(
      `${facts.activeCampaigns} ACTIVE campaign(s) exist but contain no NEW leads. A repair would not dial until leads are added.`
    );
  }

  if (!facts.workerDialerEnabled) {
    findings.push(`Worker dialer not enabled: ${facts.workerDialerDetail}`);
  }
  if (!facts.eslReachable) {
    findings.push(`FreeSWITCH ESL not reachable: ${facts.eslDetail}`);
  }
  if (!facts.fractelGatewaysConfigured) {
    findings.push('No FracTEL gateways appear configured; outbound origination would fail.');
  }

  // Caller-ID exposure (audit F-6) — reported because a repair that starts calls
  // also starts presenting caller IDs.
  if (facts.tenantsWithoutCallerIdPool > 0) {
    warnings.push(
      `${facts.tenantsWithoutCallerIdPool} tenant(s) with ACTIVE campaigns have no active FracTEL POOL number. ` +
        'For those tenants the Hopper falls back to the hard-coded OUTBOUND_CALLER_ID (audit F-6), presenting a number that may belong to a different tenant.'
    );
  }

  let verdict: HopperVerdict;
  if (!hopperBlockedByEnum) {
    verdict = 'HOPPER_MAY_ALREADY_BE_DIALING';
  } else if (repairWouldStartCallsImmediately) {
    verdict = 'REPAIR_WOULD_START_CALLS_IMMEDIATELY';
  } else if (hasWork) {
    verdict = 'HOPPER_BLOCKED_NO_CALLS_POSSIBLE';
  } else {
    verdict = 'REPAIR_WOULD_NOT_START_CALLS';
  }

  return {
    facts,
    hopperBlockedByEnum,
    repairWouldStartCallsImmediately,
    verdict,
    findings,
    warnings,
  };
}

/** Human-readable summary. Contains no secrets — hosts and passwords are never printed. */
export function formatHopperPreflight(report: HopperPreflightReport): string {
  const f = report.facts;
  const lines: string[] = [];
  const yn = (b: boolean): string => (b ? 'yes' : 'no');

  lines.push('');
  lines.push('HOPPER PREFLIGHT — read-only. No data was modified.');
  lines.push('='.repeat(72));
  lines.push('');
  lines.push('LeadStatus enum');
  lines.push(`  exists in live database......... ${yn(f.leadStatusEnumExists)}`);
  lines.push(`  live values..................... ${f.leadStatusValues.join(', ') || '(none)'}`);
  lines.push(`  contains DIALING................ ${yn(f.dialingValueExists)}`);
  lines.push('');
  lines.push('Work waiting');
  lines.push(`  ACTIVE campaigns................ ${f.activeCampaigns}`);
  lines.push(`  NEW leads in ACTIVE campaigns... ${f.newLeadsInActiveCampaigns}`);
  lines.push(`  dialable in first poll cycle.... ${f.immediatelyDialableFirstCycle}`);
  lines.push('');
  lines.push('Dialing path');
  lines.push(
    `  worker dialer enabled........... ${yn(f.workerDialerEnabled)} (${f.workerDialerDetail})`
  );
  lines.push(`  MAX_CONCURRENT_CALLS............ ${f.maxConcurrentCalls}`);
  lines.push(`  DIALER_BATCH_SIZE............... ${f.dialerBatchSize}`);
  lines.push(`  FreeSWITCH ESL reachable........ ${yn(f.eslReachable)} (${f.eslDetail})`);
  lines.push(`  FracTEL gateways configured..... ${yn(f.fractelGatewaysConfigured)}`);
  lines.push(`  gateway names................... ${f.fractelGatewayNames.join(', ') || '(none)'}`);
  lines.push(`  active FracTEL POOL numbers..... ${f.fractelPoolNumberCount}`);
  lines.push('');
  lines.push('Findings');
  for (const finding of report.findings) lines.push(`  • ${finding}`);
  if (report.warnings.length > 0) {
    lines.push('');
    lines.push('Warnings');
    for (const w of report.warnings) lines.push(`  ! ${w}`);
  }
  lines.push('');
  lines.push('='.repeat(72));
  lines.push(`VERDICT: ${report.verdict}`);
  if (report.repairWouldStartCallsImmediately) {
    lines.push('');
    lines.push('  Repairing the Hopper WOULD place real outbound telephone calls');
    lines.push('  immediately. Do not repair it without explicit authorisation and a');
    lines.push('  plan for the campaigns listed above.');
  }
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// I/O layer
// ---------------------------------------------------------------------------

/** The read-only surface the probe needs. Narrow, so tests can supply a fake. */
export interface PreflightQueryClient {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
}

export interface PreflightEnv {
  MAX_CONCURRENT_CALLS?: string;
  DIALER_BATCH_SIZE?: string;
  FREESWITCH_ESL_HOST?: string;
  FREESWITCH_HOST?: string;
  FREESWITCH_ESL_PORT?: string;
  DIALER_WORKER_ENABLED?: string;
}

export interface PreflightDeps {
  db: PreflightQueryClient;
  env: PreflightEnv;
  /** TCP reachability probe. Injected so tests never open a socket. */
  checkEsl: (host: string, port: number) => Promise<{ reachable: boolean; detail: string }>;
}

function intFromEnv(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function firstCount(rows: unknown): number {
  if (!Array.isArray(rows) || rows.length === 0) return 0;
  const value = (rows[0] as Record<string, unknown>).count;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number.parseInt(value, 10) || 0;
  return 0;
}

/**
 * Gather facts. Every statement is a SELECT.
 *
 * Note the Hopper's own env-var precedence is reproduced exactly
 * (`FREESWITCH_ESL_HOST || FREESWITCH_HOST || 'freeswitch'`) so the reachability
 * answer describes the host the Hopper would actually dial through, not a
 * plausible-looking different one.
 */
export async function probeHopperPreflight(deps: PreflightDeps): Promise<HopperPreflightFacts> {
  const { db, env } = deps;

  const enumRows = await db.$queryRawUnsafe<Array<{ value: string }>>(
    `SELECT e.enumlabel AS value
       FROM pg_type t
       JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typname = 'LeadStatus'
      ORDER BY e.enumsortorder`
  );
  const leadStatusValues = Array.isArray(enumRows) ? enumRows.map(r => r.value) : [];
  const leadStatusEnumExists = leadStatusValues.length > 0;

  const activeCampaigns = firstCount(
    await db.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count FROM "campaigns" WHERE status = 'ACTIVE'`
    )
  );

  // Exactly the Hopper's selection predicate (dialer-worker.ts:325-338).
  const newLeadsInActiveCampaigns = firstCount(
    await db.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count
         FROM "leads" l
         INNER JOIN "campaigns" c ON l."campaignId" = c.id
        WHERE l.status = 'NEW' AND c.status = 'ACTIVE'`
    )
  );

  const fractelPoolNumberCount = firstCount(
    await db.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count
         FROM "phone_numbers"
        WHERE provider = 'fractel' AND status = 'ACTIVE' AND "poolType" = 'POOL'`
    )
  );

  const tenantsWithoutCallerIdPool = firstCount(
    await db.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count FROM (
         SELECT c."tenantId"
           FROM "campaigns" c
          WHERE c.status = 'ACTIVE'
          GROUP BY c."tenantId"
         EXCEPT
         SELECT p."tenantId"
           FROM "phone_numbers" p
          WHERE p.provider = 'fractel' AND p.status = 'ACTIVE' AND p."poolType" = 'POOL'
          GROUP BY p."tenantId"
       ) AS missing`
    )
  );

  const maxConcurrentCalls = intFromEnv(env.MAX_CONCURRENT_CALLS, 10);
  const dialerBatchSize = intFromEnv(env.DIALER_BATCH_SIZE, 50);
  const immediatelyDialableFirstCycle = Math.min(
    newLeadsInActiveCampaigns,
    maxConcurrentCalls,
    dialerBatchSize
  );

  const eslHost = env.FREESWITCH_ESL_HOST || env.FREESWITCH_HOST || 'freeswitch';
  const eslPort = intFromEnv(env.FREESWITCH_ESL_PORT, 8021);
  const esl = await deps.checkEsl(eslHost, eslPort);

  // The Hopper is started unconditionally by the worker entrypoint — there is no
  // env flag guarding it, which is audit finding F-5 (no kill switch).
  const workerDialerEnabled = env.DIALER_WORKER_ENABLED !== 'false';
  const workerDialerDetail =
    env.DIALER_WORKER_ENABLED === undefined
      ? 'started unconditionally by apps/worker/src/index.ts; no kill switch exists'
      : `DIALER_WORKER_ENABLED=${env.DIALER_WORKER_ENABLED}`;

  // The Hopper hard-codes this list (dialer-worker.ts:30). Presence of active
  // FracTEL numbers is the observable proxy for the gateways being provisioned.
  const fractelGatewayNames = [
    'fractel1',
    'fractel2',
    'fractel3',
    'fractel4',
    'fractel5',
    'fractel6',
  ];

  return {
    leadStatusEnumExists,
    leadStatusValues,
    dialingValueExists: leadStatusValues.includes('DIALING'),
    activeCampaigns,
    newLeadsInActiveCampaigns,
    immediatelyDialableFirstCycle,
    workerDialerEnabled,
    workerDialerDetail,
    maxConcurrentCalls,
    dialerBatchSize,
    eslReachable: esl.reachable,
    eslDetail: esl.detail,
    fractelGatewaysConfigured: fractelPoolNumberCount > 0,
    fractelGatewayNames,
    fractelPoolNumberCount,
    tenantsWithoutCallerIdPool,
  };
}
