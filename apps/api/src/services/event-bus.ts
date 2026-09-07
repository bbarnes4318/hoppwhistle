import { getRedisClient } from './redis.js';

export interface EventPayload {
  event: string;
  tenantId: string;
  data: Record<string, unknown>;
  timestamp: string;
  id: string;
}

export type EventChannel = 'call.*' | 'billing.*' | 'recording.*';

export class EventBus {
  private redis = getRedisClient();
  private subscriber: ReturnType<typeof getRedisClient> | null = null;
  /** Live pub/sub handlers, one per open subscription. See subscribePubSub(). */
  private pubSubHandlers = new Set<(channel: EventChannel, payload: EventPayload) => void>();
  private streamKey = 'events:stream';
  private consumerGroupName = 'event-consumers';

  /**
   * Initialize consumer group for event streams
   */
  async initialize(): Promise<void> {
    try {
      await this.redis.xgroup('CREATE', this.streamKey, this.consumerGroupName, '0', 'MKSTREAM');
    } catch (err: any) {
      // Group already exists, ignore
      if (!err.message.includes('BUSYGROUP')) {
        throw err;
      }
    }
  }

  /**
   * Publish an event to the event bus
   */
  async publish(channel: EventChannel, payload: Omit<EventPayload, 'id' | 'timestamp'>): Promise<string> {
    const eventPayload: EventPayload = {
      ...payload,
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
    };

    // Determine the actual channel name from the event type
    // e.g., 'call.started' -> publish to 'call.started' and 'call.*'
    const eventType = payload.event;
    const baseChannel = eventType.split('.')[0]; // e.g., 'call' from 'call.started'
    const specificChannel = eventType; // e.g., 'call.started'
    const wildcardChannel = `${baseChannel}.*`; // e.g., 'call.*'

    // Publish to Redis stream
    const streamId = await this.redis.xadd(
      this.streamKey,
      '*',
      'channel',
      channel,
      'payload',
      JSON.stringify(eventPayload)
    );

    // Publish to both specific channel and wildcard channel for pub/sub
    await this.redis.publish(specificChannel, JSON.stringify(eventPayload));
    await this.redis.publish(wildcardChannel, JSON.stringify(eventPayload));

    return streamId as string;
  }

