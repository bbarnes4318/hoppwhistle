/**
 * Insurance Lead Pipeline — Ameriquote HTTP Poster
 *
 * Sends mapped payloads to the Ameriquote/Boberdoo pingPostLead gateway
 * and parses the JSON response.
 */

// import { createServiceLogger } from '../lib/logger.js';

// import { getAmeriquoteGatewayUrl, AMERIQUOTE_TIMEOUT_MS } from './insurance-lead-config.js';

// const log = createServiceLogger('insurance-lead-router');

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

/*
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
*/

// ---------------------------------------------------------------------------
// Poster
// ---------------------------------------------------------------------------

export async function postToAmeriquote(
  _payload: Record<string, string>,
): Promise<AmeriquoteResponse> {
  // AMERIQUOTE POSTING IS PERMANENTLY DISABLED BY OWNER REQUEST
  // DO NOT RE-ENABLE WITHOUT EXPLICIT OWNER INSTRUCTION.
  throw new Error('Ameriquote delivery is disabled by owner request.');
}

// ---------------------------------------------------------------------------
// Response Parser
// ---------------------------------------------------------------------------

/*
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

    return {
      success: false,
      status: 'Error',
      errorMessage: 'Failed to parse Ameriquote response',
      rawBody,
    };
  }
}
*/
