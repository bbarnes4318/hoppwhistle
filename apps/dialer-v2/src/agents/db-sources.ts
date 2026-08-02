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
  /** No agent-to-campaign relation exists in the Prisma schema. */
  NO_SCHEMA_SUPPORT = 'NO_SCHEMA_SUPPORT',
}

export interface DatabaseAssignmentSourceOptions {
  db: DialerV2Db;
  /** Reported through health so the gap is visible rather than implied. */
  onUnavailable?: (reason: AssignmentUnavailableReason) => void;
}

/**
 * Database-backed assignment source.
 *
 * ── Why this resolves to nothing ─────────────────────────────────────────────
 *
 * There is no agent-to-campaign assignment anywhere in the schema: no join
 * table, no relation on `User`, no relation on `Campaign`, and no Queue, Team,
 * or Skill model. Campaign membership is simply not modelled.
 *
 * Three options were available. Inventing a table was explicitly out of scope.
 * Returning a wildcard would put every agent into every campaign, inflating
 * predictive capacity for campaigns nobody is assigned to — the exact failure
 * the server-side resolution work was meant to close. So this resolves the part
 * that IS modelled — tenant ownership and user status — and returns no
 * campaigns, which fails closed.
 *
 * Until an assignment model exists, no agent contributes to any campaign
 * forecast. Health reports `NO_SCHEMA_SUPPORT` so this is visible rather than
 * looking like an empty roster.
 */
export class DatabaseAssignmentSource implements AssignmentSource {
  constructor(private readonly options: DatabaseAssignmentSourceOptions) {}

  async resolve(tenantId: string, agentId: string): Promise<AgentAssignment | null> {
    const rows = await this.options.db.user.findMany({
      where: { id: agentId, tenantId, status: 'ACTIVE' },
      select: { id: true, tenantId: true, status: true },
    });

    // An unknown, disabled, or cross-tenant user resolves to null, which the
    // AssignmentResolver already treats as no capacity.
    if (rows.length !== 1) return null;

    this.options.onUnavailable?.(AssignmentUnavailableReason.NO_SCHEMA_SUPPORT);

    return {
      tenantId,
      agentId,
      campaignIds: [],
      queueIds: [],
      resolvedAtMs: 0,
    };
  }
}
