import { describe, expect, it, vi } from 'vitest';

import type { RawEslEvent } from '../events/types.js';

import { EslClient, type EslTransport } from './client.js';

const T0 = 1_800_000_000_000;

/** Controllable transport + timer, so reconnect logic is tested without sockets. */
function harness(options: { failConnects?: number; failSubscribe?: boolean } = {}) {
  let now = T0;
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const transports: FakeTransport[] = [];
  const received: RawEslEvent[] = [];
  let connectAttempts = 0;

  class FakeTransport implements EslTransport {
    eventHandler: ((raw: RawEslEvent) => void) | null = null;
    closeHandler: (() => void) | null = null;
    errorHandler: ((e: Error) => void) | null = null;
    subscribeCalls = 0;
    subscribedTo: readonly string[] = [];
    disconnected = false;
    /** Every command written to FreeSWITCH, for the read-only assertion. */
    commands: string[] = [];

    connect(): Promise<void> {
      connectAttempts++;
      if (options.failConnects && connectAttempts <= options.failConnects) {
        return Promise.reject(new Error(`connect refused #${connectAttempts}`));
      }
      return Promise.resolve();
    }
    disconnect(): void {
      this.disconnected = true;
    }
    subscribe(eventNames: readonly string[]): Promise<void> {
      this.subscribeCalls++;
      this.subscribedTo = eventNames;
      this.commands.push(`event plain ${eventNames.join(' ')}`);
      return options.failSubscribe
        ? Promise.reject(new Error('subscribe failed'))
        : Promise.resolve();
    }
    onEvent(h: (raw: RawEslEvent) => void): void {
      this.eventHandler = h;
    }
    onClose(h: () => void): void {
      this.closeHandler = h;
    }
    onError(h: (e: Error) => void): void {
      this.errorHandler = h;
    }
  }

  const client = new EslClient({
    createTransport: () => {
      const t = new FakeTransport();
      transports.push(t);
      return t;
    },
    onRawEvent: raw => received.push(raw),
    now: () => now,
    setTimer: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length - 1;
    },
    clearTimer: handle => {
      const i = handle as number;
      if (timers[i]) timers[i] = { fn: () => {}, ms: -1 };
    },
    baseBackoffMs: 100,
    maxBackoffMs: 5_000,
    stalenessThresholdMs: 30_000,
  });

  return {
    client,
    transports,
    received,
    timers,
    advance: (ms: number) => {
      now += ms;
    },
    setNow: (v: number) => {
      now = v;
    },
    runPendingTimer: async () => {
      const pending = timers.shift();
      if (pending && pending.ms >= 0) pending.fn();
      await Promise.resolve();
      await Promise.resolve();
    },
    connectAttempts: () => connectAttempts,
  };
}

describe('read-only guarantee', () => {
  it('writes only an event subscription to FreeSWITCH', async () => {
    const h = harness();
    await h.client.start();

    const commands = h.transports.flatMap(t => t.commands);
    expect(commands).toHaveLength(1);
    for (const cmd of commands) {
      expect(cmd.startsWith('event ')).toBe(true);
      expect(cmd).not.toMatch(/\b(originate|uuid_|bgapi|sendmsg|bridge)\b/i);
    }
  });

  it('subscribes to every documented telephony event', async () => {
    const h = harness();
    await h.client.start();

    const subscribed = h.transports[0].subscribedTo;
    for (const name of [
      'CHANNEL_CREATE',
      'CHANNEL_ORIGINATE',
      'CHANNEL_PROGRESS',
      'CHANNEL_PROGRESS_MEDIA',
      'CHANNEL_ANSWER',
      'CHANNEL_BRIDGE',
      'CHANNEL_UNBRIDGE',
      'CHANNEL_HANGUP',
      'CHANNEL_HANGUP_COMPLETE',
      'DTMF',
      'RECORD_START',
      'RECORD_STOP',
    ]) {
      expect(subscribed).toContain(name);
    }
  });
});

describe('connection lifecycle', () => {
  it('reaches CONNECTED and reports it', async () => {
    const h = harness();
    await h.client.start();
    const status = h.client.getStatus();
    expect(status.state).toBe('CONNECTED');
    expect(status.connected).toBe(true);
    expect(status.consecutiveFailures).toBe(0);
  });

  it('forwards events to the ingestor', async () => {
    const h = harness();
    await h.client.start();
    h.transports[0].eventHandler?.({ 'Event-Name': 'CHANNEL_ANSWER' });
    expect(h.received).toHaveLength(1);
  });

  it('reports DISCONNECTED after the socket closes', async () => {
    const h = harness();
    await h.client.start();
    h.transports[0].closeHandler?.();
    expect(h.client.getStatus().state).toBe('DISCONNECTED');
    expect(h.client.getStatus().connected).toBe(false);
  });
});

