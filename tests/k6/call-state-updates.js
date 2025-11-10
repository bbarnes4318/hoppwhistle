/**
 * k6 Load Test: Call State Updates
 * 
 * Target: 500 concurrent call state updates/second
 * 
 * This test simulates high-frequency call state updates (RINGING -> ANSWERED -> COMPLETED)
 * which would occur during active call routing and management.
 */

import { check, sleep } from 'k6';
import http from 'k6/http';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const callStateUpdateRate = new Rate('call_state_updates_successful');
const callStateUpdateLatency = new Trend('call_state_update_latency_ms');

// Test configuration
export const options = {
  stages: [
    { duration: '30s', target: 100 },  // Ramp up to 100 VUs
    { duration: '1m', target: 200 },   // Ramp up to 200 VUs
    { duration: '2m', target: 500 },   // Ramp up to 500 VUs (target: 500 updates/sec)
    { duration: '3m', target: 500 },    // Stay at 500 VUs
    { duration: '1m', target: 0 },      // Ramp down
  ],
  thresholds: {
    'http_req_duration': ['p(95)<500'], // 95% of requests should be below 500ms
    'call_state_updates_successful': ['rate>0.95'], // 95% success rate
    'call_state_update_latency_ms': ['p(95)<300'], // 95% latency below 300ms
  },
};

// Base URL from environment or default
const BASE_URL = __ENV.API_URL || 'http://localhost:3001';
const API_KEY = __ENV.API_KEY || 'test-api-key';
const TENANT_ID = __ENV.TENANT_ID || '00000000-0000-0000-0000-000000000000';

// Call states progression
const CALL_STATES = ['INITIATED', 'RINGING', 'ANSWERED', 'COMPLETED'];
const CALL_DIRECTIONS = ['INBOUND', 'OUTBOUND'];

/**
 * Generate a unique call ID for this VU
 */
function getCallId(vuId, iteration) {
  return `call-${vuId}-${iteration}-${Date.now()}`;
}

/**
 * Generate a random phone number
 */
function randomPhoneNumber() {
  const areaCode = Math.floor(Math.random() * 800) + 200;
  const exchange = Math.floor(Math.random() * 800) + 200;
  const number = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `+1${areaCode}${exchange}${number}`;
}

/**
 * Create a call state update payload for demo events endpoint
 */
function createCallStateUpdate(callId, state, previousState, fromNumber, toNumber, direction) {
  const payload = {
    callId,
    tenantId: TENANT_ID,
  };
  
  // Add optional fields if provided
  if (fromNumber) payload.fromNumber = fromNumber;
  if (toNumber) payload.toNumber = toNumber;
  if (direction) payload.direction = direction;
  
  return payload;
}

export default function () {
  const callId = getCallId(__VU, __ITER);
  const fromNumber = randomPhoneNumber();
  const toNumber = randomPhoneNumber();
  const direction = CALL_DIRECTIONS[Math.floor(Math.random() * CALL_DIRECTIONS.length)];

  // Headers for authentication
  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': API_KEY,
    'X-Tenant-Id': TENANT_ID,
  };

  // Simulate call state progression: INITIATED -> RINGING -> ANSWERED -> COMPLETED
  for (let i = 0; i < CALL_STATES.length; i++) {
    const state = CALL_STATES[i];
    const previousState = i > 0 ? CALL_STATES[i - 1] : null;

    // Map our state to the event type expected by the endpoint
    const eventTypeMap = {
      'INITIATED': 'call.started',
      'RINGING': 'call.started',
      'ANSWERED': 'call.answered',
      'COMPLETED': 'call.completed',
    };
    const eventType = eventTypeMap[state] || 'call.started';
    
    // Create call state update payload
    const payload = createCallStateUpdate(callId, state, previousState, fromNumber, toNumber, direction);
    payload.eventType = eventType;
    
    // Use demo events endpoint for call state updates
    const url = `${BASE_URL}/api/v1/demo/events/call`;
    const method = 'POST';

    // Make the request
    const startTime = Date.now();
    const response = http.request(method, url, JSON.stringify(payload), {
      headers,
      tags: { name: 'call_state_update', state },
    });
    const duration = Date.now() - startTime;

    // Check response
    const success = check(response, {
      'status is 200 or 201': (r) => r.status === 200 || r.status === 201,
      'response received': (r) => r.body && r.body.length > 0,
    });

    // Record metrics
    callStateUpdateRate.add(success);
    callStateUpdateLatency.add(duration);

    // Small delay between state transitions (simulate real call progression)
    if (i < CALL_STATES.length - 1) {
      sleep(Math.random() * 0.5 + 0.1); // 100-600ms between states
    }
  }

  // Small delay before next iteration
  sleep(0.1);
}

export function handleSummary(data) {
  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    'results/call-state-updates.json': JSON.stringify(data),
  };
}

function textSummary(data, options) {
  const indent = options.indent || '';
  const enableColors = options.enableColors || false;
  
  let summary = '\n';
  summary += `${indent}Call State Updates Load Test Results\n`;
  summary += `${indent}=====================================\n\n`;
  
  // HTTP metrics
  if (data.metrics.http_req_duration) {
    const p95 = data.metrics.http_req_duration.values['p(95)'];
    const p99 = data.metrics.http_req_duration.values['p(99)'];
    summary += `${indent}HTTP Request Duration:\n`;
    summary += `${indent}  p95: ${p95.toFixed(2)}ms\n`;
    summary += `${indent}  p99: ${p99.toFixed(2)}ms\n\n`;
  }
  
  // Custom metrics
  if (data.metrics.call_state_updates_successful) {
    const rate = data.metrics.call_state_updates_successful.values.rate;
    summary += `${indent}Call State Update Success Rate: ${(rate * 100).toFixed(2)}%\n`;
  }
  
  if (data.metrics.call_state_update_latency_ms) {
    const p95 = data.metrics.call_state_update_latency_ms.values['p(95)'];
    summary += `${indent}Call State Update Latency (p95): ${p95.toFixed(2)}ms\n`;
  }
  
  summary += '\n';
  return summary;
}

