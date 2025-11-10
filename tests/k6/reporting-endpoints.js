/**
 * k6 Load Test: Reporting Endpoints
 * 
 * Target: 100 QPS with <300ms p95 latency
 * 
 * This test simulates dashboard and analytics queries that would be made
 * by multiple users viewing reports simultaneously.
 */

import { check, sleep } from 'k6';
import http from 'k6/http';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const reportingSuccessRate = new Rate('reporting_requests_successful');
const reportingLatency = new Trend('reporting_request_latency_ms');

// Test configuration
export const options = {
  stages: [
    { duration: '30s', target: 20 },   // Ramp up to 20 VUs
    { duration: '1m', target: 50 },    // Ramp up to 50 VUs
    { duration: '2m', target: 100 },   // Ramp up to 100 VUs (target: 100 QPS)
    { duration: '5m', target: 100 },   // Stay at 100 VUs
    { duration: '1m', target: 0 },     // Ramp down
  ],
  thresholds: {
    'http_req_duration': ['p(95)<300'], // 95% of requests should be below 300ms
    'reporting_requests_successful': ['rate>0.98'], // 98% success rate
    'reporting_request_latency_ms': ['p(95)<300'], // 95% latency below 300ms
  },
};

// Base URL from environment or default
const BASE_URL = __ENV.API_URL || 'http://localhost:3001';
const API_KEY = __ENV.API_KEY || 'test-api-key';
const TENANT_ID = __ENV.TENANT_ID || '00000000-0000-0000-0000-000000000000';

// Reporting endpoints to test
const REPORTING_ENDPOINTS = [
  {
    path: '/api/v1/reporting/metrics',
    method: 'GET',
    name: 'metrics',
    queryParams: () => ({
      startDate: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      endDate: new Date().toISOString(),
      granularity: 'hour',
    }),
  },
  {
    path: '/api/v1/reporting/calls',
    method: 'GET',
    name: 'calls',
    queryParams: () => ({
      startDate: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      endDate: new Date().toISOString(),
    }),
  },
  {
    path: '/api/v1/reporting/metrics',
    method: 'GET',
    name: 'metrics_daily',
    queryParams: () => ({
      startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      endDate: new Date().toISOString(),
      granularity: 'day',
    }),
  },
];

/**
 * Generate query string from params object
 */
function buildQueryString(params) {
  return Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

export default function () {
  // Select a random reporting endpoint
  const endpoint = REPORTING_ENDPOINTS[Math.floor(Math.random() * REPORTING_ENDPOINTS.length)];
  const queryParams = endpoint.queryParams();
  const queryString = buildQueryString(queryParams);
  const url = `${BASE_URL}${endpoint.path}?${queryString}`;

  // Headers for authentication
  const headers = {
    'x-api-key': API_KEY,
    'X-Tenant-Id': TENANT_ID,
    'X-Demo-Tenant-Id': TENANT_ID, // For demo mode
  };

  // Make the request
  const startTime = Date.now();
  const response = http.get(url, {
    headers,
    tags: { name: `reporting_${endpoint.name}` },
  });
  const duration = Date.now() - startTime;

  // Check response
  const success = check(response, {
    'status is 200': (r) => r.status === 200,
    'response time < 300ms': (r) => r.timings.duration < 300,
    'response has data': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.metrics !== undefined || body.data !== undefined || Array.isArray(body);
      } catch {
        return false;
      }
    },
  });

  // Record metrics
  reportingSuccessRate.add(success);
  reportingLatency.add(duration);

  // Simulate user think time (1-3 seconds between requests)
  sleep(Math.random() * 2 + 1);
}

export function handleSummary(data) {
  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    'results/reporting-endpoints.json': JSON.stringify(data),
  };
}

function textSummary(data, options) {
  const indent = options.indent || '';
  
  let summary = '\n';
  summary += `${indent}Reporting Endpoints Load Test Results\n`;
  summary += `${indent}=====================================\n\n`;
  
  // HTTP metrics
  if (data.metrics.http_req_duration) {
    const p50 = data.metrics.http_req_duration.values['p(50)'];
    const p95 = data.metrics.http_req_duration.values['p(95)'];
    const p99 = data.metrics.http_req_duration.values['p(99)'];
    summary += `${indent}HTTP Request Duration:\n`;
    summary += `${indent}  p50: ${p50.toFixed(2)}ms\n`;
    summary += `${indent}  p95: ${p95.toFixed(2)}ms\n`;
    summary += `${indent}  p99: ${p99.toFixed(2)}ms\n\n`;
  }
  
  // Custom metrics
  if (data.metrics.reporting_requests_successful) {
    const rate = data.metrics.reporting_requests_successful.values.rate;
    summary += `${indent}Reporting Request Success Rate: ${(rate * 100).toFixed(2)}%\n`;
  }
  
  if (data.metrics.reporting_request_latency_ms) {
    const p95 = data.metrics.reporting_request_latency_ms.values['p(95)'];
    summary += `${indent}Reporting Request Latency (p95): ${p95.toFixed(2)}ms\n`;
  }
  
  // Request rate
  if (data.metrics.http_reqs) {
    const rate = data.metrics.http_reqs.values.rate;
    summary += `${indent}Request Rate: ${rate.toFixed(2)} req/s\n`;
  }
  
  summary += '\n';
  return summary;
}

