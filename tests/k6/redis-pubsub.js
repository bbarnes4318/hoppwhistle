/**
 * k6 Load Test: Redis Pub/Sub Throughput
 * 
 * Target: Measure Redis pub/sub message throughput and latency
 * 
 * This test simulates high-frequency event publishing (call state updates, events)
 * that would be published to Redis pub/sub channels and consumed by WebSocket clients.
 */

import { check, sleep } from 'k6';
import http from 'k6/http';
import { Rate, Trend, Counter } from 'k6/metrics';
import ws from 'k6/ws';

// Custom metrics
const pubsubMessageRate = new Rate('pubsub_messages_received');
const pubsubLatency = new Trend('pubsub_message_latency_ms');
const pubsubThroughput = new Counter('pubsub_messages_total');

// Test configuration
// Note: VUs are split between subscribers (WebSocket) and publishers (HTTP)
export const options = {
  stages: [
    { duration: '30s', target: 50 },   // Ramp up to 50 VUs
    { duration: '1m', target: 100 },   // Ramp up to 100 VUs
    { duration: '2m', target: 200 },   // Ramp up to 200 VUs
    { duration: '3m', target: 200 },   // Stay at 200 VUs
    { duration: '1m', target: 0 },     // Ramp down
  ],
  thresholds: {
    'pubsub_messages_received': ['rate>0.95'], // 95% message delivery rate
    'pubsub_message_latency_ms': ['p(95)<100'], // 95% latency below 100ms
  },
};

// Base URL from environment or default
const WS_URL = __ENV.WS_URL || 'ws://localhost:3001';
const API_URL = __ENV.API_URL || 'http://localhost:3001';
const API_KEY = __ENV.API_KEY || 'test-api-key';
const TENANT_ID = __ENV.TENANT_ID || '00000000-0000-0000-0000-000000000000';

// Publisher configuration (separate from subscribers)
const PUBLISHER_VUS = parseInt(__ENV.PUBLISHER_VUS || '10');
const MESSAGES_PER_SECOND = parseInt(__ENV.MESSAGES_PER_SECOND || '500');

/**
 * WebSocket subscriber - connects and listens for pub/sub messages
 */
export function subscriber() {
  const url = `${WS_URL}/ws/events?apiKey=${API_KEY}`;
  const params = { tags: { name: 'pubsub_subscriber' } };

  const response = ws.connect(url, params, function (socket) {
    socket.on('open', () => {
      // Subscribe to call events
      socket.send(JSON.stringify({
        type: 'subscribe',
        channels: ['call.*'],
      }));
    });

    socket.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        
        if (message.type === 'event') {
          // Calculate latency if timestamp is present
          if (message.payload.timestamp) {
            const messageTime = new Date(message.payload.timestamp).getTime();
            const receiveTime = Date.now();
            const latency = receiveTime - messageTime;
            pubsubLatency.add(latency);
          }
          
          pubsubMessageRate.add(1);
          pubsubThroughput.add(1);
        }
      } catch (err) {
        // Ignore parse errors for non-JSON messages (like 'connected', 'subscribed')
      }
    });

    socket.on('error', (e) => {
      if (e.error() !== 'websocket: close sent') {
        console.error('WebSocket error:', e);
      }
    });

    // Keep connection alive for the duration of the test
    sleep(60);
  });

  check(response, {
    'WebSocket connection successful': (r) => r && r.status === 101,
  });
}

/**
 * Event publisher - publishes events via HTTP API to trigger Redis pub/sub
 */
export function publisher() {
  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': API_KEY,
    'X-Tenant-Id': TENANT_ID,
  };

  // Calculate delay between messages to achieve target rate
  const delayMs = 1000 / MESSAGES_PER_SECOND;
  
  // Event types that trigger pub/sub
  const eventTypes = ['call.started', 'call.answered', 'call.completed'];

  while (true) {
    const callId = `call-${__VU}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const eventType = eventTypes[Math.floor(Math.random() * eventTypes.length)];

    const payload = {
      callId,
      tenantId: TENANT_ID,
      eventType,
    };

    // Use demo events endpoint to publish
    const url = `${API_URL}/api/v1/demo/events/call`;
    const response = http.post(url, JSON.stringify(payload), {
      headers,
      tags: { name: 'pubsub_publisher' },
    });

    check(response, {
      'publish status is 200 or 201': (r) => r.status === 200 || r.status === 201,
    });

    sleep(delayMs / 1000); // Convert to seconds
  }
}

/**
 * Main function - distributes VUs between subscribers and publishers
 * 
 * Note: k6 doesn't support different functions per VU easily, so we use
 * a workaround where first N VUs are publishers and rest are subscribers.
 * For better separation, consider running publisher and subscriber tests separately.
 */
export default function () {
  const totalVUs = parseInt(__ENV.VUs || '200');
  const publisherCount = Math.min(PUBLISHER_VUS, totalVUs);
  
  // First N VUs are publishers, rest are subscribers
  if (__VU <= publisherCount) {
    publisher();
  } else {
    subscriber();
  }
}

export function handleSummary(data) {
  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    'results/redis-pubsub.json': JSON.stringify(data),
  };
}

function textSummary(data, options) {
  const indent = options.indent || '';
  
  let summary = '\n';
  summary += `${indent}Redis Pub/Sub Load Test Results\n`;
  summary += `${indent}==============================\n\n`;
  
  // Message metrics
  if (data.metrics.pubsub_messages_received) {
    const rate = data.metrics.pubsub_messages_received.values.rate;
    summary += `${indent}Message Delivery Rate: ${(rate * 100).toFixed(2)}%\n`;
  }
  
  if (data.metrics.pubsub_messages_total) {
    const total = data.metrics.pubsub_messages_total.values.count;
    summary += `${indent}Total Messages Received: ${total}\n`;
  }
  
  if (data.metrics.pubsub_message_latency_ms) {
    const p50 = data.metrics.pubsub_message_latency_ms.values['p(50)'];
    const p95 = data.metrics.pubsub_message_latency_ms.values['p(95)'];
    const p99 = data.metrics.pubsub_message_latency_ms.values['p(99)'];
    summary += `${indent}Message Latency:\n`;
    summary += `${indent}  p50: ${p50.toFixed(2)}ms\n`;
    summary += `${indent}  p95: ${p95.toFixed(2)}ms\n`;
    summary += `${indent}  p99: ${p99.toFixed(2)}ms\n`;
  }
  
  summary += '\n';
  return summary;
}