  /**
   * Subscribe to events using Redis streams (for reliable processing)
   */
  async subscribe(
    channel: EventChannel,
    handler: (payload: EventPayload) => Promise<void> | void,
    consumerName: string
  ): Promise<() => Promise<void>> {
    await this.initialize();

    // A blocking read needs its own connection. ioredis serialises commands on
    // a single socket, so XREADGROUP ... BLOCK on the shared client holds that
    // socket for the whole block and everything else in the process -- rate
    // limiting, sessions, caches, this bus's own publish() -- queues behind it.
    // The shared client also carries commandTimeout: 500, which is shorter than
    // the BLOCK, so the read could never return empty: it timed out, logged,
    // slept a second and retried, taking any command queued behind it with it.
    // subscribePubSub() already duplicates for the same reason.
    const reader = getRedisClient().duplicate({ commandTimeout: undefined });
    // duplicate() copies options, not listeners. An ioredis 'error' with no
    // listener is an unhandled 'error' event, which takes the process down.
    reader.on('error', (err) => {
      console.error('[EventBus] Subscriber connection error:', err.message);
    });

    let isRunning = true;

    const processMessages = async () => {
      while (isRunning) {
        try {
          // Read from stream with consumer group
          const messages = await reader.xreadgroup(
            'GROUP',
            this.consumerGroupName,
            consumerName,
            'COUNT',
            '10',
            'BLOCK',
            '1000',
            'STREAMS',
            this.streamKey,
            '>'
          );

          if (messages && messages.length > 0) {
            const [, streamMessages] = messages[0] as [string, Array<[string, string[]]>];

            for (const [messageId, fields] of streamMessages) {
              const fieldMap: Record<string, string> = {};
              for (let i = 0; i < fields.length; i += 2) {
                fieldMap[fields[i]] = fields[i + 1];
              }

              const eventChannel = fieldMap.channel as EventChannel;
              if (eventChannel === channel || this.matchesPattern(channel, eventChannel)) {
                const payload = JSON.parse(fieldMap.payload) as EventPayload;
                try {
                  await handler(payload);
                  // Acknowledge message
                  await reader.xack(this.streamKey, this.consumerGroupName, messageId);
                } catch (err) {
                  console.error('Error handling event:', err);
                  // In production, you might want to handle failures differently
                }
              }
            }
          }
        } catch (err) {
          if (isRunning) {
            console.error('Error in event subscription:', err);
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }
      }
    };

    // Start processing in background
    const loop = processMessages().catch((err) => {
      console.error('Fatal error in event subscription:', err);
    });

    // Return unsubscribe function
    return async () => {
      isRunning = false;
      // Aborts the in-flight blocking read rather than leaving the loop alive
      // for the rest of the BLOCK window. The rejection it causes lands in the
      // catch above, which stays quiet once isRunning is false.
      reader.disconnect();
      await loop;
    };
  }

  /**
   * Subscribe to events using Redis pub/sub (for real-time WebSocket delivery).
   *
   * ── One connection, many subscribers ────────────────────────────────────────
   *
   * Every live WebSocket calls this. The previous version attached a fresh
   * `pmessage` listener to ONE shared ioredis connection on every call and
   * never removed it, so:
   *
   *   - closing the first socket ran `punsubscribe('call.*')` on the shared
   *     connection and silently stopped delivery for every other socket still
   *     open, and
   *   - the listeners of closed sockets stayed attached, growing without bound
   *     and tripping Node's max-listeners warning at eleven connections.
   *
   * So the listeners are now attached exactly once and the handlers live in a
   * Set. Unsubscribing removes one handler; the Redis-level `punsubscribe` runs
   * only when the last subscriber has gone, which is the only point at which it
   * is not someone else's delivery being cancelled.
   *
   * The handler is called for every event on the connection, of every tenant.
   * That is inherent to a shared pub/sub connection, and it is why the callers
   * -- `routes/websocket.ts` -- compare `payload.tenantId` against the
   * subscriber's own tenant before sending anything. Do not add a caller here
   * that skips that comparison.
   */
  async subscribePubSub(
    channels: EventChannel[],
    handler: (channel: EventChannel, payload: EventPayload) => void
  ): Promise<() => Promise<void>> {
    if (!this.subscriber) {
      const conn = getRedisClient().duplicate();
      // duplicate() copies options, not listeners. An ioredis 'error' with no
      // listener is an unhandled 'error' event, which takes the process down.
      conn.on('error', (err) => {
        console.error('[EventBus] Pub/sub connection error:', err.message);
      });

      const dispatch = (channel: string, message: string) => {
        let payload: EventPayload;
        try {
          payload = JSON.parse(message) as EventPayload;
        } catch (err) {
          console.error('Error parsing pub/sub message:', err);
          return;
        }
        // Copied before iterating: a handler may unsubscribe itself.
        for (const h of [...this.pubSubHandlers]) {
          try {
            h(channel as EventChannel, payload);
          } catch (err) {
            console.error('Error in pub/sub handler:', err);
          }
        }
      };

      conn.on('pmessage', (_pattern, channel, message) => dispatch(channel, message));
      conn.on('message', (channel, message) => dispatch(channel, message));

      this.subscriber = conn;
    }

    const patterns = channels.filter((ch) => ch.endsWith('.*'));
    const specificChannels = channels.filter((ch) => !ch.endsWith('.*'));

    if (patterns.length > 0) {
      await this.subscriber.psubscribe(...patterns);
    }
    if (specificChannels.length > 0) {
      await this.subscriber.subscribe(...specificChannels);
    }

    this.pubSubHandlers.add(handler);

    let released = false;
    return async () => {
      if (released) return;
      released = true;
      this.pubSubHandlers.delete(handler);

      // Only the last subscriber tears the Redis subscription down. Anything
      // else cancels delivery for connections that are still open.
      if (this.pubSubHandlers.size > 0 || !this.subscriber) return;

      if (patterns.length > 0) {
        await this.subscriber.punsubscribe(...patterns);
      }
      if (specificChannels.length > 0) {
        await this.subscriber.unsubscribe(...specificChannels);
      }
    };
  }

  /**
   * Check if a channel matches a pattern (e.g., 'call.*' matches 'call.started')
   */
  private matchesPattern(pattern: EventChannel, channel: string): boolean {
    if (pattern.endsWith('.*')) {
      const prefix = pattern.slice(0, -2);
      return channel.startsWith(prefix + '.');
    }
    return pattern === channel;
  }

  /**
   * Get events from stream (for replay/debugging)
   */
  async getEvents(limit = 100): Promise<EventPayload[]> {
    const messages = await this.redis.xrevrange(this.streamKey, '+', '-', 'COUNT', limit);
    const events: EventPayload[] = [];

    for (const [, fields] of messages) {
      const fieldMap: Record<string, string> = {};
      for (let i = 0; i < fields.length; i += 2) {
        fieldMap[fields[i]] = fields[i + 1];
      }
      if (fieldMap.payload) {
        events.push(JSON.parse(fieldMap.payload) as EventPayload);
      }
    }

    return events.reverse();
  }
}

export const eventBus = new EventBus();

