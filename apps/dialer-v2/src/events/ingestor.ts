/**
 * Dialer V2 — event ingestor.
 *
 * Raw ESL event → normalize → dedupe → persist → notify subscribers.
 *
 * This module does not connect to FreeSWITCH; it is fed by `EslClient`. That
 * separation is what makes the whole ingestion path testable by calling
 * `handleRaw()` with a header map, no socket required.
 *
 * It NEVER originates a call and has no code path that writes to FreeSWITCH.
 */

import { normalizeEslEvent } from './normalize.js';
import type { DedupeStore, EventStore } from './store.js';
import { EVENT_STATE_RANK, type NormalizedTelephonyEvent, type RawEslEvent } from './types.js';

const DEFAULT_DEDUPE_TTL_MS = 24 * 60 * 60 * 1000;

export interface IngestorMetrics {
  received: number;
  normalized: number;
  duplicates: number;
  quarantined: number;
  outOfOrder: number;
  errors: number;
}

export interface IngestorOptions {
  store: EventStore;
  dedupe: DedupeStore;
  now?: () => number;
  dedupeTtlMs?: number;
  /** Called for each accepted, non-duplicate event. Must not throw. */
  onEvent?: (event: NormalizedTelephonyEvent) => void;
  onError?: (error: Error, context: string) => void;
}

export class EventIngestor {
  private readonly store: EventStore;
  private readonly dedupe: DedupeStore;
  private readonly now: () => number;
  private readonly dedupeTtlMs: number;
  private readonly onEvent?: (event: NormalizedTelephonyEvent) => void;
  private readonly onError?: (error: Error, context: string) => void;

  private lastEventAtMs: number | null = null;
  private lastEventLagMs = 0;

  /** Highest state rank seen per channel, for out-of-order detection. */
  private readonly channelRank = new Map<string, number>();

  private readonly metrics: IngestorMetrics = {
    received: 0,
    normalized: 0,
    duplicates: 0,
    quarantined: 0,
    outOfOrder: 0,
    errors: 0,
  };

  constructor(options: IngestorOptions) {
    this.store = options.store;
    this.dedupe = options.dedupe;
    this.now = options.now ?? (() => Date.now());
    this.dedupeTtlMs = options.dedupeTtlMs ?? DEFAULT_DEDUPE_TTL_MS;
    this.onEvent = options.onEvent;
    this.onError = options.onError;
  }

  getMetrics(): Readonly<IngestorMetrics> {
    return { ...this.metrics };
  }

  /** Milliseconds since the last accepted event, or null if none yet. */
  lastEventAgeMs(): number | null {
    if (this.lastEventAtMs === null) return null;
    return Math.max(0, this.now() - this.lastEventAtMs);
  }

  /** occurredAt → receivedAt gap of the most recent event. */
  currentLagMs(): number {
    return this.lastEventLagMs;
  }

  /**
   * Process one raw event. Never throws — an ingestor that can throw will take
   * down the ESL reader on the first malformed frame and stop all telemetry,
   * which the pacing controller then reads as staleness and correctly refuses
   * to dial on. Failing loudly into a counter is better than failing silently
   * into a dead socket.
   */
  async handleRaw(raw: RawEslEvent): Promise<NormalizedTelephonyEvent | null> {
    this.metrics.received++;
    const receivedAt = this.now();

    try {
      const result = normalizeEslEvent(raw, receivedAt);

      if (!result.ok) {
        this.metrics.quarantined++;
        await this.store.quarantine(result.quarantined);
        return null;
      }

      const event = result.event;

      const isFirstSight = await this.dedupe.markSeen(
        event.tenantId,
        event.eventId,
        this.dedupeTtlMs
      );
      if (!isFirstSight) {
        // A duplicate must not re-run any state transition, re-increment any
        // metric other than the duplicate counter, or re-notify subscribers.
        this.metrics.duplicates++;
        return null;
      }

      this.trackOrdering(event);

      await this.store.append(event);

      this.metrics.normalized++;
      this.lastEventAtMs = receivedAt;
      this.lastEventLagMs = Math.max(0, receivedAt - event.occurredAt);

      if (this.onEvent) {
        try {
          this.onEvent(event);
        } catch (err) {
          // A failing subscriber must not lose the event or kill the reader.
          this.metrics.errors++;
          this.reportError(err, 'onEvent subscriber');
        }
      }

      return event;
    } catch (err) {
      this.metrics.errors++;
      this.reportError(err, 'handleRaw');
      return null;
    }
  }

  /**
   * Detect events that would move a channel backwards. Such an event is still
   * recorded — its timestamps are useful — but it is counted so that a
   * reconnect storm is visible rather than silently corrupting call state.
   */
  private trackOrdering(event: NormalizedTelephonyEvent): void {
    if (!event.channelUuid) return;
    const rank = EVENT_STATE_RANK[event.eventType] ?? 0;
    if (rank === 0) return;

    const seen = this.channelRank.get(event.channelUuid) ?? 0;
    if (rank < seen) {
      this.metrics.outOfOrder++;
      return;
    }
    this.channelRank.set(event.channelUuid, rank);

    // Terminal event: release the channel's ordering entry so the map does not
    // grow for the lifetime of the process.
    if (rank >= (EVENT_STATE_RANK.CHANNEL_HANGUP_COMPLETE ?? 9)) {
      this.channelRank.delete(event.channelUuid);
    }
  }

  private reportError(err: unknown, context: string): void {
    const error = err instanceof Error ? err : new Error(String(err));
    if (this.onError) {
      try {
        this.onError(error, context);
      } catch {
        // Reporting the error must never itself throw.
      }
    }
  }

  /** Test/observability helper: number of channels currently being tracked. */
  trackedChannelCount(): number {
    return this.channelRank.size;
  }
}
