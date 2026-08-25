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

export function getAmeriquoteSrc(vertical: 'ACA' | 'FE' | 'B2B'): string {
  if (vertical === 'ACA') {
    return process.env.AMERIQUOTE_ACA_SRC || 'PVNACA_aged';
  }
  if (vertical === 'FE') {
    return process.env.AMERIQUOTE_FE_SRC || 'PVNFE_aged';
  }
  return '';
}

export function getAmeriquoteGatewayUrl(): string {
  return AMERIQUOTE_GATEWAY;
}

/** TYPE code per vertical — from the Boberdoo spec */
export function getAmeriquoteType(vertical: 'ACA' | 'FE' | 'B2B'): string {
  if (vertical === 'ACA') return '31';
  if (vertical === 'FE') return '19';
  return '';
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULTS = {
  MODE: 'full',
  API_ACTION: 'pingPostLead',
  FORMAT: 'JSON',
  /**
   * The opt-in page every lead we sell is attributed to. Landing_Page is Post
   * Required, and this is the correct value for our leads, so no CSV needs a
   * column for it — the mapper supplies it. A lead that carries its own
   * landingPage still overrides, which is the only way a different opt-in page
   * ever reaches the buyer.
   */
  LANDING_PAGE: 'https://quotes.nationallifecoverage.org',
} as const;

// ---------------------------------------------------------------------------
// Timeout
// ---------------------------------------------------------------------------

export const AMERIQUOTE_TIMEOUT_MS = 30_000; // 30 s
