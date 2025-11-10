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

    let isRunning = true;

    const processMessages = async () => {
      while (isRunning) {
        try {
          // Read from stream with consumer group
          const messages = await this.redis.xreadgroup(
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
                  await this.redis.xack(
                    this.streamKey,
                    this.consumerGroupName,
                    messageId
                  );
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
    processMessages().catch((err) => {
      console.error('Fatal error in event subscription:', err);
    });

    // Return unsubscribe function
    return async () => {
      isRunning = false;
    };
  }

  /**
   * Subscribe to events using Redis pub/sub (for real-time WebSocket delivery)
   */
  async subscribePubSub(
    channels: EventChannel[],
    handler: (channel: EventChannel, payload: EventPayload) => void
  ): Promise<() => Promise<void>> {
    if (!this.subscriber) {
      this.subscriber = getRedisClient();
    }

    const messageHandler = (channel: string, message: string) => {
      try {
        const payload = JSON.parse(message) as EventPayload;
        handler(channel as EventChannel, payload);
      } catch (err) {
        console.error('Error parsing pub/sub message:', err);
      }
    };

    // Subscribe to wildcard patterns using psubscribe
    // For 'call.*', we subscribe to pattern 'call.*'
    const patterns = channels.filter((ch) => ch.endsWith('.*'));
    
    if (patterns.length > 0) {
      await this.subscriber.psubscribe(...patterns);
      this.subscriber.on('pmessage', (pattern, channel, message) => {
        messageHandler(channel as EventChannel, message);
      });
    }

    // Also subscribe to specific channels (non-wildcard)
    const specificChannels = channels.filter((ch) => !ch.endsWith('.*'));
    if (specificChannels.length > 0) {
      await this.subscriber.subscribe(...specificChannels);
      this.subscriber.on('message', (channel, message) => {
        messageHandler(channel as EventChannel, message);
      });
    }

    // Return unsubscribe function
    return async () => {
      if (this.subscriber) {
        if (patterns.length > 0) {
          await this.subscriber.punsubscribe(...patterns);
        }
        if (specificChannels.length > 0) {
          await this.subscriber.unsubscribe(...specificChannels);
        }
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

