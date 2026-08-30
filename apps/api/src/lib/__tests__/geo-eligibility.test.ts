import { describe, expect, it } from 'vitest';

import {
  checkCallerStateEligibility,
  getStateFromZip,
  isCallerStateAccepted,
  resolveCallerState,
} from '../geo.js';

describe('isCallerStateAccepted / checkCallerStateEligibility', () => {
  it('excludes a state-restricted buyer when the caller state is unresolved (fail-closed)', () => {
    // This is the licensing-boundary bug: a buyer that only listed TX/OK is
    // licensed nowhere else. Guessing "allow" on their behalf when we don't
    // know the caller's state would put an out-of-state call in front of
    // them, which is their regulatory exposure, not our routing convenience.
    expect(isCallerStateAccepted(null, ['TX', 'OK'])).toBe(false);
    expect(isCallerStateAccepted(undefined, ['TX', 'OK'])).toBe(false);

    const result = checkCallerStateEligibility(null, ['TX', 'OK']);
    expect(result).toEqual({ accepted: false, reason: 'STATE_UNRESOLVED' });
  });

  it('still accepts every call for a National buyer (empty acceptedStates) when state is unresolved', () => {
    expect(isCallerStateAccepted(null, [])).toBe(true);
    expect(checkCallerStateEligibility(null, [])).toEqual({ accepted: true, reason: 'NATIONAL' });
  });

  it('accepts a resolved caller state that is in the accepted list', () => {
    expect(isCallerStateAccepted('TX', ['TX', 'OK'])).toBe(true);
    expect(checkCallerStateEligibility('tx', ['TX', 'OK'])).toEqual({
      accepted: true,
      reason: 'ACCEPTED',
    });
  });

  it('rejects a resolved caller state that is not in the accepted list, distinctly from unresolved', () => {
    expect(isCallerStateAccepted('CA', ['TX', 'OK'])).toBe(false);
    expect(checkCallerStateEligibility('CA', ['TX', 'OK'])).toEqual({
      accepted: false,
      reason: 'STATE_NOT_ACCEPTED',
    });
  });
});

describe('getStateFromZip', () => {
  it('resolves well-known unambiguous ZIP codes to their state', () => {
    expect(getStateFromZip('90210')).toBe('CA'); // Beverly Hills
    expect(getStateFromZip('10001')).toBe('NY'); // Manhattan
    expect(getStateFromZip('33101')).toBe('FL'); // Miami
    expect(getStateFromZip('37901')).toBe('TN'); // Knoxville
    expect(getStateFromZip('99501')).toBe('AK'); // Anchorage
    expect(getStateFromZip('96701')).toBe('HI'); // Aiea
    expect(getStateFromZip('20001')).toBe('DC');
  });

  it('handles ZIP+4 and non-digit formatting', () => {
    expect(getStateFromZip('90210-1234')).toBe('CA');
    expect(getStateFromZip(' 90210 ')).toBe('CA');
  });

  it('returns null for missing or too-short input', () => {
    expect(getStateFromZip(null)).toBeNull();
    expect(getStateFromZip(undefined)).toBeNull();
    expect(getStateFromZip('123')).toBeNull();
    expect(getStateFromZip('')).toBeNull();
  });
});

describe('resolveCallerState (shared priority resolver)', () => {
  it('prefers an IVR/ping-supplied state over ZIP and area code', () => {
    expect(
      resolveCallerState({ suppliedState: 'TX', zip: '90210', phoneNumber: '+12125551234' })
    ).toEqual({ state: 'TX', source: 'CALLER_SUPPLIED' });
  });

  it('falls back to ZIP when no state was supplied, even if the area code disagrees', () => {
    // 90210 is CA; +1 212 is a NY area code. ZIP must win.
    expect(resolveCallerState({ zip: '90210', phoneNumber: '+12125551234' })).toEqual({
      state: 'CA',
      source: 'ZIP',
    });
  });

  it('falls back to area code only when no state and no resolvable ZIP are present', () => {
    expect(resolveCallerState({ phoneNumber: '+18655551212' })).toEqual({
      state: 'TN',
      source: 'AREA_CODE',
    });
  });

  it('accepts a pre-extracted area code the same way as a phone number', () => {
    expect(resolveCallerState({ areaCode: '865' })).toEqual({ state: 'TN', source: 'AREA_CODE' });
  });

  it('is UNRESOLVED when no signal resolves to a state', () => {
    expect(resolveCallerState({})).toEqual({ state: null, source: 'UNRESOLVED' });
    expect(resolveCallerState({ phoneNumber: '+18005551212' })).toEqual({
      state: null,
      source: 'UNRESOLVED',
    }); // toll-free, non-geographic
  });

  it('ignores an invalid supplied state and falls through to ZIP', () => {
    expect(resolveCallerState({ suppliedState: 'ZZ', zip: '10001' })).toEqual({
      state: 'NY',
      source: 'ZIP',
    });
  });
});
