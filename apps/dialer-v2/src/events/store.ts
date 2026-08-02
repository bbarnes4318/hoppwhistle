/**
 * Dialer V2 — event persistence and deduplication interfaces.
 *
 * The ingestor depends on these interfaces, never on Prisma directly. That
 * keeps the ingestion logic testable in memory, makes replay tests possible,
 * and means swapping the event transport later does not require touching
 * normalization or reconciliation.
 *
 * No production migration is applied by this module. A PostgreSQL
 * implementation lands with the additive migration drafted in
 * `docs/dialer-v2/DATA_MODEL.md`, which is deliberately not auto-applied.
 */

import type { NormalizedTelephonyEvent, QuarantinedEvent } from './types.js';

export interface EventStore {
  /** Persist a normalized event. Must be idempotent on `eventId`. */
  append(event: NormalizedTelephonyEvent): Promise<void>;
  /** Persist an unattributable event for later investigation. */
  quarantine(event: QuarantinedEvent): Promise<void>;
  /** Most recent events for a tenant, newest first. Used by the shadow API. */
  recentForTenant(tenantId: string, limit: number): Promise<NormalizedTelephonyEvent[]>;
  /** Count of quarantined events, for the health surface. */
  quarantinedCount(): Promise<number>;
}

/**
 * Deduplication store. Separate from `EventStore` because the two have very
 * different lifetimes: dedupe keys expire in hours, events are retained for
 * months.
 */
export interface DedupeStore {
  /**
   * Returns true if this is the first time `eventId` has been seen for this
   * tenant, false if it is a duplicate. Must be atomic — two workers racing on
   * the same event must not both receive true.
   */
  markSeen(tenantId: string, eventId: string, ttlMs: number): Promise<boolean>;
}

/**
 * In-memory implementations for tests and for the Phase 1 default when Redis
 * and PostgreSQL are not yet wired.
 *
 * `InMemoryEventStore` is bounded: an unbounded store in a long-running process
 * is a memory leak, and this one runs alongside a telephony event firehose.
 */
export class InMemoryEventStore implements EventStore {
  private readonly events: NormalizedTelephonyEvent[] = [];
  private readonly quarantined: QuarantinedEvent[] = [];
  private readonly seenIds = new Set<string>();

  constructor(private readonly maxEvents = 10_000) {}

  append(event: NormalizedTelephonyEvent): Promise<void> {
    // Idempotent on eventId, matching the contract a UNIQUE index would give.
    if (this.seenIds.has(event.eventId)) return Promise.resolve();
    this.seenIds.add(event.eventId);
    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      const dropped = this.events.splice(0, this.events.length - this.maxEvents);
      for (const d of dropped) this.seenIds.delete(d.eventId);
    }
    return Promise.resolve();
  }

  quarantine(event: QuarantinedEvent): Promise<void> {
    this.quarantined.push(event);
    if (this.quarantined.length > this.maxEvents) {
      this.quarantined.splice(0, this.quarantined.length - this.maxEvents);
    }
    return Promise.resolve();
  }

  recentForTenant(tenantId: string, limit: number): Promise<NormalizedTelephonyEvent[]> {
    const result: NormalizedTelephonyEvent[] = [];
    for (let i = this.events.length - 1; i >= 0 && result.length < limit; i--) {
      if (this.events[i].tenantId === tenantId) result.push(this.events[i]);
    }
    return Promise.resolve(result);
  }

  quarantinedCount(): Promise<number> {
    return Promise.resolve(this.quarantined.length);
  }

  /** Test helper. Not part of the interface. */
  allQuarantined(): readonly QuarantinedEvent[] {
    return this.quarantined;
  }

  /** Test helper. Not part of the interface. */
  size(): number {
    return this.events.length;
  }
}

export class InMemoryDedupeStore implements DedupeStore {
  private readonly seen = new Map<string, number>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  markSeen(tenantId: string, eventId: string, ttlMs: number): Promise<boolean> {
    const key = `${tenantId}:${eventId}`;
    const now = this.now();
    const existing = this.seen.get(key);
    if (existing !== undefined && existing > now) return Promise.resolve(false);
    this.seen.set(key, now + ttlMs);
    // Opportunistic sweep so the map does not grow without bound.
    if (this.seen.size > 50_000) {
      for (const [k, expiry] of this.seen) {
        if (expiry <= now) this.seen.delete(k);
      }
    }
    return Promise.resolve(true);
  }
}
