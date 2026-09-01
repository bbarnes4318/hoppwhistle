/**
 * Birth date normalization.
 *
 * A real vendor file arrived with birthDate "21724" — an Excel serial — and
 * all 18 of its leads were rejected as "must be MM/DD/YYYY". Two other shapes
 * were worse than rejected: they were accepted and sent wrong.
 */
import { describe, expect, it } from 'vitest';

import {
  calculateAge,
  isValidBirthDate,
  normalizeBirthDate,
} from '../insurance-lead-validator.js';

/** What the schema does: normalize, then accept only a real calendar date. */
const accepted = (raw: string) => {
  const out = normalizeBirthDate(raw);
  return isValidBirthDate(out) ? out : null;
};

describe('Excel serial dates', () => {
  // Verbatim from the Ameriquote 2026 list, 2026-09-01.
  it.each([
    ['21724', '06/23/1959'],
    ['19433', '03/15/1953'],
    ['27779', '01/20/1976'],
    ['22882', '08/24/1962'],
  ])('reads %s as %s', (serial, expected) => {
    expect(accepted(serial)).toBe(expected);
  });

  it('produces ages a Final Expense buyer would take', () => {
    for (const serial of ['21724', '19433', '27779']) {
      const age = calculateAge(accepted(serial) as string);
      expect(age).toBeGreaterThan(40);
      expect(age).toBeLessThan(100);
    }
  });

  it('refuses a number that is not a plausible birth date', () => {
    expect(accepted('999999999')).toBeNull();
    expect(accepted('1')).toBeNull();
  });
});

describe('shapes that were silently accepted and sent wrong', () => {
  it('rejects a day-first date rather than posting month 16', () => {
    expect(accepted('16/09/1980')).toBeNull();
  });

  it('rejects a bare year rather than inventing January 1st', () => {
    expect(accepted('1980')).toBeNull();
  });

  it('rejects a date that does not exist', () => {
    expect(accepted('02/30/2001')).toBeNull();
    expect(accepted('02/29/2001')).toBeNull();
    expect(accepted('13/01/1980')).toBeNull();
  });

  it('still takes a real leap day', () => {
    expect(accepted('02/29/2000')).toBe('02/29/2000');
  });
});

describe('formats that already worked keep working', () => {
  it.each([
    ['09/16/1980', 'MM/DD/YYYY'],
    ['9/16/1980', 'M/D/YYYY'],
    ['1980-09-16', 'YYYY-MM-DD'],
    ['1980-09-16T00:00:00Z', 'ISO with time'],
    ['Sep 16 1980', 'written out'],
    ['16-Sep-1980', 'day-first written out'],
    ['09.16.1980', 'dot separated'],
  ])('%s (%s)', raw => {
    expect(accepted(raw)).toBe('09/16/1980');
  });

  it('leaves an empty value to the optional check, not to this', () => {
    expect(normalizeBirthDate('')).toBe('');
    expect(accepted('   ')).toBeNull();
  });
});
