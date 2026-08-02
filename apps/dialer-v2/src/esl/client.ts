/**
 * Dialer V2 — FreeSWITCH ESL connection manager.
 *
 * READ-ONLY BY CONSTRUCTION. The only command this client ever writes to
 * FreeSWITCH is the `event` subscription. There is no `originate`, no `uuid_*`,
 * and no API surface for sending an arbitrary command — a caller cannot reach
 * past this class to place a call, because the raw socket is never exposed.
 *
 * The transport is injected (`EslTransport`) so reconnect, backoff, subscription
 * and staleness behaviour are all testable without a FreeSWITCH instance and
 * without a real timer.
 */

import { SUBSCRIBED_EVENT_TYPES, type RawEslEvent } from '../events/types.js';

export type EslConnectionState =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'DEGRADED'
  | 'STOPPED';

/** The minimum a transport must provide. Implemented over `modesl` in production. */
export interface EslTransport {
  connect(): Promise<void>;
  disconnect(): void;
  /** Send the event subscription. The ONLY write this client performs. */
  subscribe(eventNames: readonly string[]): Promise<void>;
  onEvent(handler: (raw: RawEslEvent) => void): void;
  onClose(handler: () => void): void;
  onError(handler: (error: Error) => void): void;
}

export interface EslClientOptions {
  createTransport: () => EslTransport;
  onRawEvent: (raw: RawEslEvent) => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** First reconnect delay. Doubles each attempt up to `maxBackoffMs`. */
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  /** No event for this long while connected ⇒ DEGRADED. */
  stalenessThresholdMs?: number;
  onStateChange?: (state: EslConnectionState, detail: string) => void;
}

export interface EslStatus {
  state: EslConnectionState;
  connected: boolean;
  /** True when connected but the event flow has gone quiet. */
  degraded: boolean;
  consecutiveFailures: number;
  lastEventAtMs: number | null;
  lastEventAgeMs: number | null;
  connectedAtMs: number | null;
  subscriptionCount: number;
  detail: string;
}

const DEFAULT_BASE_BACKOFF_MS = 500;
const DEFAULT_MAX_BACKOFF_MS = 30_000;
const DEFAULT_STALENESS_MS = 60_000;

export class EslClient {
  private readonly opts: Required<
    Omit<EslClientOptions, 'onStateChange' | 'createTransport' | 'onRawEvent'>
  > &
    Pick<EslClientOptions, 'onStateChange' | 'createTransport' | 'onRawEvent'>;

  private transport: EslTransport | null = null;
  private state: EslConnectionState = 'DISCONNECTED';
  private detail = 'not started';
  private consecutiveFailures = 0;
  private lastEventAtMs: number | null = null;
  private connectedAtMs: number | null = null;
  private reconnectHandle: unknown = null;
  private stopped = false;
  /** Counts successful subscriptions; asserted in tests to catch duplicates. */
  private subscriptionCount = 0;

  constructor(options: EslClientOptions) {
    this.opts = {
      createTransport: options.createTransport,
      onRawEvent: options.onRawEvent,
      now: options.now ?? (() => Date.now()),
      setTimer: options.setTimer ?? ((fn, ms) => setTimeout(fn, ms)),
      clearTimer: options.clearTimer ?? (h => clearTimeout(h as NodeJS.Timeout)),
      baseBackoffMs: options.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS,
      maxBackoffMs: options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS,
      stalenessThresholdMs: options.stalenessThresholdMs ?? DEFAULT_STALENESS_MS,
      onStateChange: options.onStateChange,
    };
  }

