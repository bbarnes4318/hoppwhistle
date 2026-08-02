/**
 * Dialer V2 — authoritative extension and SIP-identity resolution.
 *
 * ── Two defects this closes ──────────────────────────────────────────────────
 *
 * 1. Every `AgentRecord` defaulted to `extension: null`, and the runtime asked
 *    `sipRegistry.isRegistered(tenantId, record.extension)`. A null extension
 *    can never match a registration, so NO real agent could ever pass SIP
 *    eligibility. Authoritative SIP tracking was structurally inert.
 *
 * 2. `SipRegistrationRegistry` fell back to the SIP `domain_name` header as the
 *    tenant id. A SIP domain is not a Hoppwhistle tenant id. Accepting it means
 *    a registration on any domain that happens to look like a tenant id gets
 *    attributed to that tenant — the caller controls the domain in the REGISTER,
 *    so this is attacker-influenced input being used as a tenancy boundary.
 *
 * Both are resolved here, server-side, from the application database. Nothing is
 * inferred from the browser, and nothing is inferred from a SIP header alone.
 */

import { isValidTenantId } from '../config/redis-keys.js';

export interface ExtensionBinding {
  tenantId: string;
  userId: string;
  agentId: string;
  extension: string;
  /** SIP profile / domain the extension lives on. */
  sipDomain: string;
  enabled: boolean;
  maxConcurrentCalls: number;
}

export enum ExtensionRejection {
  UNKNOWN_AGENT = 'UNKNOWN_AGENT',
  NO_EXTENSION = 'NO_EXTENSION',
  DISABLED = 'DISABLED',
  CROSS_TENANT = 'CROSS_TENANT',
  AMBIGUOUS = 'AMBIGUOUS',
  UNRESOLVED_SIP_IDENTITY = 'UNRESOLVED_SIP_IDENTITY',
  LOOKUP_FAILED = 'LOOKUP_FAILED',
}

export type ExtensionResolution =
  | { ok: true; binding: ExtensionBinding }
  | { ok: false; rejection: ExtensionRejection };

/**
 * Authoritative source of extension bindings, backed by the application
 * database in production.
 *
 * `byAgent` must return **every** binding for the agent so ambiguity is
 * detectable rather than silently resolved to whichever row came back first.
 */
export interface ExtensionSource {
  byAgent(tenantId: string, agentId: string): Promise<ExtensionBinding[]>;
  /** Resolve a SIP identity observed on the wire back to a verified binding. */
  bySipIdentity(extension: string, sipDomain: string): Promise<ExtensionBinding[]>;
}

export interface ExtensionResolverOptions {
  source: ExtensionSource;
  now?: () => number;
  ttlMs?: number;
}

const DEFAULT_TTL_MS = 60_000;

interface CacheEntry {
  resolution: ExtensionResolution;
  resolvedAtMs: number;
}

export class ExtensionResolver {
  private readonly byAgentCache = new Map<string, CacheEntry>();
  private readonly bySipCache = new Map<string, CacheEntry>();
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor(private readonly options: ExtensionResolverOptions) {
    this.now = options.now ?? (() => Date.now());
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  }

  private fresh(entry: CacheEntry | undefined): boolean {
    return entry !== undefined && this.now() - entry.resolvedAtMs <= this.ttlMs;
  }

  /**
   * Resolve the extension an agent is entitled to operate.
   *
   * Never accepts an extension from the caller. Never assumes
   * `agentId === extension`. Never falls back to a default.
   */
  async forAgent(tenantId: string, agentId: string): Promise<ExtensionResolution> {
    if (!isValidTenantId(tenantId) || !agentId) {
      return { ok: false, rejection: ExtensionRejection.UNKNOWN_AGENT };
    }

    const key = `${tenantId} ${agentId}`;
    const cached = this.byAgentCache.get(key);
    if (this.fresh(cached)) return cached!.resolution;

    let bindings: ExtensionBinding[];
    try {
      bindings = await this.options.source.byAgent(tenantId, agentId);
    } catch {
      // Fail closed. A database blip must not grant capacity, and must not be
      // cached as a durable negative either.
      return { ok: false, rejection: ExtensionRejection.LOOKUP_FAILED };
    }

    const resolution = this.evaluate(tenantId, bindings);
    this.byAgentCache.set(key, { resolution, resolvedAtMs: this.now() });
    return resolution;
  }

