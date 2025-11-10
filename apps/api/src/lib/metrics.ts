import { Registry, Counter, Histogram, Gauge } from 'prom-client';

export const register = new Registry();

// Default metrics
import { collectDefaultMetrics } from 'prom-client';
collectDefaultMetrics({ register });

// API Metrics
export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code', 'tenant_id'],
  buckets: [0.1, 0.5, 1, 2, 5, 10],
  registers: [register],
});

export const httpRequestTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code', 'tenant_id'],
  registers: [register],
});

export const httpRequestErrors = new Counter({
  name: 'http_request_errors_total',
  help: 'Total number of HTTP request errors',
  labelNames: ['method', 'route', 'error_type', 'tenant_id'],
  registers: [register],
});

// Database Metrics
export const dbQueryDuration = new Histogram({
  name: 'db_query_duration_seconds',
  help: 'Duration of database queries in seconds',
  labelNames: ['operation', 'table', 'tenant_id'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
  registers: [register],
});

export const dbQueryTotal = new Counter({
  name: 'db_queries_total',
  help: 'Total number of database queries',
  labelNames: ['operation', 'table', 'tenant_id'],
  registers: [register],
});

export const dbConnectionsActive = new Gauge({
  name: 'db_connections_active',
  help: 'Number of active database connections',
  registers: [register],
});

// Call Metrics
export const callsTotal = new Counter({
  name: 'calls_total',
  help: 'Total number of calls',
  labelNames: ['status', 'direction', 'campaign_id', 'tenant_id'],
  registers: [register],
});

export const callsDuration = new Histogram({
  name: 'calls_duration_seconds',
  help: 'Duration of calls in seconds',
  labelNames: ['status', 'direction', 'tenant_id'],
  buckets: [10, 30, 60, 120, 300, 600, 1800],
  registers: [register],
});

export const callsActive = new Gauge({
  name: 'calls_active',
  help: 'Number of active calls',
  labelNames: ['tenant_id'],
  registers: [register],
});

// SIP Metrics
export const sipMessagesTotal = new Counter({
  name: 'sip_messages_total',
  help: 'Total number of SIP messages',
  labelNames: ['method', 'direction', 'status_code'],
  registers: [register],
});

export const sipMessagesDuration = new Histogram({
  name: 'sip_message_duration_seconds',
  help: 'Duration of SIP message processing',
  labelNames: ['method'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1],
  registers: [register],
});

// RTP Metrics
export const rtpPacketsTotal = new Counter({
  name: 'rtp_packets_total',
  help: 'Total number of RTP packets',
  labelNames: ['direction', 'codec'],
  registers: [register],
});

export const rtpPacketsLost = new Counter({
  name: 'rtp_packets_lost_total',
  help: 'Total number of lost RTP packets',
  labelNames: ['direction', 'codec'],
  registers: [register],
});

export const rtpJitter = new Histogram({
  name: 'rtp_jitter_seconds',
  help: 'RTP jitter in seconds',
  labelNames: ['direction', 'codec'],
  buckets: [0.001, 0.005, 0.01, 0.02, 0.05, 0.1],
  registers: [register],
});

// Worker Metrics
export const workerJobsTotal = new Counter({
  name: 'worker_jobs_total',
  help: 'Total number of worker jobs processed',
  labelNames: ['job_type', 'status'],
  registers: [register],
});

export const workerJobDuration = new Histogram({
  name: 'worker_job_duration_seconds',
  help: 'Duration of worker jobs in seconds',
  labelNames: ['job_type'],
  buckets: [1, 5, 10, 30, 60, 300],
  registers: [register],
});

export const workerJobsActive = new Gauge({
  name: 'worker_jobs_active',
  help: 'Number of active worker jobs',
  labelNames: ['job_type'],
  registers: [register],
});

// Redis Metrics
export const redisOperationsTotal = new Counter({
  name: 'redis_operations_total',
  help: 'Total number of Redis operations',
  labelNames: ['operation'],
  registers: [register],
});

export const redisOperationDuration = new Histogram({
  name: 'redis_operation_duration_seconds',
  help: 'Duration of Redis operations in seconds',
  labelNames: ['operation'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1],
  registers: [register],
});

