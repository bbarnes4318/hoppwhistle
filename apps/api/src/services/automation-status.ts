/**
 * Automation Status Service
 *
 * Provides real-time status updates for carrier application automation
 * via EventEmitter pattern with SSE streaming support.
 *
 * Ported from: fe-rickie/server/services/automationStatus.js
 */

import { EventEmitter } from 'events';

// Type definitions
export interface StatusUpdate {
  jobId: string;
  step: number;
  totalSteps: number;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  message: string;
  timestamp: string;
}

export interface JobStatus {
  steps: StatusUpdate[];
  currentStatus: StatusUpdate['status'];
  lastUpdate: StatusUpdate | null;
}

// Global event emitter for automation status
export const automationEvents = new EventEmitter();

// Store for active job statuses
export const activeJobs = new Map<string, JobStatus>();

/**
 * Generate unique job ID
 */
export const generateJobId = (): string => {
  return `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

/**
 * Emit status update for a job
 */
export const emitStatus = (
  jobId: string,
  step: number,
  totalSteps: number,
  status: StatusUpdate['status'],
  message: string
): StatusUpdate => {
  const update: StatusUpdate = {
    jobId,
    step,
    totalSteps,
    status,
    message,
    timestamp: new Date().toISOString(),
  };

  // Store latest status
  let jobStatus = activeJobs.get(jobId) || {
    steps: [],
    currentStatus: 'pending',
    lastUpdate: null,
  };
  jobStatus.steps.push(update);
  jobStatus.currentStatus = status;
  jobStatus.lastUpdate = update;
  activeJobs.set(jobId, jobStatus);

  // Emit to all listeners
  automationEvents.emit('status', update);
  console.log(`[Automation Status] Job ${jobId}: Step ${step}/${totalSteps} - ${message}`);

  return update;
};

/**
 * Get all status updates for a job
 */
export const getJobStatus = (jobId: string): JobStatus | null => {
  return activeJobs.get(jobId) || null;
};

/**
 * Clean up old jobs (call periodically)
 */
export const cleanupOldJobs = (): void => {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const [jobId, job] of activeJobs) {
    if (job.lastUpdate && new Date(job.lastUpdate.timestamp).getTime() < oneHourAgo) {
      activeJobs.delete(jobId);
    }
  }
};

// Cleanup every 30 minutes
setInterval(cleanupOldJobs, 30 * 60 * 1000);
