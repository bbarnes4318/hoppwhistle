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

/**
 * LIVE unless something explicitly asks for TEST.
 *
 * This used to default to TEST "for safety", which had the failure backwards.
 * A TEST post stamps Test_Lead=1, is never bought, and looks identical to a
 * real one in every log and response — so the unset-env case silently threw
 * away a whole batch. An unintended LIVE post, by contrast, is loud and
 * recoverable: it has to clear readiness, it only happens on an explicit bulk
 * send, and the buyer's response says exactly what it did.
 *
 * Test runs set INSURANCE_LEAD_MODE=test deliberately.
 */
export function getInsuranceLeadMode(): InsuranceMode {
  const raw = (process.env.INSURANCE_LEAD_MODE || 'live').trim().toUpperCase();
  if (raw === 'TEST') return 'TEST';
  return 'LIVE';
}

export function isTestMode(): boolean {
  return getInsuranceLeadMode() === 'TEST';
}

// ---------------------------------------------------------------------------
// Ameriquote / Boberdoo Config
// ---------------------------------------------------------------------------

/** Live gateway — query-string params carry the payload via GET/POST */
const AMERIQUOTE_GATEWAY = 'https://ameriquote.leadportal.com/new_api/api.php';

/**
 * Why a send cannot run at all, or null when it can.
 *
 * getAmeriquoteApiKey throws, and it is only reached inside the mapper —
 * mid-post, once per lead. An empty AMERIQUOTE_API_KEY therefore surfaced as
 * 18 identical ERROR rows on a real run, each having spent a delivery attempt,
 * for one thing wrong in one env file. This is the same question asked before
 * the first post instead of during every one.
 *
 * Empty counts as missing: docker-compose.dev.yml passes the key through as
 * `${AMERIQUOTE_API_KEY:-}`, so a container started without it gets the
 * variable set to an empty string rather than left unset.
 */
export function getAmeriquoteConfigProblem(): string | null {
  if (!process.env.AMERIQUOTE_API_KEY?.trim()) {
    return 'AMERIQUOTE_API_KEY is not set on the API. No lead can be delivered until it is.';
  }
  return null;
}

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
