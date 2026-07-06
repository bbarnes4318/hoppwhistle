import { describe, it, expect } from 'vitest';

import {
  redactSensitive,
  redactPayload,
  sanitizeErrorMessage,
  safeApplicantSummary,
} from '../services/carrier-rpa/redaction.js';

describe('Carrier RPA redaction', () => {
  it('redacts SSN, routing, account, phone, password, and token values', () => {
    expect(redactSensitive('123456789', 'ssn')).toBe('***-**-6789');
    expect(redactSensitive('123456789', 'routing')).toBe('*****6789');
    expect(redactSensitive('123456789', 'account')).toBe('******6789');
    expect(redactSensitive('3125550100', 'phone')).toBe('***-***-0100');
    expect(redactSensitive('secret-password', 'password')).toBe('[REDACTED]');
    expect(redactSensitive('jwt-token-value', 'token')).toBe('[REDACTED]');
  });

  it('recursively redacts payloads including nested objects', () => {
    const payload = {
      firstName: 'John',
      ssn: '123456789',
      routingNumber: '987654321',
      phone: '3125550100',
      nested: {
        accountNumber: '1122334455',
        password: 'mypassword',
        apiKey: 'sk-abc123',
        authToken: 'bearer-xyz',
      },
    };

    const redacted = redactPayload(payload) as Record<string, unknown>;
    expect(redacted.firstName).toBe('John');
    expect(redacted.ssn).toBe('***-**-6789');
    expect(redacted.routingNumber).toBe('*****4321');
    expect(redacted.phone).toBe('***-***-0100');
    const nested = redacted.nested as Record<string, unknown>;
    expect(nested.accountNumber).toBe('******4455');
    expect(nested.password).toBe('[REDACTED]');
    expect(nested.apiKey).toBe('[REDACTED]');
    expect(nested.authToken).toBe('[REDACTED]');
  });

  it('never leaves a full 9-digit value in a redacted payload', () => {
    const redacted = JSON.stringify(
      redactPayload({
        ssn: '123456789',
        accountNumber: '999888777',
        transitNumber: '071000013',
        carrierPassword: 'Top$ecret1',
      })
    );
    expect(redacted).not.toContain('123456789');
    expect(redacted).not.toContain('999888777');
    expect(redacted).not.toContain('071000013');
    expect(redacted).not.toContain('Top$ecret1');
  });

  it('sanitizes error messages by stripping long digit runs and truncating', () => {
    const msg = sanitizeErrorMessage('Failed to type account 123456789012 into field');
    expect(msg).not.toContain('123456789012');
    expect(msg).toContain('[REDACTED-DIGITS]');

    const long = sanitizeErrorMessage('x'.repeat(1000));
    expect(long.length).toBeLessThanOrEqual(501);
  });

  it('builds applicant summaries with initials and masked phone only', () => {
    const summary = safeApplicantSummary({
      firstName: 'John',
      lastName: 'Doe',
      phone: '3125550100',
      state: 'Illinois',
    });
    expect(summary.applicant).toBe('J.D.');
    expect(summary.phone).toBe('***-***-0100');
    expect(JSON.stringify(summary)).not.toContain('3125550100');
  });
});
