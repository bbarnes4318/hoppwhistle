import { afterEach, describe, expect, it } from 'vitest';

import {
  getInboundExternalGateways,
  isRoutableLeg,
  sanitizeDestinationString,
} from '../route-destination.js';

const originalInboundExternalGateways = process.env.INBOUND_EXTERNAL_GATEWAYS;

afterEach(() => {
  if (originalInboundExternalGateways === undefined) {
    delete process.env.INBOUND_EXTERNAL_GATEWAYS;
  } else {
    process.env.INBOUND_EXTERNAL_GATEWAYS = originalInboundExternalGateways;
  }
});

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

describe('getInboundExternalGateways', () => {
  it('defaults to the full six-gateway FracTEL failover chain', () => {
    delete process.env.INBOUND_EXTERNAL_GATEWAYS;

    expect(getInboundExternalGateways()).toBe(
      'fractel1,fractel2,fractel3,fractel4,fractel5,fractel6'
    );
  });

  it('honors an explicit gateway chain override', () => {
    process.env.INBOUND_EXTERNAL_GATEWAYS = 'fractel6,fractel5';

    expect(getInboundExternalGateways()).toBe('fractel6,fractel5');
  });
});
