/**
 * Dialer V2 — authoritative SIP registration tracking.
 *
 * ── Why this replaces the browser's `sipRegistered` claim ────────────────────
 *
 * The heartbeat previously took `sipRegistered` from the browser. That is the
 * single most consequential field an agent reports: it is what distinguishes
 * "this agent can receive a call" from "this agent's tab is open". A browser
 * whose WebSocket died but whose JavaScript is still running will happily keep
 * asserting `sipRegistered: true`, and the agent stays in predictive capacity
 * while being unreachable. Every call dialed for that agent is an abandoned
 * call.
 *
 * Registration is now tracked from FreeSWITCH's own `sofia::register` /
 * `sofia::unregister` / `sofia::expire` CUSTOM events. The browser's claim is
 * kept only as a corroborating signal and is reported separately so a
 * disagreement is visible rather than silently resolved.
 */

import { isValidTenantId } from '../config/redis-keys.js';
import type { RawEslEvent } from '../events/types.js';

/** FreeSWITCH CUSTOM subclasses carrying registration state. */
export const SIP_REGISTRATION_SUBCLASSES = Object.freeze([
  'sofia::register',
  'sofia::unregister',
  'sofia::expire',
  'sofia::register_failure',
]);

export interface SipRegistration {
  tenantId: string;
  /** SIP user, i.e. the agent extension. */
  extension: string;
  registered: boolean;
  /** Expiry reported by FreeSWITCH, epoch ms. Null when not supplied. */
  expiresAtMs: number | null;
  lastEventAtMs: number;
  lastEvent: string;
  contact: string | null;
  networkIp: string | null;
}

export interface SipRegistryOptions {
  now?: () => number;
  /**
   * A registration with no refresh for longer than this is treated as gone even
   * if no unregister event arrived. FreeSWITCH does emit `sofia::expire`, but a
   * missed event must not leave an agent permanently "registered".
   */
  staleAfterMs?: number;
}

const DEFAULT_STALE_AFTER_MS = 5 * 60 * 1000;

export class SipRegistrationRegistry {
  private readonly registrations = new Map<string, SipRegistration>();
  private readonly now: () => number;
  private readonly staleAfterMs: number;

  private processed = 0;
  private unattributed = 0;
  /** Registrations we could not attribute. They contribute no capacity. */
  private readonly quarantined: Array<{
    extension: string | null;
    sipDomain: string | null;
    subclass: string;
    atMs: number;
  }> = [];

  constructor(options: SipRegistryOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  }

  private key(tenantId: string, extension: string): string {
    return `${tenantId} ${extension}`;
  }

  /**
   * Apply a raw sofia registration event.
   *
   * Returns true when the event was applied. An event whose tenant cannot be
   * established is counted and discarded — never attributed to a default.
   */
  applyRegistrationEvent(raw: RawEslEvent): boolean {
    const subclass = raw['Event-Subclass'];
    if (!subclass || !SIP_REGISTRATION_SUBCLASSES.includes(subclass)) return false;

    this.processed++;

    const extension = raw['username'] ?? raw['from-user'] ?? raw['sip_auth_username'] ?? null;

    // The SIP domain is an INPUT to a lookup, never an identity. It was
    // previously used as a tenant id fallback, which made a caller-controlled
    // REGISTER header a tenancy boundary. A registration is now attributed only
    // via an explicit tenant channel variable, or by the resolver in
    // `resolveAndApply`.
    const tenantId = raw['variable_hopwhistle_tenant_id'] ?? raw['hopwhistle_tenant_id'] ?? null;

    if (!extension || !tenantId || !isValidTenantId(tenantId)) {
      this.unattributed++;
      this.quarantine(raw, extension, subclass);
      return false;
    }

    const nowMs = this.now();
    const registered = subclass === 'sofia::register';

    const expiresRaw = raw['expires'];
    const expiresSeconds = expiresRaw ? Number.parseInt(expiresRaw, 10) : Number.NaN;
    const expiresAtMs =
      Number.isFinite(expiresSeconds) && expiresSeconds > 0 ? nowMs + expiresSeconds * 1000 : null;

    this.registrations.set(this.key(tenantId, extension), {
      tenantId,
      extension,
      registered,
      expiresAtMs,
      lastEventAtMs: nowMs,
      lastEvent: subclass,
      contact: raw['contact'] ?? null,
      networkIp: raw['network-ip'] ?? null,
    });

    return true;
  }

