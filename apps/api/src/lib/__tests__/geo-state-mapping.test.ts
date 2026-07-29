import { describe, expect, it } from 'vitest';

import {
  AREA_CODE_TO_STATE,
  NON_GEOGRAPHIC_CODES,
  extractAreaCode,
  getStateFromAreaCode,
  getStateFromPhoneNumber,
} from '../geo.js';

describe('canonical NANP area-code → state mapping', () => {
  it('resolves the same state for 10-digit, 11-digit, formatted, and E.164 inputs', () => {
    expect(getStateFromPhoneNumber('(865) 555-1212')).toBe('TN');
    expect(getStateFromPhoneNumber('18655551212')).toBe('TN');
    expect(getStateFromPhoneNumber('+1 865 555 1212')).toBe('TN');
    expect(getStateFromPhoneNumber('865-555-1212')).toBe('TN');
  });

  it('does not infer a state from a number shorter than a valid NANP number', () => {
    expect(extractAreaCode('55512')).toBeNull();
    expect(getStateFromPhoneNumber('55512')).toBeNull();
    expect(getStateFromPhoneNumber('')).toBeNull();
  });

  it('maps overlay area codes to the same state as the established code', () => {
    const overlays: Array<[string, string, string]> = [
      ['839', '803', 'SC'],
      ['551', '201', 'NJ'],
      ['224', '847', 'IL'],
      ['223', '717', 'PA'],
      ['240', '301', 'MD'],
    ];
    for (const [overlay, established, state] of overlays) {
      expect(AREA_CODE_TO_STATE[overlay]).toBe(state);
      expect(AREA_CODE_TO_STATE[established]).toBe(state);
    }
  });

  it('covers every area code in the imported Dograh caller-ID pool', () => {
    const expected: Record<string, string> = {
      '839': 'SC',
      '551': 'NJ',
      '423': 'TN',
      '276': 'VA',
      '251': 'AL',
      '240': 'MD',
      '231': 'MI',
      '228': 'MS',
      '224': 'IL',
      '223': 'PA',
      '216': 'OH',
    };
    for (const [npa, state] of Object.entries(expected)) {
      expect(getStateFromAreaCode(npa)).toBe(state);
    }
  });

  it('treats toll-free and non-geographic codes as stateless', () => {
    for (const npa of ['800', '833', '844', '855', '866', '877', '888', '900']) {
      expect(NON_GEOGRAPHIC_CODES.has(npa)).toBe(true);
      expect(getStateFromAreaCode(npa)).toBeNull();
      expect(getStateFromPhoneNumber(`+1${npa}5551212`)).toBeNull();
    }
  });

  it('treats unsupported territories as unknown', () => {
    expect(getStateFromPhoneNumber('+17875551212')).toBeNull(); // Puerto Rico
    expect(getStateFromPhoneNumber('+13405551212')).toBeNull(); // USVI
  });
});