  getStatus(): EslStatus {
    const now = this.opts.now();
    const lastEventAgeMs =
      this.lastEventAtMs === null ? null : Math.max(0, now - this.lastEventAtMs);

    // Staleness is evaluated on read rather than on a timer: a client that has
    // been connected for an hour with no events is not healthy, and nothing
    // should have to poll a separate watchdog to discover that.
    const stale =
      this.state === 'CONNECTED' &&
      lastEventAgeMs !== null &&
      lastEventAgeMs > this.opts.stalenessThresholdMs;

    const effectiveState: EslConnectionState = stale ? 'DEGRADED' : this.state;

    return {
      state: effectiveState,
      connected: this.state === 'CONNECTED',
      degraded: effectiveState === 'DEGRADED',
      consecutiveFailures: this.consecutiveFailures,
      lastEventAtMs: this.lastEventAtMs,
      lastEventAgeMs,
      connectedAtMs: this.connectedAtMs,
      subscriptionCount: this.subscriptionCount,
      detail: stale ? `no telephony event for ${lastEventAgeMs} ms` : this.detail,
    };
  }

  /** Bounded exponential backoff: base * 2^failures, capped. */
  nextBackoffMs(): number {
    const exponent = Math.min(this.consecutiveFailures, 16);
    return Math.min(this.opts.maxBackoffMs, this.opts.baseBackoffMs * 2 ** exponent);
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.openConnection();
  }

  /**
   * Graceful shutdown. Cancels any pending reconnect first, so a timer cannot
   * resurrect the connection after stop() returns.
   */
  stop(): void {
    this.stopped = true;
    if (this.reconnectHandle !== null) {
      this.opts.clearTimer(this.reconnectHandle);
      this.reconnectHandle = null;
    }
    this.teardownTransport();
    this.setState('STOPPED', 'stopped');
  }

  private teardownTransport(): void {
    if (this.transport) {
      try {
        this.transport.disconnect();
      } catch {
        // Disconnecting an already-dead socket is not an error worth surfacing.
      }
      this.transport = null;
    }
    this.connectedAtMs = null;
  }

  private async openConnection(): Promise<void> {
    if (this.stopped) return;

    // Always discard the previous transport before creating a new one. Without
    // this, a reconnect leaves the old transport's handlers attached and every
    // event is delivered twice — the duplicate-subscription bug this class
    // exists to prevent.
    this.teardownTransport();

    this.setState('CONNECTING', 'connecting');

    const transport = this.opts.createTransport();
    this.transport = transport;

    transport.onEvent((raw: RawEslEvent) => {
      // Ignore events from a transport we have already replaced.
      if (this.transport !== transport) return;
      this.lastEventAtMs = this.opts.now();
      this.opts.onRawEvent(raw);
    });

    transport.onClose(() => {
      if (this.transport !== transport) return;
      this.handleDisconnect('connection closed');
    });

    transport.onError((error: Error) => {
      if (this.transport !== transport) return;
      this.handleDisconnect(`connection error: ${error.message}`);
    });

    try {
      await transport.connect();
      if (this.stopped || this.transport !== transport) return;

      await transport.subscribe(SUBSCRIBED_EVENT_TYPES);
      if (this.stopped || this.transport !== transport) return;

      this.subscriptionCount++;
      this.consecutiveFailures = 0;
      this.connectedAtMs = this.opts.now();
      this.setState('CONNECTED', 'connected and subscribed');
    } catch (error) {
      this.handleDisconnect(
        `connect failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private handleDisconnect(detail: string): void {
    if (this.stopped) return;
    if (this.state === 'DISCONNECTED' && this.reconnectHandle !== null) return;

    this.teardownTransport();
    this.consecutiveFailures++;
    this.setState('DISCONNECTED', detail);
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectHandle !== null) return;
    const delay = this.nextBackoffMs();
    this.reconnectHandle = this.opts.setTimer(() => {
      this.reconnectHandle = null;
      void this.openConnection();
    }, delay);
  }

  private setState(state: EslConnectionState, detail: string): void {
    if (this.state === state && this.detail === detail) return;
    this.state = state;
    this.detail = detail;
    if (this.opts.onStateChange) {
      try {
        this.opts.onStateChange(state, detail);
      } catch {
        // A state-change observer must never be able to break the connection.
      }
    }
  }
}