  private quarantine(raw: RawEslEvent, extension: string | null, subclass: string): void {
    this.quarantined.push({
      extension,
      sipDomain: raw['domain_name'] ?? raw['sip_auth_realm'] ?? null,
      subclass,
      atMs: this.now(),
    });
    if (this.quarantined.length > 500) this.quarantined.splice(0, this.quarantined.length - 500);
  }

  /**
   * Apply a registration event whose tenant was established by an authoritative
   * resolver rather than by a header on the event itself.
   */
  applyResolved(tenantId: string, extension: string, subclass: string, raw: RawEslEvent): boolean {
    if (!isValidTenantId(tenantId) || !extension) return false;
    if (!SIP_REGISTRATION_SUBCLASSES.includes(subclass)) return false;

    const nowMs = this.now();
    const expiresRaw = raw['expires'];
    const expiresSeconds = expiresRaw ? Number.parseInt(expiresRaw, 10) : Number.NaN;

    this.registrations.set(this.key(tenantId, extension), {
      tenantId,
      extension,
      registered: subclass === 'sofia::register',
      expiresAtMs:
        Number.isFinite(expiresSeconds) && expiresSeconds > 0
          ? nowMs + expiresSeconds * 1000
          : null,
      lastEventAtMs: nowMs,
      lastEvent: subclass,
      contact: raw['contact'] ?? null,
      networkIp: raw['network-ip'] ?? null,
    });
    return true;
  }

  /** Registrations that could not be attributed to a verified tenant. */
  quarantinedRegistrations(): ReadonlyArray<{
    extension: string | null;
    sipDomain: string | null;
    subclass: string;
    atMs: number;
  }> {
    return this.quarantined;
  }

  /**
   * Is this extension registered, according to FreeSWITCH?
   *
   * Returns false for an unknown extension. Absence of evidence is treated as
   * not-registered, because the cost of the two errors is asymmetric: an agent
   * wrongly excluded is idle, an agent wrongly included receives a call nobody
   * answers.
   */
  isRegistered(tenantId: string, extension: string | null): boolean {
    if (!extension) return false;
    const record = this.registrations.get(this.key(tenantId, extension));
    if (!record || !record.registered) return false;

    const nowMs = this.now();
    if (record.expiresAtMs !== null && nowMs >= record.expiresAtMs) return false;
    // Missed-event guard: no refresh in a long time means gone.
    if (nowMs - record.lastEventAtMs > this.staleAfterMs) return false;

    return true;
  }

  get(tenantId: string, extension: string): SipRegistration | undefined {
    return this.registrations.get(this.key(tenantId, extension));
  }

  listForTenant(tenantId: string): SipRegistration[] {
    const out: SipRegistration[] = [];
    for (const record of this.registrations.values()) {
      if (record.tenantId === tenantId) out.push(record);
    }
    return out;
  }

  /** Drop entries that are long gone, so the map does not grow forever. */
  sweep(): number {
    const nowMs = this.now();
    let removed = 0;
    for (const [key, record] of this.registrations) {
      const expired = record.expiresAtMs !== null && nowMs >= record.expiresAtMs;
      const silent = nowMs - record.lastEventAtMs > this.staleAfterMs * 2;
      if (!record.registered && (expired || silent)) {
        this.registrations.delete(key);
        removed++;
      }
    }
    return removed;
  }

  metrics(): {
    tracked: number;
    registered: number;
    processed: number;
    unattributed: number;
    quarantined: number;
  } {
    let registered = 0;
    for (const record of this.registrations.values()) {
      if (this.isRegistered(record.tenantId, record.extension)) registered++;
    }
    return {
      tracked: this.registrations.size,
      registered,
      processed: this.processed,
      unattributed: this.unattributed,
      quarantined: this.quarantined.length,
    };
  }
}
