/**
 * Dialer V2 — database-backed extension and assignment sources.
 *
 * ── What the schema actually contains ────────────────────────────────────────
 *
 * I inspected `apps/api/prisma/schema.prisma` before writing this, and the
 * shape is not what a dialer would expect. Recording it here because it
 * determines what these classes can and cannot do:
 *
 *  - There is **no** `extension` column anywhere. The agent extension lives in
 *    `User.metadata` as a JSON field, assigned dynamically from a 1000–1019
 *    pool by `apps/api/src/routes/agent-phone.ts:1027-1096`.
 *  - There is **no** `sipDomain` column. The SIP realm is deployment config,
 *    not per-user data, so it is injected rather than queried.
 *  - There is **no** Agent model. `User` is the agent, so `agentId` is the user
 *    id — but that equality is asserted in exactly one place (here) rather than
 *    assumed throughout.
 *  - There is **no** Queue, Team, or Skill model.
 *  - There is **no** relation between `User` and `Campaign` in either
 *    direction, and no join table. `Campaign` relates to publishers, buyers,
 *    phone numbers, leads, and DID routes — never to an agent.
 *
 * The consequence for assignments is stated plainly in
 * `DatabaseAssignmentSource`: campaign membership cannot be resolved from this
 * schema, so it resolves to none and says so, rather than inventing a table or
 * quietly returning a wildcard.
 */

import type { AgentAssignment, AssignmentSource } from './assignments.js';
import type { ExtensionBinding, ExtensionSource } from './extension-resolver.js';

/**
 * The narrow read surface these sources need. Injected rather than importing
 * `@prisma/client`, so dialer-v2 does not take a dependency on the API's
 * generated client and every branch is testable without a database.
 */
export interface DialerV2Db {
  user: {
    findMany(args: {
      where: Record<string, unknown>;
      select: Record<string, boolean>;
    }): Promise<Array<Record<string, unknown>>>;
  };
  campaignAgent: {
    findMany(args: {
      where: Record<string, unknown>;
      select: Record<string, unknown>;
      orderBy?: Record<string, unknown> | Array<Record<string, unknown>>;
      /** Used by the schema probe to prove the relation without reading rows. */
      take?: number;
    }): Promise<Array<Record<string, unknown>>>;
  };
}

export interface DatabaseExtensionSourceOptions {
  db: DialerV2Db;
  /**
   * The SIP realm agents register against. Deployment configuration — there is
   * no per-user domain column to read.
   */
  sipDomain: string;
  /** Concurrent calls a single agent extension may hold. */
  maxConcurrentCalls?: number;
}

