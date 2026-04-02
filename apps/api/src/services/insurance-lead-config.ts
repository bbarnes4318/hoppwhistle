/**
 * Insurance Lead Pipeline — Centralized Configuration
 *
 * Single source of truth for mode resolution, Ameriquote endpoints,
 * SRC values, and API key access. All secrets come from env vars.
 */

import { createServiceLogger } from '../lib/logger.js';

const log = createServiceLogger('insurance-lead-config');

// ---------------------------------------------------------------------------
// Mode
// ---------------------------------------------------------------------------

export type InsuranceMode = 'TEST' | 'LIVE';

export function getInsuranceLeadMode(): InsuranceMode {
  const raw = (process.env.INSURANCE_LEAD_MODE || 'test').trim().toUpperCase();
  if (raw === 'LIVE') return 'LIVE';
  return 'TEST'; // default to TEST for safety
}

export function isTestMode(): boolean {
  return getInsuranceLeadMode() === 'TEST';
}

// ---------------------------------------------------------------------------
// Ameriquote / Boberdoo Config
// ---------------------------------------------------------------------------

/** Live gateway — query-string params carry the payload via GET/POST */
const AMERIQUOTE_GATEWAY = 'https://ameriquote.leadportal.com/new_api/api.php';

export function getAmeriquoteApiKey(): string {
  const key = process.env.AMERIQUOTE_API_KEY;
  if (!key) {
    log.error('AMERIQUOTE_API_KEY environment variable is not set');
    throw new Error('AMERIQUOTE_API_KEY is not configured');
  }
  return key;
}

export function getAmeriquoteSrc(vertical: 'ACA' | 'FE'): string {
  if (vertical === 'ACA') {
    return process.env.AMERIQUOTE_ACA_SRC || 'PVNACA_aged';
  }
  return process.env.AMERIQUOTE_FE_SRC || 'PVNFE_aged';
}

export function getAmeriquoteGatewayUrl(): string {
  return AMERIQUOTE_GATEWAY;
}

/** TYPE code per vertical — from the Boberdoo spec */
export function getAmeriquoteType(vertical: 'ACA' | 'FE'): string {
  return vertical === 'ACA' ? '31' : '19';
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULTS = {
  MODE: 'full',
  API_ACTION: 'pingPostLead',
  FORMAT: 'JSON',
  LANDING_PAGE: 'hopwhistle.com',
} as const;

// ---------------------------------------------------------------------------
// Timeout
// ---------------------------------------------------------------------------

export const AMERIQUOTE_TIMEOUT_MS = 30_000; // 30 s
