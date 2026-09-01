/**
 * A bulk send that reports "18 errored" and nothing else is unreadable: the
 * reason the buyer gave is the whole point. These cover the two places the
 * reason used to be lost — the response parser flattening everything it did
 * not recognise into one generic string, and the batch summary reporting only
 * counts.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/logger.js', () => ({
  createServiceLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('../insurance-lead-config.js', () => ({
  getAmeriquoteGatewayUrl: () => 'https://example.invalid/gateway',
  AMERIQUOTE_TIMEOUT_MS: 15000,
}));

import { groupFailureReasons } from '../insurance-lead-bulk-delivery.js';
import { parseAmeriquoteResponseForTest } from '../insurance-lead-poster.js';

describe('parsing an Ameriquote rejection', () => {
  it('reads the reason out of an XML error rather than reporting a parse failure', () => {
    const parsed = parseAmeriquoteResponseForTest(
      '<?xml version="1.0"?><response><status>Error</status><error>Filter failure: Primary_Phone is on the DNC list</error></response>'
    );

    expect(parsed.status).toBe('Error');
    expect(parsed.success).toBe(false);
    expect(parsed.errorMessage).toContain('DNC list');
    expect(parsed.errorMessage).not.toContain('Failed to parse');
  });

  it('keeps reading a Matched XML response as a sale', () => {
    const parsed = parseAmeriquoteResponseForTest(
      '<response><status>Matched</status><lead_id>987654</lead_id><price>18.50</price></response>'
    );

    expect(parsed.status).toBe('Matched');
    expect(parsed.success).toBe(true);
    expect(parsed.leadId).toBe('987654');
    expect(parsed.price).toBe('18.50');
  });

  it('reads an XML manual approval as an acceptance, not a failure', () => {
    const parsed = parseAmeriquoteResponseForTest(
      '<response><status>Lead ID 326229333 has to be manually approved.</status></response>'
    );

    expect(parsed.status).toBe('ManualReview');
    expect(parsed.success).toBe(true);
    expect(parsed.leadId).toBe('326229333');
  });

  it('says what an Unmatched means instead of leaving the reason blank', () => {
    const parsed = parseAmeriquoteResponseForTest('{"response":{"status":"Unmatched"}}');

    expect(parsed.status).toBe('Unmatched');
    expect(parsed.errorMessage).toBeTruthy();
  });

  it('carries the body when the status is one we do not recognise', () => {
    const parsed = parseAmeriquoteResponseForTest('{"response":{"status":""}}');

    expect(parsed.status).toBe('Unknown');
    // The old message stopped at "Unexpected response status: " — the reason
    // was cut out of it exactly when it was needed.
    expect(parsed.errorMessage).toContain('status');
    expect(parsed.errorMessage).toContain('{"response":{"status":""}}');
  });

  it('carries the body when the gateway answers with an HTML error page', () => {
    const parsed = parseAmeriquoteResponseForTest(
      '<html><body><h1>403 Forbidden</h1><p>Invalid Key</p></body></html>',
      403
    );

    expect(parsed.success).toBe(false);
    expect(parsed.httpStatus).toBe(403);
    expect(parsed.errorMessage).toContain('403 Forbidden');
  });

  it('reports an empty body as empty rather than as nothing at all', () => {
    const parsed = parseAmeriquoteResponseForTest('');

    expect(parsed.success).toBe(false);
    expect(parsed.errorMessage).toContain('empty response body');
  });
});

describe('grouping a batch of failures', () => {
  const lead = (overrides: Record<string, unknown>) =>
    ({
      insuranceLeadId: 'lead',
      submissionId: 'sub',
      phone: '3125556085',
      name: 'Jane Doe',
      ...overrides,
    }) as any;

  it('collapses the same rejection across leads into one counted reason', () => {
    const reasons = groupFailureReasons([
      lead({ submissionId: 's1', outcome: 'ERROR', message: 'Duplicate lead - phone 3125556085' }),
      lead({ submissionId: 's2', outcome: 'ERROR', message: 'Duplicate lead - phone 6605538620' }),
      lead({ submissionId: 's3', outcome: 'ERROR', message: 'Invalid Key' }),
      lead({ submissionId: 's4', outcome: 'MATCHED' }),
    ]);

    // The two duplicates differ only by phone number, so they group as one.
    expect(reasons).toHaveLength(2);
    expect(reasons[0].count).toBe(2);
    expect(reasons[0].message).toContain('Duplicate lead');
    expect(reasons[0].examples).toHaveLength(2);
    expect(reasons[1].message).toBe('Invalid Key');
  });

  it('ignores leads the buyer accepted', () => {
    const reasons = groupFailureReasons([
      lead({ outcome: 'MATCHED' }),
      lead({ outcome: 'MANUAL_REVIEW' }),
    ]);

    expect(reasons).toEqual([]);
  });

  it('reports a held-back lead under every field it is missing', () => {
    const reasons = groupFailureReasons([
      lead({
        outcome: 'NOT_READY',
        message: 'Missing fields the buyer requires',
        blockers: [
          { field: 'dob', outboundField: 'DOB', message: 'Date of birth is required' },
          { field: 'state', outboundField: 'State', message: 'State is required' },
        ],
      }),
    ]);

    expect(reasons.map(r => r.message).sort()).toEqual([
      'Date of birth is required',
      'State is required',
    ]);
  });

  it('never reports a failure with an empty reason', () => {
    const reasons = groupFailureReasons([lead({ outcome: 'ERROR' })]);

    expect(reasons[0].message).toBeTruthy();
  });
});