/** Extract the extension from `User.metadata`, matching how agent-phone stores it. */
export function extensionFromMetadata(metadata: unknown): string | null {
  if (typeof metadata !== 'object' || metadata === null) return null;
  const value = (metadata as Record<string, unknown>).extension;
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  // agent-phone writes it as a number in some paths.
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

export class DatabaseExtensionSource implements ExtensionSource {
  private readonly maxConcurrentCalls: number;

  constructor(private readonly options: DatabaseExtensionSourceOptions) {
    this.maxConcurrentCalls = options.maxConcurrentCalls ?? 1;
  }

  private toBinding(row: Record<string, unknown>): ExtensionBinding | null {
    const extension = extensionFromMetadata(row.metadata);
    const tenantId = typeof row.tenantId === 'string' ? row.tenantId : null;
    const userId = typeof row.id === 'string' ? row.id : null;
    if (!extension || !tenantId || !userId) return null;

    return {
      tenantId,
      userId,
      // User IS the agent in this schema. Asserted here, once, rather than
      // assumed at every call site.
      agentId: userId,
      extension,
      sipDomain: this.options.sipDomain,
      // A suspended or inactive user is not a usable endpoint however their
      // extension is configured.
      enabled: row.status === 'ACTIVE',
      maxConcurrentCalls: this.maxConcurrentCalls,
    };
  }

  async byAgent(tenantId: string, agentId: string): Promise<ExtensionBinding[]> {
    const rows = await this.options.db.user.findMany({
      // Tenant is part of the predicate, not a post-filter: a cross-tenant row
      // must never be fetched in the first place.
      where: { id: agentId, tenantId },
      select: { id: true, tenantId: true, status: true, metadata: true },
    });
    return rows.map(r => this.toBinding(r)).filter((b): b is ExtensionBinding => b !== null);
  }

  /**
   * Resolve a SIP identity seen on the wire.
   *
   * Deliberately queries WITHOUT a tenant predicate. If the same extension
   * exists in two tenants that is a real configuration collision, and the
   * resolver must see both rows to reject it — a tenant-scoped query would hide
   * the collision and silently pick one.
   *
   * The metadata JSON has no queryable index for `extension`, so this filters in
   * application code over active users for the domain. That is acceptable at the
   * scale of one row per agent and is called at most once per registration per
   * cache TTL; it would need a real column to scale further.
   */
  async bySipIdentity(extension: string, sipDomain: string): Promise<ExtensionBinding[]> {
    if (sipDomain !== this.options.sipDomain) return [];

    const rows = await this.options.db.user.findMany({
      where: { status: 'ACTIVE', NOT: { tenantId: null } },
      select: { id: true, tenantId: true, status: true, metadata: true },
    });

    return rows
      .map(r => this.toBinding(r))
      .filter((b): b is ExtensionBinding => b !== null && b.extension === extension);
  }
}

export enum AssignmentUnavailableReason {
  /** The agent-to-campaign table is absent — the migration has not been applied. */
  NO_SCHEMA_SUPPORT = 'NO_SCHEMA_SUPPORT',
  /** The query failed. Distinct from "this agent has no campaigns". */
  LOOKUP_FAILED = 'LOOKUP_FAILED',
}

export interface DatabaseAssignmentSourceOptions {
  db: DialerV2Db;
  /** Reported through health so a gap is visible rather than implied. */
  onUnavailable?: (reason: AssignmentUnavailableReason, detail: string) => void;
  /**
   * How every lookup ended, including the successful ones.
   *
   * `onUnavailable` alone cannot drive capability health, because it only fires
   * on failure — silence from it means either "everything is fine" or "nothing
   * has been tried yet", and health has to tell those apart. This fires on every
   * path, so an absence of events is unambiguous.
   */
  onLookup?: (outcome: AssignmentLookupResult) => void;
}

/** How a single `resolve` ended, from the perspective of capability health. */
export enum AssignmentLookupResult {
  /** The queries ran. Zero campaigns is a success — the agent may have no work. */
  SUCCESS = 'success',
  /** `campaign_agents` is absent. The migration has not been applied here. */
  SCHEMA_MISSING = 'schema_missing',
  /** The query errored for some other reason. */
  FAILED = 'failed',
}

/**
 * Database-backed assignment source, reading `campaign_agents`.
 *
 * ── What changed ─────────────────────────────────────────────────────────────
 *
 * The schema previously modelled no relation between an agent and a campaign in
 * either direction — no join table, no relation on `User`, no relation on
 * `Campaign`, no Queue, Team, or Skill model. This class failed closed and
 * reported `NO_SCHEMA_SUPPORT`, which was correct but permanent: with no
 * assignments, every campaign forecast counts zero agents and the shadow history
 * can never become evidence.
 *
 * Migration `20260802000000_add_campaign_agent_assignments` adds the smallest
 * table that closes it. This reads it.
 *
 * ── Why a failed query is not an empty result ────────────────────────────────
 *
 * A `catch` that returns `[]` would make an unreachable database look exactly
 * like an agent nobody has assigned to anything. Both produce no capacity, so
 * the dialer behaves identically — but one is a configuration state and the
 * other is an outage, and only one of them should page somebody. A failure
 * returns null and is reported.
 */
export class DatabaseAssignmentSource implements AssignmentSource {
  constructor(private readonly options: DatabaseAssignmentSourceOptions) {}

  async resolve(tenantId: string, agentId: string): Promise<AgentAssignment | null> {
    // The agent must still be an active user of this tenant. An assignment row
    // outliving a suspended user would otherwise keep granting capacity.
    let users: Array<Record<string, unknown>>;
    try {
      users = await this.options.db.user.findMany({
        where: { id: agentId, tenantId, status: 'ACTIVE' },
        select: { id: true, tenantId: true, status: true },
      });
    } catch (error) {
      this.options.onUnavailable?.(
        AssignmentUnavailableReason.LOOKUP_FAILED,
        (error as Error).message
      );
      this.options.onLookup?.(AssignmentLookupResult.FAILED);
      return null;
    }

    // An unknown, disabled, or cross-tenant user resolves to null, which the
    // AssignmentResolver already treats as no capacity. The lookup itself
    // succeeded though — a cross-tenant request being correctly refused is the
    // source working, not the source failing, and reporting it as a failure
    // would let one bad request mark the whole capability unhealthy.
    if (users.length !== 1) {
      this.options.onLookup?.(AssignmentLookupResult.SUCCESS);
      return null;
    }

    try {
      const rows = await this.options.db.campaignAgent.findMany({
        // Tenant is part of the predicate, not a post-filter, and the campaign's
        // own tenant is checked too. A row whose campaign belongs to another
        // tenant is a data-integrity failure, and the unique constraint does not
        // prevent one being inserted with a mismatched pair.
        where: {
          tenantId,
          userId: agentId,
          status: 'ACTIVE',
          campaign: { tenantId, status: 'ACTIVE' },
        },
        select: { campaignId: true, priority: true },
        orderBy: [{ priority: 'asc' }, { campaignId: 'asc' }],
      });

      const campaignIds: string[] = [];
      for (const row of rows) {
        if (typeof row.campaignId === 'string' && row.campaignId.length > 0) {
          campaignIds.push(row.campaignId);
        }
      }

      this.options.onLookup?.(AssignmentLookupResult.SUCCESS);
      return {
        tenantId,
        agentId,
        campaignIds,
        // Queues are still not modelled. Reported as empty rather than
        // synthesised from campaigns, which would invent a concept the rest of
        // the system does not have.
        queueIds: [],
        resolvedAtMs: 0,
      };
    } catch (error) {
      const detail = (error as Error).message;
      // A missing table means the migration has not been applied here. That is
      // a deployment state worth naming, not a generic query failure.
      const missing = /campaign_agents|does not exist|Unknown arg|relation/i.test(detail);
      this.options.onUnavailable?.(
        missing
          ? AssignmentUnavailableReason.NO_SCHEMA_SUPPORT
          : AssignmentUnavailableReason.LOOKUP_FAILED,
        detail
      );
      this.options.onLookup?.(
        missing ? AssignmentLookupResult.SCHEMA_MISSING : AssignmentLookupResult.FAILED
      );
      return null;
    }
  }
}
