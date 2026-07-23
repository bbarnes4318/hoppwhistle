import { describe, expect, it } from 'vitest';

import { isRoutableLeg, sanitizeDestinationString } from '../route-destination.js';

describe('sanitizeDestinationString', () => {
  it('keeps extensions, UUIDs, and phone numbers', () => {
    expect(isRoutableLeg('1002')).toBe(true);
    expect(isRoutableLeg('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
    expect(isRoutableLeg('+19312270171')).toBe(true);
    expect(isRoutableLeg('(931) 227-0171')).toBe(true);
    expect(isRoutableLeg('19312270171')).toBe(true);
  });

  it('drops the literal Campaign sentinel and other garbage', () => {
    expect(isRoutableLeg('Campaign')).toBe(false);
    expect(isRoutableLeg('')).toBe(false);
    expect(isRoutableLeg('voicemail')).toBe(false);
    expect(sanitizeDestinationString('Campaign')).toEqual({
      destination: '',
      dropped: ['Campaign'],
    });
  });

  it('preserves failover and parallel structure while dropping bad legs', () => {
    const result = sanitizeDestinationString('1000,Campaign|+19312270171');
    expect(result.destination).toBe('1000|+19312270171');
    expect(result.dropped).toEqual(['Campaign']);
  });

  it('drops whole steps that become empty', () => {
    const result = sanitizeDestinationString('Campaign|1003');
    expect(result.destination).toBe('1003');
  });

  it('handles null/empty input', () => {
    expect(sanitizeDestinationString(null).destination).toBe('');
    expect(sanitizeDestinationString('').destination).toBe('');
  });

  it('rejects short digit strings that are not extensions', () => {
    expect(isRoutableLeg('12345')).toBe(false);
    expect(isRoutableLeg('555')).toBe(false);
  });
});
