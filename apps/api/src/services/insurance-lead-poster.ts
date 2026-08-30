/**
 * Insurance Lead Pipeline — Ameriquote HTTP Poster
 *
 * Sends mapped payloads to the Ameriquote/Boberdoo pingPostLead gateway
 * and parses the JSON response.
 */

import { createServiceLogger } from '../lib/logger.js';

import { getAmeriquoteGatewayUrl, AMERIQUOTE_TIMEOUT_MS } from './insurance-lead-config.js';

const log = createServiceLogger('insurance-lead-poster');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AmeriquoteResponse {
  success: boolean;
  status: 'Matched' | 'Unmatched' | 'ManualReview' | 'Error' | 'Unknown';
  leadId?: string;
  price?: string;
  errorMessage?: string;
  rawBody: string;
}

/**
 * Boberdoo answers some posts with a status of the form
 *   "Lead ID 326229333 has to be manually approved."
 * rather than Matched/Unmatched/Error. The lead reached the buyer and has an
 * id — it is accepted and holding for their review, not a failure. Recording
 * it as an error made it re-sendable, and a second post of an accepted lead
 * comes back as a 90-day duplicate, which burns it for good.
 */
const MANUAL_REVIEW_PATTERN = /Lead ID\s+(\d+)\s+has to be manually approved/i;

interface BoberdooResponseBody {
  response?: BoberdooResponseData;
  status?: string;
  lead_id?: string | number;
  price?: string | number;
  error?: string;
}

interface BoberdooResponseData {
  status?: string;
  lead_id?: string | number;
  price?: string | number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Poster
// ---------------------------------------------------------------------------

export async function postToAmeriquote(
  payload: Record<string, string>
): Promise<AmeriquoteResponse> {
  const gatewayUrl = getAmeriquoteGatewayUrl();

  log.info({
    msg: 'Posting insurance lead to Ameriquote',
    type: payload.TYPE,
    mode: payload.Mode,
    testLead: payload.Test_Lead || 'none',
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AMERIQUOTE_TIMEOUT_MS);

  try {
    // Boberdoo expects standard URL-encoded form fields.
    const formBody = new URLSearchParams(payload).toString();

    const response = await fetch(gatewayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formBody,
      signal: controller.signal,
    });

    const rawBody = await response.text();

    log.info({
      msg: 'Ameriquote response received',
      httpStatus: response.status,
      bodyLength: rawBody.length,
    });

    return parseAmeriquoteResponse(rawBody);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error({ msg: 'Ameriquote post failed', error: message });

    return {
      success: false,
      status: 'Error',
      errorMessage: message,
      rawBody: '',
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Response Parser
// ---------------------------------------------------------------------------

export function parseAmeriquoteResponseForTest(rawBody: string): AmeriquoteResponse {
  return parseAmeriquoteResponse(rawBody);
}

function parseAmeriquoteResponse(rawBody: string): AmeriquoteResponse {
  try {
    const parsed = JSON.parse(rawBody) as BoberdooResponseBody;

    // Boberdoo normally wraps the response in { response: { ... } }.
    const resp: BoberdooResponseData = parsed?.response || parsed;
    const status = resp?.status || '';

    if (status === 'Matched') {
      return {
        success: true,
        status: 'Matched',
        leadId: resp.lead_id ? String(resp.lead_id) : undefined,
        price: resp.price ? String(resp.price) : undefined,
        rawBody,
      };
    }

    if (status === 'Unmatched') {
      return {
        success: false,
        status: 'Unmatched',
        leadId: resp.lead_id ? String(resp.lead_id) : undefined,
        rawBody,
      };
    }

    if (status === 'Error') {
      return {
        success: false,
        status: 'Error',
        errorMessage: resp.error || 'Unknown Ameriquote error',
        rawBody,
      };
    }

    const manualReview = MANUAL_REVIEW_PATTERN.exec(status) || MANUAL_REVIEW_PATTERN.exec(rawBody);
    if (manualReview) {
      return {
        success: true,
        status: 'ManualReview',
        leadId: manualReview[1],
        rawBody,
      };
    }

    return {
      success: false,
      status: 'Unknown',
      errorMessage: `Unexpected response status: ${status}`,
      rawBody,
    };
  } catch {
    // Some Boberdoo configurations return XML even when JSON is requested.
    log.warn({ msg: 'Failed to parse Ameriquote response as JSON', rawBody });

    if (rawBody.includes('<status>Matched</status>') || rawBody.includes('>Matched<')) {
      return { success: true, status: 'Matched', rawBody };
    }
    if (rawBody.includes('<status>Unmatched</status>') || rawBody.includes('>Unmatched<')) {
      return { success: false, status: 'Unmatched', rawBody };
    }

    return {
      success: false,
      status: 'Error',
      errorMessage: 'Failed to parse Ameriquote response',
      rawBody,
    };
  }
}
