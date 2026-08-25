/**
 * The mode decides whether a post is a sale or a no-op, and the two are
 * indistinguishable in the logs, so the default is pinned here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/logger.js', () => ({
  createServiceLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { getInsuranceLeadMode, isTestMode } from '../insurance-lead-config.js';
import { mapToAmeriquote } from '../insurance-lead-mapper.js';

const original = process.env.INSURANCE_LEAD_MODE;

beforeEach(() => {
  process.env.AMERIQUOTE_API_KEY = 'test-key';
});

afterEach(() => {
  if (original === undefined) delete process.env.INSURANCE_LEAD_MODE;
  else process.env.INSURANCE_LEAD_MODE = original;
});

describe('getInsuranceLeadMode', () => {
  it('is LIVE when nothing sets it', () => {
    delete process.env.INSURANCE_LEAD_MODE;

    expect(getInsuranceLeadMode()).toBe('LIVE');
    expect(isTestMode()).toBe(false);
  });

  it('is LIVE when the value is empty', () => {
    process.env.INSURANCE_LEAD_MODE = '';

    expect(getInsuranceLeadMode()).toBe('LIVE');
  });

  it('is TEST only when something asks for it', () => {
    for (const value of ['test', 'TEST', ' Test ']) {
      process.env.INSURANCE_LEAD_MODE = value;
      expect(getInsuranceLeadMode()).toBe('TEST');
    }
  });

  it('treats an unrecognised value as LIVE rather than silently not selling', () => {
    process.env.INSURANCE_LEAD_MODE = 'staging';

    expect(getInsuranceLeadMode()).toBe('LIVE');
  });
});

describe('Test_Lead on the outbound payload', () => {
  it('is absent by default, so a post is a real one', () => {
    delete process.env.INSURANCE_LEAD_MODE;

    const { fullPayload } = mapToAmeriquote('FE', { phone: '3125556085' });

    expect(fullPayload.Test_Lead).toBeUndefined();
  });

  it('is stamped only when TEST was asked for', () => {
    process.env.INSURANCE_LEAD_MODE = 'test';

    const { fullPayload } = mapToAmeriquote('FE', { phone: '3125556085' });

    expect(fullPayload.Test_Lead).toBe('1');
  });
});
