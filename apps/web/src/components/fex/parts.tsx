'use client';

/**
 * Small pieces every quoter screen shares: a labelled field, a native select
 * drawn in the portal's control style, the "From lead" tag, a check row, and
 * the tone mappings from engine vocabulary to the portal's signal tokens.
 *
 * Native selects on purpose: they are keyboard- and screen-reader-complete
 * with no extra code, they work on a phone, and the quoter has a lot of them.
 */

import * as React from 'react';

import type { StatusTone } from '@/components/domain';
import { cn } from '@/lib/utils';

export const CONTROL =
  'h-9 w-full min-w-0 rounded-control border border-rule-strong bg-surface px-3 text-sm text-ink ' +
  'transition-[border-color,box-shadow] duration-150 ease-out ne-motion hover:border-ink-3 ' +
  'focus-visible:border-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
  'disabled:cursor-not-allowed disabled:bg-sunken disabled:text-ink-3 [@media(pointer:coarse)]:min-h-[44px]';

export const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface';

export function FromLeadTag(): JSX.Element {
  return <span className="t-meta ml-1.5 font-normal text-ink-3">From lead</span>;
}

export function Field({
  label,
  htmlFor,
  fromLead,
  hint,
  className,
  children,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  fromLead?: boolean;
  hint?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className={cn('min-w-0', className)}>
      <label htmlFor={htmlFor} className="t-label mb-1 flex items-baseline text-ink-2">
        {label}
        {fromLead ? <FromLeadTag /> : null}
      </label>
      {children}
      {hint ? <p className="t-meta mt-1 text-ink-3">{hint}</p> : null}
    </div>
  );
}

export const NativeSelect = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select ref={ref} className={cn(CONTROL, 'cursor-pointer pr-8', className)} {...props} />
));
NativeSelect.displayName = 'NativeSelect';

export const TextInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(CONTROL, 'tabular-nums', className)} {...props} />
));
TextInput.displayName = 'TextInput';

export function CheckRow({
  id,
  checked,
  onChange,
  children,
  className,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: React.ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <label
      htmlFor={id}
      className={cn('flex cursor-pointer items-start gap-2.5 text-sm text-ink', className)}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className={cn('mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[var(--brand)]', FOCUS)}
      />
      <span className="min-w-0">{children}</span>
    </label>
  );
}

/** Bucket values are months, `undefined` or `null`; selects need strings. */
export function bucketValue(months: number | null | undefined): string {
  if (months === undefined) return '';
  if (months === null) return 'never';
  return String(months);
}

export function bucketFrom(value: string): number | null | undefined {
  if (value === '') return undefined;
  if (value === 'never') return null;
  return Number(value);
}

/** StatusChip tone for a benefit: Level is the good answer, GI is neither. */
export function benefitTone(benefit: string | undefined | null): StatusTone {
  switch (benefit) {
    case 'LEVEL':
      return 'live';
    case 'GRADED':
    case 'MODIFIED':
    case 'ROP':
      return 'ringing';
    default:
      return 'neutral';
  }
}

/** StatusChip tone for an engine outcome on a rule. */
export function outcomeTone(outcome: string): StatusTone {
  if (outcome === 'DECLINE') return 'dropped';
  if (outcome === 'REFER') return 'ringing';
  if (/GRADED|MODIFIED|ROP|GUARANTEED|GI|STANDARD_GRADED/.test(outcome)) return 'ringing';
  return 'live';
}

/** StatusChip tone for a rates / data status tone. */
export function dataTone(tone: string): StatusTone {
  switch (tone) {
    case 'good':
      return 'live';
    case 'warn':
    case 'mod':
      return 'ringing';
    case 'bad':
      return 'dropped';
    default:
      return 'neutral';
  }
}

/** The condition's short name: its label up to the first " (", "," or " - ". */
export function shortLabel(label: string): string {
  const cut = [' (', ',', ' - ']
    .map(sep => label.indexOf(sep))
    .filter(i => i > 0)
    .sort((a, b) => a - b)[0];
  return cut ? label.slice(0, cut) : label;
}
