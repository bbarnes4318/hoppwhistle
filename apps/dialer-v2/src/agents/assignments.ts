/**
 * Dialer V2 — server-side campaign and queue assignment resolution.
 *
 * ── Why this replaces the browser-supplied lists ─────────────────────────────
 *
 * The heartbeat previously accepted `campaignIds` and `queueIds` straight from
 * the browser. Campaign membership determines which campaign's predictive
 * capacity an agent counts toward, so a client could add itself to any campaign
 * in its tenant — inflating that campaign's forecast capacity and causing the
 * controller to dial ahead of agents that were never assigned to it. In shadow
 * mode that corrupts the recorded decisions; once origination exists it would
 * produce abandoned calls.
 *
 * Assignments are now resolved server-side. The browser may express a
 * *preference* (which of its assigned campaigns it is currently working), and
 * that preference is intersected with the authoritative set — it can narrow,
 * never widen.
 */

export interface AgentAssignment {
  tenantId: string;
  agentId: string;
  campaignIds: string[];
  queueIds: string[];
  /** When this was resolved, for staleness reporting. */
  resolvedAtMs: number;
}

/**
 * Source of authoritative assignments. Implemented against the application
 * database in production; an in-memory version backs the tests.
 */
export interface AssignmentSource {
  resolve(tenantId: string, agentId: string): Promise<AgentAssignment | null>;
}

export interface AssignmentResolverOptions {
  source: AssignmentSource;
  now?: () => number;
  /** How long a resolved assignment may be reused before re-resolving. */
  ttlMs?: number;
}

const DEFAULT_TTL_MS = 60_000;

export class AssignmentResolver {
  private readonly cache = new Map<string, AgentAssignment>();
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor(private readonly options: AssignmentResolverOptions) {
    this.now = options.now ?? (() => Date.now());
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  }

  private key(tenantId: string, agentId: string): string {
    return `${tenantId} ${agentId}`;
  }

  /**
   * Resolve an agent's authoritative assignment, optionally narrowed by the
   * agent's own stated preference.
   *
   * `preferredCampaignIds` can only ever remove entries. An id the agent is not
   * assigned to is dropped silently rather than erroring: a stale browser tab
   * holding an old campaign list is an ordinary occurrence, not an attack.
   */
  async resolve(
    tenantId: string,
    agentId: string,
    preferredCampaignIds?: readonly string[]
  ): Promise<AgentAssignment> {
    const key = this.key(tenantId, agentId);
    const nowMs = this.now();

    let assignment = this.cache.get(key);
    if (!assignment || nowMs - assignment.resolvedAtMs > this.ttlMs) {
      const resolved = await this.options.source.resolve(tenantId, agentId).catch(() => null);
      assignment = resolved ?? {
        tenantId,
        agentId,
        // Unknown assignment means NO campaigns, not all campaigns. An agent
        // whose membership cannot be established contributes to no forecast.
        campaignIds: [],
        queueIds: [],
        resolvedAtMs: nowMs,
      };
      this.cache.set(key, assignment);
    }

    if (!preferredCampaignIds || preferredCampaignIds.length === 0) {
      return assignment;
    }

    const allowed = new Set(assignment.campaignIds);
    return {
      ...assignment,
      campaignIds: preferredCampaignIds.filter(id => allowed.has(id)),
    };
  }

  invalidate(tenantId: string, agentId: string): void {
    this.cache.delete(this.key(tenantId, agentId));
  }

  size(): number {
    return this.cache.size;
  }
}

/** In-memory source for tests and for staging before the DB source is wired. */
export class StaticAssignmentSource implements AssignmentSource {
  private readonly assignments = new Map<string, AgentAssignment>();

  set(tenantId: string, agentId: string, campaignIds: string[], queueIds: string[] = []): void {
    this.assignments.set(`${tenantId} ${agentId}`, {
      tenantId,
      agentId,
      campaignIds,
      queueIds,
      resolvedAtMs: 0,
    });
  }

  resolve(tenantId: string, agentId: string): Promise<AgentAssignment | null> {
    const found = this.assignments.get(`${tenantId} ${agentId}`);
    return Promise.resolve(found ? { ...found, resolvedAtMs: 0 } : null);
  }
}
