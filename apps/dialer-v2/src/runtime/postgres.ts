/**
 * Dialer V2 — PostgreSQL connection, failure classification, and health.
 *
 * ── Why failures are classified rather than collapsed ────────────────────────
 *
 * `connectPostgres` used to be one `try` returning `null` on any throw, and
 * composition reported that as:
 *
 *     "DATABASE_URL must point at a reachable PostgreSQL —
 *      connection failed or the users table is absent"
 *
 * Four genuinely different deployment faults reach that line: the generated
 * Prisma client was never built, the package is not installed, the host is
 * unreachable, and the credentials are wrong. They need four different people to
 * fix them, and the message named none of them. The one this repository actually
 * hit — an image built without `prisma generate` — would have been read as a
 * network problem and escalated to the wrong team.
 *
 * ── Why the detail text is fixed per category ────────────────────────────────
 *
 * Prisma's own error messages routinely embed the datasource URL, and the URL
 * carries the password. Anything derived from `error.message` is therefore a
 * credential the moment it reaches a log aggregator. Classification reads the
 * message; nothing that leaves this module is derived from it. Each category maps
 * to a fixed sentence written here.
 */

import type { DialerV2Db } from '../agents/db-sources.js';

/** What went wrong, at the granularity someone on call needs to act. */
export enum PostgresFailure {
  /** `@prisma/client` resolves, but `prisma generate` never ran for it. */
  CLIENT_NOT_GENERATED = 'client_not_generated',
  /** `@prisma/client` is not installed beside the artifact at all. */
  CLIENT_NOT_INSTALLED = 'client_not_installed',
  /** The host refused, does not resolve, or never answered. */
  UNREACHABLE = 'unreachable',
  /** The server answered and rejected the credentials or the database name. */
  AUTHENTICATION_REJECTED = 'authentication_rejected',
  /** Connected and authenticated, but a table this service reads is absent. */
  SCHEMA_INCOMPLETE = 'schema_incomplete',
  /** The probe exceeded its bound. */
  TIMEOUT = 'timeout',
  UNKNOWN = 'unknown',
}

/**
 * A fixed, credential-free sentence per category.
 *
 * Never interpolate an error message, URL, host, user, or SQL fragment into
 * these. The category is the whole diagnosis that leaves this process.
 */
export function describePostgresFailure(category: PostgresFailure): string {
  switch (category) {
    case PostgresFailure.CLIENT_NOT_GENERATED:
      return 'the generated Prisma client is missing — run `prisma generate` during image or artifact construction, before starting this service';
    case PostgresFailure.CLIENT_NOT_INSTALLED:
      return '@prisma/client is not installed beside this artifact — it is a production dependency and must be present in node_modules';
    case PostgresFailure.UNREACHABLE:
      return 'the database host refused the connection, did not resolve, or did not answer';
    case PostgresFailure.AUTHENTICATION_REJECTED:
      return 'the database rejected the supplied credentials or database name';
    case PostgresFailure.SCHEMA_INCOMPLETE:
      return 'the database is reachable but a table this service reads does not exist — a migration has not been applied here';
    case PostgresFailure.TIMEOUT:
      return 'the database did not answer a bounded probe within its timeout';
    case PostgresFailure.UNKNOWN:
      return 'the database could not be used, for a reason this service could not classify';
  }
}

/**
 * Classify a thrown value without retaining any of it.
 *
 * Ordering matters: the client-generation checks run before the connectivity
 * ones because a missing generated client throws a message that also mentions
 * the datasource, and misreading it as a network fault is exactly the failure
 * this function exists to prevent.
 */
