import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { announceSkip, redisGate } from '../../__tests__/helpers/live-services.js';
import { EventBus, type EventPayload } from '../event-bus.js';
import { closeRedisClient } from '../redis.js';

// Publishes to and consumes from real Redis streams.
const gate = redisGate();
announceSkip('EventBus', gate);

describe.skipIf(!gate.available)('EventBus', () => {
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
        payload => {
          receivedEvents.push(payload);
        },
        testConsumerName
      );

      // Publish event
      await eventBus.publish('call.*', testEvent);

      // Wait for event to be processed
      await new Promise(resolve => setTimeout(resolve, 500));

      // Cleanup
      await unsubscribe();

      // Verify event was received
      expect(receivedEvents.length).toBeGreaterThan(0);
      const received = receivedEvents.find(e => e.data.callId === 'test-call-subscribe');
      expect(received).toBeDefined();
      expect(received?.event).toBe('call.started');
    }, 10000);

    it('should filter events by channel pattern', async () => {
      const receivedEvents: EventPayload[] = [];
      // The stream outlives the test run, so tag this run's own events and
      // assert on those -- otherwise a leftover message decides the result.
      const runTag = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const unsubscribe = await eventBus.subscribe(
        'call.*',
        payload => {
          receivedEvents.push(payload);
        },
        testConsumerName
      );

      // Publish to different channels
      await eventBus.publish('call.*', {
        event: 'call.started',
        tenantId: runTag,
        data: { callId: 'call-1' },
      });

      await eventBus.publish('billing.*', {
        event: 'billing.charged',
        tenantId: runTag,
        data: { invoiceId: 'inv-1' },
      });

      // Wait for events
      await new Promise(resolve => setTimeout(resolve, 500));

      await unsubscribe();

      // The call event arrives and the billing event does not. Asserting only
      // that some call event arrived would pass with the filter torn out.
      const mine = receivedEvents.filter(e => e.tenantId === runTag);
      expect(mine.map(e => e.event)).toEqual(['call.started']);
    }, 10000);
  });

  describe('subscribePubSub', () => {
    it('should subscribe to pub/sub channels and receive events', async () => {
      const receivedEvents: Array<{ channel: string; payload: EventPayload }> = [];

      const unsubscribe = await eventBus.subscribePubSub(['call.*'], (channel, payload) => {
        receivedEvents.push({ channel, payload });
      });

      // Publish event
      await eventBus.publish('call.*', {
        event: 'call.started',
        tenantId: 'test-tenant',
        data: { callId: 'test-call-pubsub' },
      });

      // Wait for event
      await new Promise(resolve => setTimeout(resolve, 500));

      await unsubscribe();

      // Verify event was received
      expect(receivedEvents.length).toBeGreaterThan(0);
      const received = receivedEvents.find(e => e.payload.data.callId === 'test-call-pubsub');
      expect(received).toBeDefined();
      expect(received?.channel).toMatch(/^call\./);
    }, 10000);
  });

  describe('getEvents', () => {
    it('should retrieve recent events from stream, oldest first', async () => {
      // The stream is shared and never truncated, so identify this run's own
      // events rather than indexing into whatever else is already in there.
      const runTag = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      // Publish a few events
      for (let i = 0; i < 3; i++) {
        await eventBus.publish('call.*', {
          event: `call.event${i}`,
          tenantId: runTag,
          data: { index: i },
        });
      }

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 200));

      const events = await eventBus.getEvents(10);
      const mine = events.filter(e => e.tenantId === runTag);

      // getEvents reads newest-first with XREVRANGE and then reverses, so the
      // contract is oldest-first: the order they were published in.
      expect(mine.map(e => e.event)).toEqual(['call.event0', 'call.event1', 'call.event2']);
    });
  });
});
