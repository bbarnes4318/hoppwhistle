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
  'h-[38px] w-full aria-[invalid=true]:border-dropped min-w-0 rounded-control border border-rule-strong bg-surface px-3 text-sm font-medium text-ink placeholder:font-normal placeholder:text-ink-3 ' +
  'transition-[border-color,box-shadow] duration-150 ease-out ne-motion hover:border-ink-3 ' +
  'focus-visible:border-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
  'disabled:cursor-not-allowed disabled:bg-sunken disabled:text-ink-3 [@media(pointer:coarse)]:min-h-[44px]';

export const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface';

export function FromLeadTag(): JSX.Element {
  return <span className="ml-1.5 text-[11px] font-normal text-ink-3">From lead</span>;
}

/**
 * A field's label: small, sentence case and quieter than the value under it,
 * so the eye reads the answers, not the questions. Section titles are the
 * only uppercase in the form.
 */
export const FIELD_LABEL =
  'mb-1 flex items-baseline text-[11.5px] font-semibold leading-[14px] text-ink-2';

export function Field({
  label,
  htmlFor,
  fromLead,
  hint,
  error,
  className,
  children,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  fromLead?: boolean;
  hint?: React.ReactNode;
  /** Said right under the control, never in a banner somewhere else. */
  error?: string | null;
  className?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className={cn('min-w-0', className)}>
      <label htmlFor={htmlFor} className={FIELD_LABEL}>
        {label}
        {fromLead ? <FromLeadTag /> : null}
      </label>
      {children}
      {error ? (
        <p className="mt-1 text-[11.5px] font-medium leading-4 text-dropped-ink">{error}</p>
      ) : hint ? (
        <p className="t-meta mt-1 text-ink-3">{hint}</p>
      ) : null}
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

// ─── A choice of a few, as one row ───────────────────────────────────────────

export interface Choice<T> {
  value: T;
  label: React.ReactNode;
  /** The accessible name when the label is terse ("$5k"). */
  ariaLabel?: string;
  key?: string;
}

/**
 * A radio group drawn as a segmented row: `role="radiogroup"` and
 * `role="radio"` with a roving tab stop, so Tab enters once and the arrow keys
 * move AND select, exactly like native radios. Home and End jump to the ends.
 *
 * Both tones are ONE control: a sunken track, no rule between the segments.
 * `strong` fills the chosen segment with the primary colour -- for the
 * choices an agent must be able to read at a glance (the face amount).
 * `quiet` raises the chosen segment in white.
 */
export function ChoiceGroup<T>({
  label,
  labelledBy,
  options,
  value,
  onChange,
  tone = 'quiet',
  className,
  itemClassName,
  isChecked,
}: {
  /** The group's accessible name, unless `labelledBy` points at a visible one. */
  label?: string;
  labelledBy?: string;
  options: ReadonlyArray<Choice<T>>;
  value: T | null | undefined;
  /** `via` says whether a click or an arrow key chose it. */
  onChange: (value: T, via: 'click' | 'key') => void;
  tone?: 'quiet' | 'strong';
  className?: string;
  itemClassName?: string;
  /** Override "is this the checked one" (e.g. Custom checked for any off-list value). */
  isChecked?: (option: Choice<T>) => boolean;
}): JSX.Element {
  const refs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const checkedOf = (o: Choice<T>) => (isChecked ? isChecked(o) : o.value === value);
  const checkedIndex = options.findIndex(checkedOf);
  const tabStop = checkedIndex >= 0 ? checkedIndex : 0;

  const move = (from: number, to: number) => {
    const n = options.length;
    const next = ((to % n) + n) % n;
    if (next === from) return;
    refs.current[next]?.focus();
    onChange(options[next].value, 'key');
  };

  const onKeyDown = (index: number) => (e: React.KeyboardEvent<HTMLButtonElement>) => {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault();
        move(index, index + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault();
        move(index, index - 1);
        break;
      case 'Home':
        e.preventDefault();
        move(index, 0);
        break;
      case 'End':
        e.preventDefault();
        move(index, options.length - 1);
        break;
      default:
        break;
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      className={cn(
        'flex h-[38px] min-w-0 items-stretch gap-0.5 rounded-control bg-sunken p-[3px]',
        className
      )}
    >
      {options.map((option, index) => {
        const on = checkedOf(option);
        return (
          <button
            key={option.key ?? String(option.value)}
            ref={el => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={option.ariaLabel}
            tabIndex={index === tabStop ? 0 : -1}
            onClick={() => onChange(option.value, 'click')}
            onKeyDown={onKeyDown(index)}
            className={cn(
              'inline-flex min-w-0 flex-1 items-center justify-center whitespace-nowrap rounded-[6px] px-1 text-[13px] font-medium tabular-nums',
              'transition-[color,background-color,box-shadow] duration-150 ease-out ne-motion',
              'focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              '[@media(pointer:coarse)]:min-h-[40px]',
              tone === 'quiet'
                ? on
                  ? 'bg-surface font-semibold text-ink shadow-card'
                  : 'text-ink-2 hover:text-ink'
                : on
                  ? 'bg-brand-strong font-semibold text-white shadow-card'
                  : 'text-ink-2 hover:bg-surface hover:text-ink',
              itemClassName
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The benefit, as one word an agent reads at a glance. Empty when the carrier
 * does not say ("UNKNOWN"): no word is better than a badge that reads UNKNOWN.
 */
export function benefitWord(benefit: string | null | undefined): string {
  switch (benefit) {
    case 'LEVEL':
      return 'Level';
    case 'GRADED':
      return 'Graded';
    case 'MODIFIED':
      return 'Modified';
    case 'ROP':
      return 'Return of premium';
    case 'GUARANTEED_ISSUE':
    case 'GI':
      return 'Guaranteed issue';
    case 'UNKNOWN':
    case null:
    case undefined:
      return '';
    default:
      return benefit;
  }
}

/** The benefit as its badge says it: as short as agents say it ("ROP", "GI"). */
export function benefitShort(benefit: string | null | undefined): string {
  switch (benefit) {
    case 'ROP':
      return 'ROP';
    case 'GUARANTEED_ISSUE':
    case 'GI':
      return 'GI';
    default:
      return benefitWord(benefit);
  }
}
