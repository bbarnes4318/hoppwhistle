'use client';

import { Check, Copy } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

import { StatusChip } from './status-chip';

/**
 * PhoneCell — a phone number, formatted, click to copy, with optional state.
 *
 * Copying a number is the single most common thing anyone does with one on
 * these screens, so it is one click on the number itself rather than a menu.
 * The raw E.164 is what lands on the clipboard, never the pretty form — people
 * paste these into dialers and CRMs that reject punctuation.
 */

export interface PhoneCellProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  /** E.164 preferred, e.g. +14155550142. Anything else renders verbatim. */
  number: string | null | undefined;
  /** Optional state rendered beside the number. */
  status?: { value: string; enumName?: string };
  /** Suppress the copy affordance, e.g. in a dense read-only export view. */
  copyable?: boolean;
  placeholder?: string;
}

/** +14155550142 → +1 (415) 555-0142. Non-NANP numbers are grouped loosely. */
export function formatPhone(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('+')) return trimmed;
  const digits = trimmed.slice(1);

  if (digits.length === 11 && digits.startsWith('1')) {
    const n = digits.slice(1);
    return `+1 (${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`;
  }
  if (digits.length === 10) {
    return `+1 (${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  // Unknown plan: group from the right in 3s so it stays scannable.
  const groups: string[] = [];
  for (let i = digits.length; i > 0; i -= 3) groups.unshift(digits.slice(Math.max(0, i - 3), i));
  return `+${groups.join(' ')}`;
}

export function PhoneCell({
  number,
  status,
  copyable = true,
  placeholder = '—',
  className,
  ...props
}: PhoneCellProps) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout>>();

  React.useEffect(() => () => clearTimeout(timer.current), []);

  const copy = React.useCallback(async () => {
    if (!number) return;
    try {
      await navigator.clipboard.writeText(number);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be blocked by permissions policy. Failing silently is
      // wrong — leave the number selectable and say nothing rather than
      // claiming a copy that did not happen.
      setCopied(false);
    }
  }, [number]);

  if (!number) {
    return (
      <span className={cn('t-data text-ink-3', className)} {...props}>
        {placeholder}
      </span>
    );
  }

  const pretty = formatPhone(number);

  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)} {...props}>
      {copyable ? (
        <button
          type="button"
          onClick={() => void copy()}
          className={cn(
            't-data group inline-flex items-center gap-1.5 rounded-control text-ink',
            'hover:text-money-ink focus-visible:outline-none'
          )}
          // The accessible name has to say what the button does, not just
          // repeat the number the sighted user is already reading.
          aria-label={copied ? `Copied ${pretty}` : `Copy ${pretty}`}
        >
          <span className="tabular">{pretty}</span>
          {copied ? (
            <Check aria-hidden className="h-3 w-3 shrink-0 text-live" />
          ) : (
            <Copy
              aria-hidden
              className="h-3 w-3 shrink-0 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
            />
          )}
        </button>
      ) : (
        <span className="t-data tabular text-ink">{pretty}</span>
      )}

      {status ? <StatusChip size="sm" value={status.value} enumName={status.enumName} /> : null}

      {/* Announce the copy to screen readers without moving anything. */}
      <span aria-live="polite" className="sr-only">
        {copied ? 'Copied to clipboard' : ''}
      </span>
    </div>
  );
}
