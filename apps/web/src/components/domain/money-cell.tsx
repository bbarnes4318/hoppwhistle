import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * MoneyCell — every currency figure in the product.
 *
 * Plex Mono, tabular, right-aligned. A column of money that does not align
 * cannot be scanned, and scanning a column of money is most of what people do
 * on these screens.
 *
 * Takes minor units (cents) by default. Passing dollars as a float is how
 * rounding bugs reach an invoice, so `minorUnits` is the default and the
 * escape hatch is explicit.
 */

export interface MoneyCellProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** Amount in minor units (cents) unless `unit` says otherwise. */
  amount: number | null | undefined;
  /** ISO 4217. Drives both the symbol and the decimal places. */
  currency?: string;
  /** `minor` (default, cents) or `major` (whole currency units). */
  unit?: 'minor' | 'major';
  /** What to render for null/undefined. An em dash, not a zero — they differ. */
  placeholder?: string;
  /**
   * Colour the figure. `auto` uses money for positive, dropped for negative,
   * ink-3 for zero. `none` inherits, which is right inside a table row.
   */
  tone?: 'auto' | 'money' | 'none';
  /** Always show a leading + on positive values, e.g. in a ledger. */
  signed?: boolean;
  size?: 'data' | 'figure';
}

/** Minor-unit exponent for the currencies that are not 2. */
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'XAF', 'XOF']);
const THREE_DECIMAL = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'OMR', 'TND']);

function exponentFor(currency: string): number {
  if (ZERO_DECIMAL.has(currency)) return 0;
  if (THREE_DECIMAL.has(currency)) return 3;
  return 2;
}

export function formatMoney(
  amount: number,
  currency = 'USD',
  unit: 'minor' | 'major' = 'minor'
): string {
  const exponent = exponentFor(currency);
  const major = unit === 'minor' ? amount / 10 ** exponent : amount;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(major);
}

export function MoneyCell({
  amount,
  currency = 'USD',
  unit = 'minor',
  placeholder = '—',
  tone = 'none',
  signed = false,
  size = 'data',
  className,
  ...props
}: MoneyCellProps) {
  const step = size === 'figure' ? 't-figure' : 't-data';

  if (amount === null || amount === undefined || Number.isNaN(amount)) {
    return (
      <span className={cn(step, 'tabular text-ink-3', className)} {...props}>
        {placeholder}
      </span>
    );
  }

  const formatted = formatMoney(amount, currency, unit);
  const withSign = signed && amount > 0 ? `+${formatted}` : formatted;

  const toneClass =
    tone === 'none'
      ? ''
      : tone === 'money'
        ? 'text-money-ink'
        : amount > 0
          ? 'text-money-ink'
          : amount < 0
            ? 'text-dropped-ink'
            : 'text-ink-3';

  return (
    <span
      className={cn(step, 'tabular whitespace-nowrap', toneClass, className)}
      // The accessible name spells out the currency; the visible text is a symbol.
      aria-label={`${withSign} ${currency}`}
      {...props}
    >
      {withSign}
    </span>
  );
}
