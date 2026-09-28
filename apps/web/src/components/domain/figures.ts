/**
 * How a figure reads in a KPI tile or a page header.
 *
 * ── Money ────────────────────────────────────────────────────────────────────
 *
 * Whole dollars once a figure reaches $1,000 ("$200,940"): at that size the
 * cents are noise the eye has to step over to find the number. Below $1,000 the
 * cents stay ("$894.50"). Tables and statements keep cents everywhere -- they
 * are what gets added up and reconciled.
 *
 * ── Zero ─────────────────────────────────────────────────────────────────────
 *
 * A zero, an empty figure or an em dash renders in ink-3, never in the brand
 * blue or green: a coloured $0.00 reads as good news.
 */

import type * as React from 'react';

const MONEY_TEXT = /^([-−]?)\$([\d,]+)\.(\d{2})$/;

/** Dollars for a tile or a header: whole at $1,000 and over, cents below. */
export function tileDollars(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const whole = Math.abs(value) >= 1000;
  return `${value < 0 ? '−' : ''}$${Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  })}`;
}

/**
 * A money string already formatted with cents ("$200,940.12"), rewritten to
 * the tile rule. Anything that is not a plain money string comes back as it
 * was, so a tile can pass every figure through this.
 */
export function tileMoneyText(text: string): string {
  const match = MONEY_TEXT.exec(text.trim());
  if (!match) return text;
  const [, sign, dollars, cents] = match;
  const value = Number(`${dollars.replace(/,/g, '')}.${cents}`);
  if (value < 1000) return text;
  return tileDollars(sign ? -value : value);
}

/**
 * Whether a rendered figure says "nothing": a zero in any format ("0",
 * "$0.00", "0.0%", "0s"), an em dash, or an empty string. "0 of 12" is not
 * zero -- twelve is a real figure.
 */
export function isZeroFigure(figure: React.ReactNode): boolean {
  if (figure === null || figure === undefined || figure === false) return true;
  if (typeof figure === 'number') return figure === 0 || Number.isNaN(figure);
  if (typeof figure !== 'string') return false;
  const digits = figure.replace(/[^0-9]/g, '');
  if (digits.length === 0) return true;
  return /^0+$/.test(digits);
}

/** "▲ 12%" / "▼ 3%" against a comparison, or null when there is nothing to compare with. */
export function percentChange(
  value: number | null | undefined,
  comparison: number | null | undefined
): { value: string; direction: 'up' | 'down' | 'flat' } | null {
  if (value === null || value === undefined) return null;
  if (comparison === null || comparison === undefined || comparison === 0) return null;
  const change = ((value - comparison) / Math.abs(comparison)) * 100;
  const rounded = Math.round(change);
  if (rounded === 0) return { value: '0%', direction: 'flat' };
  return { value: `${Math.abs(rounded)}%`, direction: rounded > 0 ? 'up' : 'down' };
}
