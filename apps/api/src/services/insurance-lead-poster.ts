/**
 * Insurance Lead Pipeline — Ameriquote HTTP Poster
 *
 * Sends mapped payloads to the Ameriquote/Boberdoo pingPostLead gateway and
 * parses the reply, which is JSON on some accounts and XML on others.
 *
 * Every failure path here must end up carrying a reason a human can act on:
 * an empty or generic message is what makes a batch of rejections unreadable
 * in the CRM, and the raw body is often the only place the reason exists.
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
  /** HTTP status the gateway answered with, when we got that far. */
  httpStatus?: number;
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
  // Boberdoo is inconsistent about which of these carries the rejection
  // reason, so all three are read before falling back to the raw body.
  error?: string;
  errors?: string;
  message?: string;
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

    // A non-2xx is a rejection by the gateway rather than by the buyer, and
    // its body is usually an HTML error page. Parsing it as a lead response
    // produced a generic message that hid the status code entirely.
    if (!response.ok) {
      const parsed = parseAmeriquoteResponse(rawBody, response.status);
      if (parsed.status === 'Matched' || parsed.status === 'ManualReview') return parsed;

      log.error({
        msg: 'Ameriquote returned a non-2xx response',
        httpStatus: response.status,
        rawBody: rawBody.slice(0, 1000),
      });

      return {
        success: false,
        status: 'Error',
        errorMessage:
          `Ameriquote HTTP ${response.status} ${response.statusText || ''}`.trim() +
          `: ${parsed.errorMessage || snippet(rawBody)}`,
        httpStatus: response.status,
        rawBody,
      };
    }

    return parseAmeriquoteResponse(rawBody, response.status);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error({ msg: 'Ameriquote post failed', error: message });

    // An abort is our own timeout firing, not something the buyer said. Saying
    // so beats recording the bare "This operation was aborted".
    const isTimeout =
      (error instanceof Error && error.name === 'AbortError') || /abort/i.test(message);

    return {
      success: false,
      status: 'Error',
      errorMessage: isTimeout
        ? `No response from Ameriquote within ${AMERIQUOTE_TIMEOUT_MS}ms (${gatewayUrl})`
        : `Could not reach Ameriquote (${gatewayUrl}): ${message}`,
      rawBody: '',
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Response Parser
// ---------------------------------------------------------------------------

export function parseAmeriquoteResponseForTest(
  rawBody: string,
  httpStatus?: number
): AmeriquoteResponse {
  return parseAmeriquoteResponse(rawBody, httpStatus);
}

/** A body snippet for the error message, collapsed to one readable line. */
function snippet(rawBody: string, max = 300): string {
  const flat = rawBody.replace(/\s+/g, ' ').trim();
  if (!flat) return '(empty response body)';
  return flat.length > max ? `${flat.slice(0, max)}...` : flat;
}

/** First non-empty capture of the first pattern that matches. */
function firstMatch(rawBody: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const value = pattern.exec(rawBody)?.[1]?.trim();
    if (value) return value;
  }
  return undefined;
}

/**
 * Boberdoo answers with XML unless the account is configured for JSON, and its
 * error detail lives in an <error>/<message> element. Reading only <status>
 * threw that detail away and left every XML rejection reported as the same
 * unhelpful "Failed to parse Ameriquote response".
 */
