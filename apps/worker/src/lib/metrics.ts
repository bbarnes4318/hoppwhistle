import { Registry, Counter, Histogram, Gauge } from 'prom-client';

export const register = new Registry();

// Default metrics
import { collectDefaultMetrics } from 'prom-client';
collectDefaultMetrics({ register });

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

// ETL Metrics
export const etlRecordsProcessed = new Counter({
  name: 'etl_records_processed_total',
  help: 'Total number of records processed by ETL',
  labelNames: ['table', 'status'],
  registers: [register],
});

export const etlProcessingDuration = new Histogram({
  name: 'etl_processing_duration_seconds',
  help: 'Duration of ETL processing in seconds',
  labelNames: ['table'],
  buckets: [1, 5, 10, 30, 60],
  registers: [register],
});

