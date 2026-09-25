import { describe, expect, it } from 'vitest';

import { formatPhone } from '../format-phone';
import {
  formatClock,
  formatDayLabel,
  formatDayRange,
  formatDisplayDate,
  formatTableDateTime,
} from '../format-time';
import { formatPhoneNumber } from '../utils';

describe('formatPhone -- one display format for a phone number', () => {
  it.each(['+15513326220', '15513326220', '5513326220', '(551) 332-6220', '551-332-6220'])(
    'formats %s as (551) 332-6220',
    raw => {
      expect(formatPhone(raw)).toBe('(551) 332-6220');
    }
  );

  it('keeps a non-NANP number in the grouped + form it always had', () => {
    expect(formatPhone('+442071234567')).toBe('+442 071 234 567');
  });

  it('renders anything that is not a phone number verbatim', () => {
    expect(formatPhone('anonymous')).toBe('anonymous');
    expect(formatPhone('sip:1001@pbx.local')).toBe('sip:1001@pbx.local');
    expect(formatPhone('1001')).toBe('1001');
    expect(formatPhone('')).toBe('');
    expect(formatPhone(null)).toBe('');
  });

  it('is what lib/utils formatPhoneNumber resolves to', () => {
    expect(formatPhoneNumber).toBe(formatPhone);
    // The production defect: a stored bare number rendered raw on /calls.
    expect(formatPhoneNumber('5513326220')).toBe('(551) 332-6220');
  });
});

describe('time and date display', () => {
  const afternoon = new Date(2026, 8, 24, 16, 49, 7);
  const early = new Date(2026, 8, 25, 3, 26, 4);

  it('writes a table timestamp on a 12-hour clock with no leading zero', () => {
    expect(formatTableDateTime(afternoon)).toBe('Sep 24, 4:49 PM');
    expect(formatTableDateTime(early)).toBe('Sep 25, 3:26 AM');
    expect(formatTableDateTime(null)).toBe('—');
    expect(formatTableDateTime('not a date')).toBe('—');
  });

  it('writes a clock with and without seconds', () => {
    expect(formatClock(early)).toBe('3:26 AM');
    expect(formatClock(early, { seconds: true })).toBe('3:26:04 AM');
  });

  it('writes a calendar date with the month named, and a dash for none', () => {
    expect(formatDisplayDate(afternoon)).toBe('Sep 24, 2026');
    expect(formatDisplayDate(undefined)).toBe('—');
  });

  it('reads a YYYY-MM-DD day label as a calendar day, not a UTC instant', () => {
    expect(formatDayLabel('2026-09-25')).toBe('Sep 25, 2026');
    expect(formatDayLabel('whenever')).toBe('whenever');
  });

  it('writes a range with the year once when both ends share it', () => {
    expect(formatDayRange('2026-08-27', '2026-09-25')).toBe('Aug 27 – Sep 25, 2026');
    expect(formatDayRange('2025-12-29', '2026-01-04')).toBe('Dec 29, 2025 – Jan 4, 2026');
    expect(formatDayRange('2026-09-25', '2026-09-25')).toBe('Sep 25, 2026');
  });
});
