import { describe, expect, it } from 'vitest';

import {
  describeDevice,
  formatLongDate,
  initialsFor,
  passwordStrength,
  roleLabels,
  signInMethodLabel,
} from '@/components/account/account-identity';

describe('the facts the Account page shows about a login', () => {
  it('lists each role once, most senior first, in words', () => {
    expect(roleLabels(['admin', 'OWNER', 'ADMIN'])).toEqual(['Owner', 'Administrator']);
    expect(roleLabels(['BUYER'])).toEqual(['Buyer']);
    expect(roleLabels(['SOME_NEW_ROLE'])).toEqual(['Some new role']);
    expect(roleLabels(undefined)).toEqual([]);
  });

  it('takes initials from the name, else the email', () => {
    expect(initialsFor('Marcus', 'Bell', 'm@x.test')).toBe('MB');
    expect(initialsFor(null, null, 'carol@x.test')).toBe('C');
    expect(initialsFor('', ' ', '')).toBe('?');
  });

  it('says how the login signs in', () => {
    expect(signInMethodLabel('EMAIL', true)).toBe('Email and password');
    expect(signInMethodLabel('GOOGLE', false)).toBe('Google');
    expect(signInMethodLabel('GOOGLE', true)).toBe('Google, or email and password');
  });

  it('names the browser and OS, Edge and Chrome apart', () => {
    const chromeMac =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
    const edgeWin =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 Edg/128.0';
    const safariPhone =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    expect(describeDevice(chromeMac)).toEqual({ browser: 'Chrome', os: 'macOS', mobile: false });
    expect(describeDevice(edgeWin)).toEqual({ browser: 'Edge', os: 'Windows', mobile: false });
    expect(describeDevice(safariPhone)).toEqual({ browser: 'Safari', os: 'iOS', mobile: true });
    expect(describeDevice('')).toEqual({
      browser: 'Unknown browser',
      os: 'Unknown OS',
      mobile: false,
    });
  });

  it('rates a password as a guide, never above zero under the minimum', () => {
    expect(passwordStrength('Ab1!', 10)).toBe(0);
    expect(passwordStrength('abcdefghij', 10)).toBe(1);
    expect(passwordStrength('Abcdefghij', 10)).toBe(2);
    expect(passwordStrength('Abcdefghij12', 10)).toBe(3);
    expect(passwordStrength('Correct-Horse-Battery-9', 10)).toBe(4);
  });

  it('formats a date, and says nothing for a bad one', () => {
    expect(formatLongDate('2025-03-04T12:00:00.000Z')).toBe('March 4, 2025');
    expect(formatLongDate('not a date')).toBeNull();
    expect(formatLongDate(null)).toBeNull();
  });
});
