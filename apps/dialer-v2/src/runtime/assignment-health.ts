/**
 * Dialer V2 — assignment capability health.
 *
 * ── The defect this replaces ─────────────────────────────────────────────────
 *
 * Capability was one latch, set inside the resolver:
 *
 *     if (result && result.campaignIds.length > 0) assignmentsWork = true;
 *
 * That conflates six independent facts into one boolean and gets several of them
 * backwards:
 *
 *  - **An unassigned agent reads as broken.** A lookup that succeeds and
 *    correctly returns zero campaigns leaves the flag false. On a fresh tenant,
 *    or first thing in the morning before anyone is rostered, a perfectly
 *    healthy service reports its assignment source unusable.
 *  - **A broken source reads as working.** Once any agent anywhere resolved one
 *    campaign, the latch is true permanently. Drop the table, revoke the grant,
 *    take the database away entirely — the flag never moves back.
 *  - **It cannot distinguish "not configured" from "configured and failing"**,
 *    which are a deployment mistake and an outage respectively.
 *
 * The question health needs answered is *can this service authoritatively
 * resolve campaign assignments right now* — not *have we ever seen an assigned
 * agent*. Those come apart in both directions, and the second is not a health
 * check at all.
 *
 * ── Why the schema is probed rather than inferred ────────────────────────────
 *
 * Waiting for real traffic to reveal whether `campaign_agents` exists means
 * capability is unknown until an agent happens to log in, and unknown-until-used
 * is indistinguishable from broken during the window that matters — startup,
 * which is exactly when a missing migration should be caught. So the table is
 * probed directly, with a tenant predicate that matches nothing: it proves the
 * relation exists and is readable without reading any tenant's rows.
 */

import type { DialerV2Db } from '../agents/db-sources.js';

export enum AssignmentCapability {
  /** Assignments can be resolved authoritatively right now. */
  RESOLVABLE = 'resolvable',
  /** The static fixture source is in use. Fine in development, never evidence. */
  SOURCE_NOT_DATABASE = 'source_not_database',
  /** The table is absent — the migration has not been applied here. */
  SCHEMA_MISSING = 'schema_missing',
  /** PostgreSQL itself is unhealthy, so no lookup can be trusted. */
  DATABASE_UNREACHABLE = 'database_unreachable',
  /** The table exists and the database is up, but lookups are erroring. */
  LOOKUP_FAILING = 'lookup_failing',
  /** Configured, but nothing has proved the schema yet. */
  NOT_YET_PROBED = 'not_yet_probed',
}

/** How a single assignment lookup ended. */
export enum AssignmentLookupOutcome {
  /** The query ran. Zero rows is a success — an agent may simply have no work. */
  SUCCESS = 'success',
  SCHEMA_MISSING = 'schema_missing',
  FAILED = 'failed',
}

export interface AssignmentHealthSnapshot {
  assignmentSourceConfigured: boolean;
  /** `null` until probed: unknown is a third state, not a pessimistic false. */
  assignmentSchemaPresent: boolean | null;
  assignmentDatabaseReachable: boolean;
  lastAssignmentLookupSucceeded: boolean | null;
  lastAssignmentLookupAtMs: number | null;
  lastAssignmentLookupFailureAtMs: number | null;
  capability: AssignmentCapability;
}

export interface AssignmentHealthOptions {
  /** True when the database-backed source is in use, not the static fixture. */
  configured: boolean;
  /** Live PostgreSQL health. Read on every capability question, never cached. */
  databaseReachable: () => boolean;
  now?: () => number;
}

export class AssignmentHealth {
  private schemaPresent: boolean | null = null;
  private lastLookupSucceeded: boolean | null = null;
  private lastLookupAtMs: number | null = null;
  private lastLookupFailureAtMs: number | null = null;
  private readonly now: () => number;

  constructor(private readonly options: AssignmentHealthOptions) {
    this.now = options.now ?? Date.now;
  }

  /**
   * Prove the relation exists without reading anyone's rows.
   *
   * The tenant predicate cannot match — no tenant id is the empty string — so
   * this returns zero rows on a healthy database and throws only when the table
   * is absent or unreadable.
   */
  async probeSchema(db: DialerV2Db): Promise<boolean> {
    try {
      await db.campaignAgent.findMany({
        where: { tenantId: '', userId: '' },
        select: { campaignId: true },
        take: 0,
      });
      this.schemaPresent = true;
      return true;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      // Distinguish "this table does not exist" from "the database went away
      // mid-probe". Only the first is a schema fact; the second says nothing
      // about the schema and must not be recorded as though it did.
      const missing = /campaign_agents|relation .* does not exist|Unknown arg|P2021|42P01/i.test(
        detail
      );
      this.schemaPresent = missing ? false : null;
      return false;
    }
  }

  recordLookup(outcome: AssignmentLookupOutcome): void {
    const at = this.now();
    this.lastLookupAtMs = at;

    switch (outcome) {
      case AssignmentLookupOutcome.SUCCESS:
        this.lastLookupSucceeded = true;
        // A successful read is proof the relation is there, whatever it
        // returned. Zero rows is a legitimate answer, not a degraded one.
        this.schemaPresent = true;
        break;
      case AssignmentLookupOutcome.SCHEMA_MISSING:
        this.lastLookupSucceeded = false;
        this.lastLookupFailureAtMs = at;
        this.schemaPresent = false;
        break;
      case AssignmentLookupOutcome.FAILED:
        this.lastLookupSucceeded = false;
        this.lastLookupFailureAtMs = at;
        // Deliberately leaves schemaPresent alone: a connection dropping says
        // nothing about whether the table exists.
        break;
    }
  }

  /**
   * The single question worth asking, evaluated fresh every time.
   *
   * Order is deliberate: an unreachable database outranks a previously observed
   * schema, because nothing can be resolved through a database that is down
   * however good the schema was last time anyone looked.
   */
  capability(): AssignmentCapability {
    if (!this.options.configured) return AssignmentCapability.SOURCE_NOT_DATABASE;
    if (!this.options.databaseReachable()) return AssignmentCapability.DATABASE_UNREACHABLE;
    if (this.schemaPresent === false) return AssignmentCapability.SCHEMA_MISSING;
    if (this.schemaPresent === null) return AssignmentCapability.NOT_YET_PROBED;
    if (this.lastLookupSucceeded === false) return AssignmentCapability.LOOKUP_FAILING;
    return AssignmentCapability.RESOLVABLE;
  }

  resolvable(): boolean {
    return this.capability() === AssignmentCapability.RESOLVABLE;
  }

  snapshot(): AssignmentHealthSnapshot {
    return {
      assignmentSourceConfigured: this.options.configured,
      assignmentSchemaPresent: this.schemaPresent,
      assignmentDatabaseReachable: this.options.databaseReachable(),
      lastAssignmentLookupSucceeded: this.lastLookupSucceeded,
      lastAssignmentLookupAtMs: this.lastLookupAtMs,
      lastAssignmentLookupFailureAtMs: this.lastLookupFailureAtMs,
      capability: this.capability(),
    };
  }
}