  /**
   * Resolve a SIP identity seen in a registration event to a verified binding.
   *
   * This is what replaces treating `domain_name` as a tenant id: the domain is
   * an input to a lookup, never an output.
   */
  async forSipIdentity(extension: string, sipDomain: string): Promise<ExtensionResolution> {
    if (!extension || !sipDomain) {
      return { ok: false, rejection: ExtensionRejection.UNRESOLVED_SIP_IDENTITY };
    }

    const key = `${extension}@${sipDomain}`;
    const cached = this.bySipCache.get(key);
    if (this.fresh(cached)) return cached!.resolution;

    let bindings: ExtensionBinding[];
    try {
      bindings = await this.options.source.bySipIdentity(extension, sipDomain);
    } catch {
      return { ok: false, rejection: ExtensionRejection.LOOKUP_FAILED };
    }

    if (bindings.length === 0) {
      const resolution: ExtensionResolution = {
        ok: false,
        rejection: ExtensionRejection.UNRESOLVED_SIP_IDENTITY,
      };
      this.bySipCache.set(key, { resolution, resolvedAtMs: this.now() });
      return resolution;
    }

    const resolution = this.evaluate(bindings[0].tenantId, bindings);
    this.bySipCache.set(key, { resolution, resolvedAtMs: this.now() });
    return resolution;
  }

  private evaluate(tenantId: string, bindings: ExtensionBinding[]): ExtensionResolution {
    if (bindings.length === 0) {
      return { ok: false, rejection: ExtensionRejection.NO_EXTENSION };
    }

    // A binding that belongs to another tenant is not merely filtered out — its
    // presence means the lookup itself is wrong, and continuing would risk
    // picking it up on a later code path.
    if (bindings.some(b => b.tenantId !== tenantId)) {
      return { ok: false, rejection: ExtensionRejection.CROSS_TENANT };
    }

    const enabled = bindings.filter(b => b.enabled);
    if (enabled.length === 0) {
      return { ok: false, rejection: ExtensionRejection.DISABLED };
    }
    // Two live extensions for one agent means we cannot say which one a call
    // would reach. Ambiguity is not resolved by guessing.
    if (enabled.length > 1) {
      return { ok: false, rejection: ExtensionRejection.AMBIGUOUS };
    }

    return { ok: true, binding: enabled[0] };
  }

  /** Drop a cached mapping, e.g. after an extension is reassigned. */
  invalidateAgent(tenantId: string, agentId: string): void {
    this.byAgentCache.delete(`${tenantId} ${agentId}`);
  }

  invalidateSipIdentity(extension: string, sipDomain: string): void {
    this.bySipCache.delete(`${extension}@${sipDomain}`);
  }

  invalidateAll(): void {
    this.byAgentCache.clear();
    this.bySipCache.clear();
  }
}

/** In-memory source for tests and an explicitly labelled development fixture. */
export class StaticExtensionSource implements ExtensionSource {
  private readonly bindings: ExtensionBinding[] = [];

  add(binding: ExtensionBinding): void {
    this.bindings.push(binding);
  }

  clear(): void {
    this.bindings.length = 0;
  }

  byAgent(tenantId: string, agentId: string): Promise<ExtensionBinding[]> {
    return Promise.resolve(
      this.bindings.filter(b => b.agentId === agentId && b.tenantId === tenantId)
    );
  }

  /**
   * Deliberately matches on extension+domain WITHOUT filtering by tenant, so a
   * cross-tenant collision is visible to `evaluate` rather than hidden by the
   * query.
   */
  bySipIdentity(extension: string, sipDomain: string): Promise<ExtensionBinding[]> {
    return Promise.resolve(
      this.bindings.filter(b => b.extension === extension && b.sipDomain === sipDomain)
    );
  }
}