describe('reconnect', () => {
  it('backs off exponentially, bounded by the cap', async () => {
    const h = harness({ failConnects: 10 });
    await h.client.start();

    const delays: number[] = [];
    for (let i = 0; i < 8; i++) {
      const pending = h.timers[0];
      if (pending) delays.push(pending.ms);
      await h.runPendingTimer();
    }

    // 100, 200, 400, 800, 1600, 3200, then capped at 5000.
    expect(delays[0]).toBe(200);
    expect(delays[1]).toBe(400);
    expect(delays.every(d => d <= 5_000)).toBe(true);
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1]);
    }
  });

  it('never exceeds the cap however many times it fails', () => {
    const h = harness({ failConnects: 1_000 });
    for (let i = 0; i < 100; i++) {
      expect(h.client.nextBackoffMs()).toBeLessThanOrEqual(5_000);
    }
  });

  it('does not subscribe twice after a reconnect', async () => {
    const h = harness();
    await h.client.start();
    expect(h.transports[0].subscribeCalls).toBe(1);

    h.transports[0].closeHandler?.();
    await h.runPendingTimer();

    // A fresh transport is created and each subscribes exactly once. Reusing
    // the old transport would deliver every event twice.
    expect(h.transports).toHaveLength(2);
    expect(h.transports[0].subscribeCalls).toBe(1);
    expect(h.transports[1].subscribeCalls).toBe(1);
    expect(h.client.getStatus().subscriptionCount).toBe(2);
  });

  it('ignores events from a transport that has been replaced', async () => {
    const h = harness();
    await h.client.start();
    const stale = h.transports[0];

    stale.closeHandler?.();
    await h.runPendingTimer();

    stale.eventHandler?.({ 'Event-Name': 'CHANNEL_ANSWER' });
    expect(h.received).toHaveLength(0);

    h.transports[1].eventHandler?.({ 'Event-Name': 'CHANNEL_ANSWER' });
    expect(h.received).toHaveLength(1);
  });

  it('disconnects the old transport before creating a new one', async () => {
    const h = harness();
    await h.client.start();
    h.transports[0].closeHandler?.();
    await h.runPendingTimer();
    expect(h.transports[0].disconnected).toBe(true);
  });

  it('treats a failed subscribe as a failed connection', async () => {
    const h = harness({ failSubscribe: true });
    await h.client.start();
    expect(h.client.getStatus().state).toBe('DISCONNECTED');
    expect(h.client.getStatus().consecutiveFailures).toBeGreaterThan(0);
  });
});

describe('staleness', () => {
  it('degrades when connected but no events arrive', async () => {
    const h = harness();
    await h.client.start();
    h.transports[0].eventHandler?.({ 'Event-Name': 'CHANNEL_ANSWER' });

    expect(h.client.getStatus().degraded).toBe(false);
    h.advance(31_000);

    const status = h.client.getStatus();
    expect(status.state).toBe('DEGRADED');
    expect(status.degraded).toBe(true);
    // Still technically connected — the distinction matters for diagnosis.
    expect(status.connected).toBe(true);
    expect(status.detail).toContain('no telephony event');
  });

  it('recovers from degraded when events resume', async () => {
    const h = harness();
    await h.client.start();
    h.transports[0].eventHandler?.({ 'Event-Name': 'CHANNEL_ANSWER' });
    h.advance(31_000);
    expect(h.client.getStatus().degraded).toBe(true);

    h.transports[0].eventHandler?.({ 'Event-Name': 'CHANNEL_ANSWER' });
    expect(h.client.getStatus().degraded).toBe(false);
  });
});

describe('shutdown', () => {
  it('stops cleanly and cancels any pending reconnect', async () => {
    const h = harness({ failConnects: 5 });
    await h.client.start();
    expect(h.timers.length).toBeGreaterThan(0);

    h.client.stop();
    expect(h.client.getStatus().state).toBe('STOPPED');

    const before = h.connectAttempts();
    await h.runPendingTimer();
    // A cancelled timer must not resurrect the connection after stop().
    expect(h.connectAttempts()).toBe(before);
  });

  it('does not reconnect after stop', async () => {
    const h = harness();
    await h.client.start();
    h.client.stop();
    h.transports[0].closeHandler?.();
    expect(h.client.getStatus().state).toBe('STOPPED');
  });

  it('tolerates a transport that throws on disconnect', async () => {
    const h = harness();
    await h.client.start();
    h.transports[0].disconnect = () => {
      throw new Error('socket already gone');
    };
    expect(() => h.client.stop()).not.toThrow();
  });
});

describe('state observer', () => {
  it('is notified of transitions and cannot break the client', async () => {
    const states: string[] = [];
    const subscribe = vi.fn(() => Promise.resolve());

    const transport: EslTransport = {
      connect: () => Promise.resolve(),
      disconnect: () => {},
      subscribe,
      onEvent: () => {},
      onClose: () => {},
      onError: () => {},
    };

    const client = new EslClient({
      createTransport: () => transport,
      onRawEvent: () => {},
      onStateChange: state => {
        states.push(state);
        throw new Error('observer exploded');
      },
      setTimer: () => 0,
      clearTimer: () => {},
    });

    // A throwing observer must not prevent the connection from establishing.
    await expect(client.start()).resolves.toBeUndefined();
    expect(states).toContain('CONNECTING');
    expect(states).toContain('CONNECTED');
    expect(client.getStatus().connected).toBe(true);
    expect(subscribe).toHaveBeenCalledTimes(1);
  });
});
