/**
 * Insurance Lead Pipeline — Ameriquote HTTP Poster
 *
 * Sends mapped payloads to the Ameriquote/Boberdoo pingPostLead gateway
 * and parses the JSON response.
 */

import { createServiceLogger } from '../lib/logger.js';

import { getAmeriquoteGatewayUrl, AMERIQUOTE_TIMEOUT_MS } from './insurance-lead-config.js';

const log = createServiceLogger('insurance-lead-router');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AmeriquoteResponse {
  success: boolean;
  status: 'Matched' | 'Unmatched' | 'Error' | 'Unknown';
  leadId?: string;
  price?: string;
  errorMessage?: string;
  rawBody: string;
}

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
  payload: Record<string, string>,
): Promise<AmeriquoteResponse> {
  const gatewayUrl = getAmeriquoteGatewayUrl();

  log.info({
    msg: 'Posting to Ameriquote',
    type: payload.TYPE,
    mode: payload.Mode,
    testLead: payload.Test_Lead || 'none',
  });

  try {
    // Build URL-encoded form body — Boberdoo expects GET/POST form params
    const formBody = new URLSearchParams(payload).toString();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AMERIQUOTE_TIMEOUT_MS);

    const response = await fetch(gatewayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formBody,
      signal: controller.signal,
    });

    clearTimeout(timeout);

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
  }
}

// ---------------------------------------------------------------------------
// Response Parser
// ---------------------------------------------------------------------------

function parseAmeriquoteResponse(rawBody: string): AmeriquoteResponse {
  try {
    const parsed = JSON.parse(rawBody) as BoberdooResponseBody;

    // Boberdoo wraps in { response: { status, lead_id?, price?, error? } }
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

    // Fallback for unexpected shapes
    return {
      success: false,
      status: 'Unknown',
      errorMessage: `Unexpected response status: ${status}`,
      rawBody,
    };
  } catch {
    // Response might be XML if Format param was ignored; handle gracefully
    log.warn({ msg: 'Failed to parse Ameriquote response as JSON', rawBody });

    // Try to detect XML statuses
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