function parseXmlResponse(rawBody: string, httpStatus?: number): AmeriquoteResponse {
  const status = firstMatch(rawBody, [/<status>\s*([^<]+?)\s*<\/status>/i]);
  const leadId = firstMatch(rawBody, [
    /<lead_id>\s*([^<]+?)\s*<\/lead_id>/i,
    /<leadid>\s*([^<]+?)\s*<\/leadid>/i,
  ]);
  const price = firstMatch(rawBody, [/<price>\s*([^<]+?)\s*<\/price>/i]);
  const error = firstMatch(rawBody, [
    /<error>\s*([^<]+?)\s*<\/error>/i,
    /<errors>\s*([^<]+?)\s*<\/errors>/i,
    /<message>\s*([^<]+?)\s*<\/message>/i,
    /<reason>\s*([^<]+?)\s*<\/reason>/i,
  ]);

  if (status && /^matched$/i.test(status)) {
    return { success: true, status: 'Matched', leadId, price, httpStatus, rawBody };
  }

  if (status && /^unmatched$/i.test(status)) {
    return {
      success: false,
      status: 'Unmatched',
      leadId,
      // Boberdoo sends no error element with an Unmatched, so say what the
      // status itself means rather than leaving the reason column blank.
      errorMessage: error || 'No buyer matched this lead (filters, caps, or duplicate).',
      httpStatus,
      rawBody,
    };
  }

  const manualReview =
    MANUAL_REVIEW_PATTERN.exec(status || '') || MANUAL_REVIEW_PATTERN.exec(rawBody);
  if (manualReview) {
    return { success: true, status: 'ManualReview', leadId: manualReview[1], httpStatus, rawBody };
  }

  if (status && /^error$/i.test(status)) {
    return {
      success: false,
      status: 'Error',
      errorMessage: error || `Ameriquote returned Error with no detail: ${snippet(rawBody)}`,
      httpStatus,
      rawBody,
    };
  }

  // Not JSON and not a shape we recognise. The body is the only remaining
  // evidence of what the buyer objected to, so it goes in the message.
  return {
    success: false,
    status: 'Error',
    errorMessage: error
      ? `Ameriquote: ${error}`
      : `Unrecognized Ameriquote response${status ? ` (status "${status}")` : ''}: ${snippet(rawBody)}`,
    httpStatus,
    rawBody,
  };
}

function parseAmeriquoteResponse(rawBody: string, httpStatus?: number): AmeriquoteResponse {
  try {
    const parsed = JSON.parse(rawBody) as BoberdooResponseBody;

    // Boberdoo normally wraps the response in { response: { ... } }.
    const resp: BoberdooResponseData = parsed?.response || parsed;
    const status = resp?.status || '';
    const error = resp?.error || resp?.errors || resp?.message || parsed?.error;

    if (status === 'Matched') {
      return {
        success: true,
        status: 'Matched',
        leadId: resp.lead_id ? String(resp.lead_id) : undefined,
        price: resp.price ? String(resp.price) : undefined,
        httpStatus,
        rawBody,
      };
    }

    if (status === 'Unmatched') {
      return {
        success: false,
        status: 'Unmatched',
        leadId: resp.lead_id ? String(resp.lead_id) : undefined,
        // An Unmatched carries no error field. Record what it means so the
        // reason is never blank in the CRM.
        errorMessage: error
          ? String(error)
          : 'No buyer matched this lead (filters, caps, or duplicate).',
        httpStatus,
        rawBody,
      };
    }

    if (status === 'Error') {
      return {
        success: false,
        status: 'Error',
        errorMessage: error
          ? String(error)
          : `Ameriquote returned Error with no detail: ${snippet(rawBody)}`,
        httpStatus,
        rawBody,
      };
    }

    const manualReview = MANUAL_REVIEW_PATTERN.exec(status) || MANUAL_REVIEW_PATTERN.exec(rawBody);
    if (manualReview) {
      return {
        success: true,
        status: 'ManualReview',
        leadId: manualReview[1],
        httpStatus,
        rawBody,
      };
    }

    return {
      success: false,
      status: 'Unknown',
      // An empty status used to produce "Unexpected response status: " — a
      // message with the reason cut out of it. Always carry the body.
      errorMessage: error
        ? `Ameriquote: ${String(error)}`
        : `Unexpected Ameriquote response${status ? ` status "${status}"` : ''}: ${snippet(rawBody)}`,
      httpStatus,
      rawBody,
    };
  } catch {
    // Boberdoo returns XML unless the account is set to JSON, so this is the
    // normal path for many tenants, not an exceptional one.
    log.warn({ msg: 'Ameriquote response was not JSON, parsing as XML', httpStatus, rawBody });
    return parseXmlResponse(rawBody, httpStatus);
  }
}
