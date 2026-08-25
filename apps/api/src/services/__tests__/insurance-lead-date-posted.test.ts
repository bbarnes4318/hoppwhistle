import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/logger.js', () => ({
  createServiceLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { mapToAmeriquote } from '../insurance-lead-mapper.js';
import { normalizeDatePosted, validateAndNormalize } from '../insurance-lead-validator.js';

describe('normalizeDatePosted', () => {
  it('converts an ISO date to the m/d/Y H:i:s the buyer expects', () => {
    expect(normalizeDatePosted('2026-07-14')).toBe('7/14/2026 00:00:00');
  });

  it('keeps a time component when the file carries one', () => {
    expect(normalizeDatePosted('2026-07-14 09:12:05')).toBe('7/14/2026 09:12:05');
  });

  it('accepts US-style dates', () => {
    expect(normalizeDatePosted('07/14/2026')).toBe('7/14/2026 00:00:00');
  });

  it('leaves unparseable input alone so validation can flag it', () => {
    expect(normalizeDatePosted('last tuesday')).toBe('last tuesday');
  });
});

describe('datePosted through the pipeline', () => {
  beforeEach(() => {
    process.env.AMERIQUOTE_API_KEY = 'test-key';
    delete process.env.INSURANCE_LEAD_MODE;
  });

  it('survives validation instead of being stripped as an unknown field', () => {
    const result = validateAndNormalize('FE', {
      phone: '3125556085',
      datePosted: '2026-07-14',
    });

    expect(result.valid).toBe(true);
    expect(result.normalized?.datePosted).toBe('7/14/2026 00:00:00');
  });

  it('rejects a date the buyer could not parse', () => {
    const result = validateAndNormalize('FE', {
      phone: '3125556085',
      datePosted: 'sometime in July',
    });

    expect(result.valid).toBe(false);
    expect(result.errors?.map(e => e.path)).toContain('datePosted');
  });

  it('maps onto Origin_Lead_Date so an aged lead is not priced as fresh', () => {
    const { fullPayload } = mapToAmeriquote('FE', {
      phone: '3125556085',
      datePosted: '7/14/2026 09:12:05',
    });

    expect(fullPayload.Origin_Lead_Date).toBe('7/14/2026 09:12:05');
  });

  it('omits Origin_Lead_Date entirely when the lead has no date', () => {
    const { fullPayload } = mapToAmeriquote('FE', { phone: '3125556085' });

    expect(fullPayload.Origin_Lead_Date).toBeUndefined();
  });

  it('carries the compliance fields the CSV importer now maps', () => {
    const { fullPayload, redactedPayload } = mapToAmeriquote('FE', {
      phone: '3125556085',
      ipAddress: '75.2.92.149',
      trustedFormUrl: 'https://cert.trustedform.com/abc',
      leadidToken: 'token-1',
      consentLanguage: 'By clicking submit you agree to be contacted.',
    });

    expect(fullPayload.IP_Address).toBe('75.2.92.149');
    expect(fullPayload.Trusted_Form_URL).toBe('https://cert.trustedform.com/abc');
    expect(fullPayload.leadid_token).toBe('token-1');
    expect(fullPayload.consent_language).toBe('By clicking submit you agree to be contacted.');
    expect(redactedPayload.Key).toBe('[REDACTED]');
  });
});
