import { describe, it, expect, afterEach } from 'vitest';

import { encryptField, decryptField, last4 } from '../lib/field-encryption.js';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_ENV.NODE_ENV;
  if (ORIGINAL_ENV.FIELD_ENCRYPTION_KEY === undefined) {
    delete process.env.FIELD_ENCRYPTION_KEY;
  } else {
    process.env.FIELD_ENCRYPTION_KEY = ORIGINAL_ENV.FIELD_ENCRYPTION_KEY;
  }
});

describe('Field encryption', () => {
  it('round-trips values and never stores plaintext', () => {
    process.env.FIELD_ENCRYPTION_KEY = 'unit-test-key';
    const encrypted = encryptField('123456789');
    expect(encrypted).not.toBeNull();
    expect(encrypted).toMatch(/^enc:v1:/);
    expect(encrypted).not.toContain('123456789');
    expect(decryptField(encrypted)).toBe('123456789');
  });

  it('produces different ciphertexts for the same value (random IV)', () => {
    process.env.FIELD_ENCRYPTION_KEY = 'unit-test-key';
    const a = encryptField('987654321');
    const b = encryptField('987654321');
    expect(a).not.toBe(b);
    expect(decryptField(a)).toBe('987654321');
    expect(decryptField(b)).toBe('987654321');
  });

  it('returns null for empty values', () => {
    expect(encryptField(null)).toBeNull();
    expect(encryptField(undefined)).toBeNull();
    expect(encryptField('')).toBeNull();
    expect(decryptField(null)).toBeNull();
  });

  it('fails clearly in production when FIELD_ENCRYPTION_KEY is missing', () => {
    delete process.env.FIELD_ENCRYPTION_KEY;
    process.env.NODE_ENV = 'production';
    expect(() => encryptField('123456789')).toThrow(/FIELD_ENCRYPTION_KEY/);
  });

  it('extracts last-4 for masked display', () => {
    expect(last4('123456789')).toBe('6789');
    expect(last4('')).toBeNull();
    expect(last4(null)).toBeNull();
  });
});
