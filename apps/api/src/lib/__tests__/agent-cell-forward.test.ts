import { describe, expect, it } from 'vitest';

import {
  cellKey,
  dialedKeyFromChannelName,
  normalizeCellForwardNumber,
  readCellForwardNumber,
} from '../agent-cell-forward.js';

describe('normalizeCellForwardNumber', () => {
  it.each([
    ['8655551234', '+18655551234'],
    ['18655551234', '+18655551234'],
    ['+1 (865) 555-1234', '+18655551234'],
    ['865.555.1234', '+18655551234'],
  ])('accepts %s', (input, expected) => {
    expect(normalizeCellForwardNumber(input)).toBe(expected);
  });

  it.each([
    [''],
    ['555-1234'],
    ['+44 20 7946 0958'],
    ['0655551234'],
    ['8651551234'],
    ['call me'],
    ['865555123x'],
  ])('rejects %s', input => {
    expect(normalizeCellForwardNumber(input)).toBeNull();
  });

  it('rejects non-strings', () => {
    expect(normalizeCellForwardNumber(8655551234)).toBeNull();
    expect(normalizeCellForwardNumber(null)).toBeNull();
  });
});

describe('readCellForwardNumber', () => {
  it('reads a valid number from metadata', () => {
    expect(readCellForwardNumber({ cellForwardNumber: '865-555-1234' })).toBe('+18655551234');
  });

  it('is null for missing, invalid or malformed metadata', () => {
    expect(readCellForwardNumber({})).toBeNull();
    expect(readCellForwardNumber({ cellForwardNumber: 'nope' })).toBeNull();
    expect(readCellForwardNumber(null)).toBeNull();
    expect(readCellForwardNumber(['+18655551234'])).toBeNull();
  });
});

describe('dialedKeyFromChannelName', () => {
  it.each([
    ['sofia/gateway/fractel1/18655551234', '8655551234'],
    ['sofia/gateway/signalwire/+18655551234', '8655551234'],
    ['sofia/external/18655551234@sip.carrier.net', '8655551234'],
    ['sofia/gateway/anveo/99999918655551234', '8655551234'],
  ])('reads %s', (name, key) => {
    expect(dialedKeyFromChannelName(name)).toBe(key);
  });

  it('ignores softphone legs and empty names', () => {
    expect(dialedKeyFromChannelName('sofia/internal/1042@10.0.0.5')).toBeNull();
    expect(dialedKeyFromChannelName('')).toBeNull();
    expect(dialedKeyFromChannelName(undefined)).toBeNull();
    expect(dialedKeyFromChannelName('sofia/gateway/fractel1/1042')).toBeNull();
  });

  it('matches the stored number by key', () => {
    expect(dialedKeyFromChannelName('sofia/gateway/fractel1/18655551234')).toBe(
      cellKey('+18655551234')
    );
  });
});
