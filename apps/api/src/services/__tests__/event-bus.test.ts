import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { EventBus, type EventPayload } from '../event-bus.js';
import { getRedisClient, closeRedisClient } from '../redis.js';

describe('EventBus', () => {
  let eventBus: EventBus;
  let testConsumerName: string;

  beforeAll(async () => {
    eventBus = new EventBus();
    await eventBus.initialize();
  });

  afterAll(async () => {
    await closeRedisClient();
  });

  beforeEach(() => {
    testConsumerName = `test-consumer-${Date.now()}`;
  });

  describe('publish', () => {
    it('should publish an event to the stream', async () => {
      const payload = {
        event: 'call.started',
        tenantId: 'test-tenant',
        data: { callId: 'test-call-123' },
      };

      const streamId = await eventBus.publish('call.*', payload);

      expect(streamId).toBeDefined();
      expect(typeof streamId).toBe('string');
    });

    it('should include id and timestamp in published payload', async () => {
      const payload = {
        event: 'call.started',
        tenantId: 'test-tenant',
        data: { callId: 'test-call-123' },
      };

      await eventBus.publish('call.*', payload);

      // Get events to verify
      const events = await eventBus.getEvents(1);
      expect(events.length).toBeGreaterThan(0);

      const lastEvent = events[events.length - 1];
      expect(lastEvent.id).toBeDefined();
      expect(lastEvent.timestamp).toBeDefined();
      expect(lastEvent.event).toBe('call.started');
      expect(lastEvent.tenantId).toBe('test-tenant');
    });
  });

  describe('subscribe (streams)', () => {
    it('should subscribe to events and receive them', async () => {
      const receivedEvents: EventPayload[] = [];
      const testEvent = {
        event: 'call.started',
        tenantId: 'test-tenant',
        data: { callId: 'test-call-subscribe' },
      };

      // Start subscription
      const unsubscribe = await eventBus.subscribe(
        'call.*',
        async (payload) => {
          receivedEvents.push(payload);
        },
        testConsumerName
      );

      // Publish event
      await eventBus.publish('call.*', testEvent);

      // Wait for event to be processed
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Cleanup
      await unsubscribe();

      // Verify event was received
      expect(receivedEvents.length).toBeGreaterThan(0);
      const received = receivedEvents.find(
        (e) => e.data.callId === 'test-call-subscribe'
      );
      expect(received).toBeDefined();
      expect(received?.event).toBe('call.started');
    }, 10000);

    it('should filter events by channel pattern', async () => {
      const receivedEvents: EventPayload[] = [];

      const unsubscribe = await eventBus.subscribe(
        'call.*',
        async (payload) => {
          receivedEvents.push(payload);
        },
        testConsumerName
      );

      // Publish to different channels
      await eventBus.publish('call.*', {
        event: 'call.started',
        tenantId: 'test-tenant',
        data: { callId: 'call-1' },
      });

      await eventBus.publish('billing.*', {
        event: 'billing.charged',
        tenantId: 'test-tenant',
        data: { invoiceId: 'inv-1' },
      });

      // Wait for events
      await new Promise((resolve) => setTimeout(resolve, 500));

      await unsubscribe();

      // Should only receive call events
      const callEvents = receivedEvents.filter((e) => e.event.startsWith('call.'));
      expect(callEvents.length).toBeGreaterThan(0);
    }, 10000);
  });

  describe('subscribePubSub', () => {
    it('should subscribe to pub/sub channels and receive events', async () => {
      const receivedEvents: Array<{ channel: string; payload: EventPayload }> = [];

      const unsubscribe = await eventBus.subscribePubSub(
        ['call.*'],
        (channel, payload) => {
          receivedEvents.push({ channel, payload });
        }
      );

      // Publish event
      await eventBus.publish('call.*', {
        event: 'call.started',
        tenantId: 'test-tenant',
        data: { callId: 'test-call-pubsub' },
      });

      // Wait for event
      await new Promise((resolve) => setTimeout(resolve, 500));

      await unsubscribe();

      // Verify event was received
      expect(receivedEvents.length).toBeGreaterThan(0);
      const received = receivedEvents.find(
        (e) => e.payload.data.callId === 'test-call-pubsub'
      );
      expect(received).toBeDefined();
      expect(received?.channel).toMatch(/^call\./);
    }, 10000);
  });

  describe('getEvents', () => {
    it('should retrieve recent events from stream', async () => {
      // Publish a few events
      for (let i = 0; i < 3; i++) {
        await eventBus.publish('call.*', {
          event: `call.event${i}`,
          tenantId: 'test-tenant',
          data: { index: i },
        });
      }

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 200));

      const events = await eventBus.getEvents(10);

      expect(events.length).toBeGreaterThanOrEqual(3);
      expect(events[events.length - 1].event).toBe('call.event0');
      expect(events[events.length - 3].event).toBe('call.event2');
    });
  });
});

