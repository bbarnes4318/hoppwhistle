/**
 * In-memory job store for carrier application automation runs.
 *
 * Ported from fe-rickie/server/services/automation/jobStore.js.
 * Holds job progress for SSE streaming; durable state (status, application
 * number, errors) is persisted to Postgres via application-store.ts.
 */

import { EventEmitter } from 'events';

export const TOTAL_STEPS = 14;

export interface JobStep {
  jobId: string;
  step: number;
  totalSteps: number;
  status: JobStatusValue;
  message: string;
  timestamp: string;
  applicationNumber?: string;
  error?: string;
}

export type JobStatusValue = 'queued' | 'in_progress' | 'completed' | 'failed';

export interface AutomationJob {
  jobId: string;
  tenantId: string;
  applicationId: string | null;
  status: JobStatusValue;
  steps: JobStep[];
  createdAt: string;
  updatedAt: string;
  inputSummary: unknown;
  result: { applicationNumber?: string; [key: string]: unknown } | null;
  error: string | null;
  applicationNumber: string | null;
}

// Global event emitter for streaming job updates via SSE
export const automationEvents = new EventEmitter();

// In-memory store for active job statuses
export const activeJobs = new Map<string, AutomationJob>();

/**
 * Generate a unique job ID.
 */
export const generateJobId = (): string => {
  return `job_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
};

/**
 * Initialize a job in the store.
 * @param redactedInput Redacted summary of applicant details (safe to expose)
 */
export const createJob = (
  jobId: string,
  tenantId: string,
  redactedInput: unknown = {},
  applicationId: string | null = null
): AutomationJob => {
  const job: AutomationJob = {
    jobId,
    tenantId,
    applicationId,
    status: 'queued',
    steps: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    inputSummary: redactedInput,
    result: null,
    error: null,
    applicationNumber: null,
  };
  activeJobs.set(jobId, job);

  addJobStep(jobId, 0, TOTAL_STEPS, 'queued', 'Job queued in background');
  return job;
};

/**
 * Add a progressive step update to a job's log and emit it to subscribers.
 */
export const addJobStep = (
  jobId: string | null,
  step: number,
  totalSteps: number,
  status: JobStatusValue,
  message: string,
  extra: Partial<Pick<JobStep, 'applicationNumber' | 'error'>> = {}
): void => {
  if (!jobId) return;
  const job = activeJobs.get(jobId);
  if (!job) return;

  const timestamp = new Date().toISOString();
  const update: JobStep = { jobId, step, totalSteps, status, message, timestamp, ...extra };

  job.steps.push(update);
  job.status = status;
  job.updatedAt = timestamp;

  activeJobs.set(jobId, job);

  automationEvents.emit(`status:${jobId}`, update);
  automationEvents.emit('status', update); // global listener support

  console.log(`[CarrierRPA] Job ${jobId}: Step ${step}/${totalSteps} (${status}) - ${message}`);
};

/**
 * Complete a job with success results.
 */
export const completeJob = (
  jobId: string,
  result: { applicationNumber?: string; [key: string]: unknown } = {}
): void => {
  const job = activeJobs.get(jobId);
  if (!job) return;

  job.status = 'completed';
  job.result = result;
  job.applicationNumber = result.applicationNumber || null;
  job.updatedAt = new Date().toISOString();
  activeJobs.set(jobId, job);

  addJobStep(jobId, TOTAL_STEPS, TOTAL_STEPS, 'completed', 'Automation completed successfully', {
    applicationNumber: result.applicationNumber,
  });
};

/**
 * Fail a job with a (pre-sanitized) error message.
 */
export const failJob = (jobId: string, errorMessage: string): void => {
  const job = activeJobs.get(jobId);
  if (!job) return;

  job.status = 'failed';
  job.error = errorMessage;
  job.updatedAt = new Date().toISOString();
  activeJobs.set(jobId, job);

  addJobStep(
    jobId,
    job.steps.length ? job.steps[job.steps.length - 1].step : 0,
    TOTAL_STEPS,
    'failed',
    errorMessage,
    { error: errorMessage }
  );
};

/**
 * Fetch a job from the store.
 */
export const getJob = (jobId: string): AutomationJob | null => {
  return activeJobs.get(jobId) || null;
};

/**
 * Clean up jobs older than 1 hour.
 */
export const cleanupOldJobs = (): void => {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  let count = 0;
  for (const [jobId, job] of activeJobs) {
    if (new Date(job.createdAt).getTime() < oneHourAgo) {
      activeJobs.delete(jobId);
      count++;
    }
  }
  if (count > 0) {
    console.log(`[CarrierRPA] Pruned ${count} old automation jobs from memory`);
  }
};

// Periodic cleanup; unref so the interval never keeps the process (or tests) alive
const cleanupTimer = setInterval(cleanupOldJobs, 10 * 60 * 1000);
if (typeof cleanupTimer.unref === 'function') {
  cleanupTimer.unref();
}