export function classifyPostgresError(error: unknown): PostgresFailure {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: unknown } | null)?.code;
  const codeText = typeof code === 'string' ? code : '';

  // Prisma's own wording when the client package exists but was never generated.
  if (/did not initialize yet|Please run ["'`]?prisma generate/i.test(message)) {
    return PostgresFailure.CLIENT_NOT_GENERATED;
  }
  // esbuild/node resolution wording for the generated output directory itself.
  if (/\.prisma[/\\]client/i.test(message)) {
    return PostgresFailure.CLIENT_NOT_GENERATED;
  }
  if (
    (codeText === 'ERR_MODULE_NOT_FOUND' || codeText === 'MODULE_NOT_FOUND') &&
    /@prisma[/\\]client/i.test(message)
  ) {
    return PostgresFailure.CLIENT_NOT_INSTALLED;
  }
  if (/Cannot find (module|package) ['"`]?@prisma[/\\]client/i.test(message)) {
    return PostgresFailure.CLIENT_NOT_INSTALLED;
  }

  if (codeText === 'P1000' || /Authentication failed|password authentication/i.test(message)) {
    return PostgresFailure.AUTHENTICATION_REJECTED;
  }
  if (codeText === 'P1003' || /database .* does not exist/i.test(message)) {
    return PostgresFailure.AUTHENTICATION_REJECTED;
  }
  if (
    codeText === 'P1001' ||
    codeText === 'P1002' ||
    codeText === 'ECONNREFUSED' ||
    codeText === 'ENOTFOUND' ||
    /Can't reach database server|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ECONNRESET/i.test(message)
  ) {
    return PostgresFailure.UNREACHABLE;
  }
  if (codeText === 'P2021' || codeText === '42P01' || /relation .* does not exist/i.test(message)) {
    return PostgresFailure.SCHEMA_INCOMPLETE;
  }
  if (/timed out|timeout/i.test(message)) return PostgresFailure.TIMEOUT;

  return PostgresFailure.UNKNOWN;
}

/**
 * Does this category mean the connection itself is unusable?
 *
 * `SCHEMA_INCOMPLETE` is the one that is not. The server answered — it simply
 * lacks a relation — so connectivity is demonstrably fine and the fix is a
 * migration rather than anything to do with the database being up.
 */
export function indicatesUnusableConnection(category: PostgresFailure): boolean {
  return category !== PostgresFailure.SCHEMA_INCOMPLETE;
}

/** Thrown by the bounded probe. Carries no query text and no connection detail. */
export class PostgresProbeTimeout extends Error {
  readonly code = 'DIALER_V2_POSTGRES_PROBE_TIMEOUT';
  constructor(readonly timeoutMs: number) {
    super(`postgres probe exceeded ${timeoutMs}ms`);
    this.name = 'PostgresProbeTimeout';
  }
}

/**
 * Bound an operation in time.
 *
 * A probe with no timeout is not a health check: a database that accepts the
 * TCP connection and then never answers leaves the probe pending forever, and
 * health keeps reporting whatever it last decided. The unhealthy state that
 * matters most is the one that never returns.
 */
export async function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  setTimer: typeof setTimeout = setTimeout,
  clearTimer: typeof clearTimeout = clearTimeout
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimer(() => reject(new PostgresProbeTimeout(timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimer(timer);
  }
}

/** A live PostgreSQL handle. Narrow on purpose — this service only reads. */
export interface PostgresConnection {
  db: DialerV2Db;
  /** Bounded `SELECT 1`. Resolves on success, throws on failure or timeout. */
  probe(): Promise<void>;
  disconnect(): Promise<void>;
}

export type PostgresConnectResult =
  | { ok: true; connection: PostgresConnection }
  | { ok: false; category: PostgresFailure };

export interface ConnectPostgresOptions {
  /** Bound on both the startup probe and every periodic probe. */
  probeTimeoutMs?: number;
  /** Injected by tests so classification can be exercised without a database. */
  importPrisma?: () => Promise<unknown>;
}

export const DEFAULT_PROBE_TIMEOUT_MS = 5_000;

/**
 * Connect through the generated Prisma client.
 *
 * Imported dynamically so a mode that never touches a database does not require
 * the client to exist — and so a missing client is a classifiable runtime fault
 * rather than a module-load crash before any logging is configured.
 */
export async function connectPostgres(
  url: string,
  options: ConnectPostgresOptions = {}
): Promise<PostgresConnectResult> {
  const timeoutMs = options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const importPrisma = options.importPrisma ?? (() => import('@prisma/client'));

  let client: DialerV2Db & {
    $queryRawUnsafe(sql: string): Promise<unknown>;
    $disconnect(): Promise<void>;
  };

  try {
    const mod = (await importPrisma()) as {
      PrismaClient: new (opts: Record<string, unknown>) => typeof client;
    };
    if (typeof mod?.PrismaClient !== 'function') {
      // The module resolved to something without a constructor. In practice this
      // is a stub `@prisma/client` whose generated output is absent.
      return { ok: false, category: PostgresFailure.CLIENT_NOT_GENERATED };
    }
    client = new mod.PrismaClient({ datasources: { db: { url } } });
  } catch (error) {
    return { ok: false, category: classifyPostgresError(error) };
  }

  try {
    // A connection that has not executed anything has not proved anything. This
    // is the difference between "the client object exists" and "this database is
    // reachable". `SELECT 1` and nothing more: probing a specific table would
    // conflate reachability with schema state, which readiness reports apart.
    await withTimeout(Promise.resolve(client.$queryRawUnsafe('SELECT 1')), timeoutMs);
  } catch (error) {
    await client.$disconnect().catch(() => {});
    return { ok: false, category: classifyPostgresError(error) };
  }

  return {
    ok: true,
    connection: {
      db: client,
      probe: async () => {
        await withTimeout(Promise.resolve(client.$queryRawUnsafe('SELECT 1')), timeoutMs);
      },
      disconnect: async () => {
        await client.$disconnect();
      },
    },
  };
}

/**
 * Everything health knows about PostgreSQL right now.
 *
 * Timestamps rather than booleans wherever "when" is the useful question: a bare
 * `lastProbeFailed: true` cannot distinguish a failure thirty seconds ago from
 * one that has been repeating for an hour, and those call for different actions.
 */
export interface PostgresHealthSnapshot {
  connected: boolean;
  lastProbeSucceededAtMs: number | null;
  lastProbeFailedAtMs: number | null;
  consecutiveFailures: number;
  /** Category only. Never a message, URL, host, user, or SQL fragment. */
  lastFailureCategory: PostgresFailure | null;
  lastProbeLatencyMs: number | null;
  lastExtensionLookupSucceededAtMs: number | null;
  lastExtensionLookupFailedAtMs: number | null;
  lastAssignmentLookupSucceededAtMs: number | null;
  lastAssignmentLookupFailedAtMs: number | null;
}

export interface PostgresHealthMonitorOptions {
  probe: () => Promise<void>;
  /** How often to re-prove reachability. */
  intervalMs: number;
  now?: () => number;
  onTransition?: (connected: boolean, category: PostgresFailure | null) => void;
}

export const DEFAULT_PROBE_INTERVAL_MS = 10_000;

/**
 * Authoritative PostgreSQL health.
 *
 * ── The defect this replaces ─────────────────────────────────────────────────
 *
 * Health was a flag set true when the startup query succeeded and set false only
 * by `disconnect()`. Nothing else could move it. A database that went away an
 * hour after startup — failover, credential rotation, connection limit, the box
 * rebooting — left every subsequent `postgresHealthy()` returning true. The
 * service went on reporting ready, extension resolution went on failing, and the
 * two facts never met.
 *
 * "It worked once" is not a health check. Health here is a claim about *now*,
 * and it is allowed to move in both directions:
 *
 *   - a periodic bounded probe fails      → unhealthy
 *   - a real query fails during work      → unhealthy immediately, without
 *                                           waiting for the next probe tick
 *   - a later probe succeeds              → healthy again
 *
 * The second rule matters most. Real traffic finds an outage before a probe
 * scheduled every ten seconds does, and discarding that evidence to wait for a
 * tick is choosing to be wrong for up to a full interval.
 */
export class PostgresHealthMonitor {
  private connected = false;
  private lastProbeSucceededAtMs: number | null = null;
  private lastProbeFailedAtMs: number | null = null;
  private consecutiveFailures = 0;
  private lastFailureCategory: PostgresFailure | null = null;
  private lastProbeLatencyMs: number | null = null;
  private lastExtensionOkAtMs: number | null = null;
  private lastExtensionFailAtMs: number | null = null;
  private lastAssignmentOkAtMs: number | null = null;
  private lastAssignmentFailAtMs: number | null = null;

  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly now: () => number;

  constructor(private readonly options: PostgresHealthMonitorOptions) {
    this.now = options.now ?? Date.now;
  }

  /** Record that the startup probe already succeeded, without re-running it. */
  markInitiallyConnected(): void {
    this.connected = true;
    this.lastProbeSucceededAtMs = this.now();
    this.consecutiveFailures = 0;
    this.lastFailureCategory = null;
  }

  start(): void {
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => {
      void this.probeNow();
    }, this.options.intervalMs);
    // A probe timer must never be the reason a process refuses to exit.
    (this.timer as { unref?: () => void }).unref?.();
  }

  stop(): void {
    if (this.timer === undefined) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async probeNow(): Promise<boolean> {
    const startedAt = this.now();
    try {
      await this.options.probe();
      this.lastProbeLatencyMs = this.now() - startedAt;
      this.lastProbeSucceededAtMs = this.now();
      this.consecutiveFailures = 0;
      this.lastFailureCategory = null;
      this.transitionTo(true);
      return true;
    } catch (error) {
      this.lastProbeLatencyMs = this.now() - startedAt;
      this.lastProbeFailedAtMs = this.now();
      this.consecutiveFailures += 1;
      this.lastFailureCategory = classifyPostgresError(error);
      this.transitionTo(false);
      return false;
    }
  }

  /**
   * A query failed during real work.
   *
   * Reported by the database-backed sources. For a connectivity fault this is
   * first-hand evidence the database is unusable, and strictly better evidence
   * than a probe that has not run yet.
   *
   * A schema fault is deliberately NOT treated that way. `relation "x" does not
   * exist` means the server connected, authenticated, parsed the statement and
   * answered — it is a perfectly healthy database that is missing a migration.
   * Marking connectivity unhealthy for it would conflate a migration gap with an
   * outage, which is the same conflation the assignment capability rewrite
   * exists to remove, and it would page whoever owns the database for something
   * only a deploy can fix. The category is still recorded, so health reports it.
   */
  recordQueryFailure(error: unknown): void {
    const category = classifyPostgresError(error);
    this.lastFailureCategory = category;
    this.lastProbeFailedAtMs = this.now();

    if (!indicatesUnusableConnection(category)) return;

    this.consecutiveFailures += 1;
    this.transitionTo(false);
  }

  recordExtensionLookup(succeeded: boolean): void {
    if (succeeded) {
      this.lastExtensionOkAtMs = this.now();
      // A lookup that returned is proof of reachability, whatever it returned.
      this.lastProbeSucceededAtMs = this.now();
      this.consecutiveFailures = 0;
      this.lastFailureCategory = null;
      this.transitionTo(true);
    } else {
      this.lastExtensionFailAtMs = this.now();
    }
  }

  recordAssignmentLookup(succeeded: boolean): void {
    if (succeeded) {
      this.lastAssignmentOkAtMs = this.now();
      this.lastProbeSucceededAtMs = this.now();
      this.consecutiveFailures = 0;
      this.lastFailureCategory = null;
      this.transitionTo(true);
    } else {
      this.lastAssignmentFailAtMs = this.now();
    }
  }

  private transitionTo(connected: boolean): void {
    const changed = this.connected !== connected;
    this.connected = connected;
    if (changed) this.options.onTransition?.(connected, this.lastFailureCategory);
  }

  healthy(): boolean {
    return this.connected;
  }

  snapshot(): PostgresHealthSnapshot {
    return {
      connected: this.connected,
      lastProbeSucceededAtMs: this.lastProbeSucceededAtMs,
      lastProbeFailedAtMs: this.lastProbeFailedAtMs,
      consecutiveFailures: this.consecutiveFailures,
      lastFailureCategory: this.lastFailureCategory,
      lastProbeLatencyMs: this.lastProbeLatencyMs,
      lastExtensionLookupSucceededAtMs: this.lastExtensionOkAtMs,
      lastExtensionLookupFailedAtMs: this.lastExtensionFailAtMs,
      lastAssignmentLookupSucceededAtMs: this.lastAssignmentOkAtMs,
      lastAssignmentLookupFailedAtMs: this.lastAssignmentFailAtMs,
    };
  }
}
