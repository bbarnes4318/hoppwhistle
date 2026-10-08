/**
 * The read-only way a record is shown: a label, its value, and an honest
 * "Not entered" when there is none -- type and spacing doing the work that
 * bordered inputs did before.
 */

import * as React from 'react';

import { cn } from '@/lib/utils';

export function ReadList({
  className,
  columns = 1,
  children,
}: {
  className?: string;
  /** Pairs per row on a wide screen. */
  columns?: 1 | 2;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <dl
      className={cn(
        'grid gap-x-8',
        columns === 2 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1',
        className
      )}
    >
      {children}
    </dl>
  );
}

export function ReadField({
  label,
  children,
  wide = false,
  mono = false,
  labelWidth = 'md',
  stacked = false,
}: {
  label: string;
  /** Null, undefined or empty reads "Not entered". */
  children?: React.ReactNode;
  /** Spans both columns of a two-column list. */
  wide?: boolean;
  mono?: boolean;
  labelWidth?: 'sm' | 'md';
  /** Label above the value: for a two-column grid in a narrow card. */
  stacked?: boolean;
}): JSX.Element {
  const empty = children === null || children === undefined || children === '';
  if (stacked) {
    return (
      <div className={cn('min-w-0 py-2', wide && 'md:col-span-2')}>
        <dt className="text-[12.5px] text-ink-3">{label}</dt>
        <dd
          className={cn(
            'mt-0.5 min-w-0 break-words text-[14px] leading-5',
            empty ? 'text-ink-3' : 'text-ink',
            mono && !empty && 'font-mono text-[13px]'
          )}
        >
          {empty ? 'Not entered' : children}
        </dd>
      </div>
    );
  }
  return (
    <div
      className={cn(
        'grid min-w-0 items-baseline gap-x-4 py-[7px]',
        labelWidth === 'sm' ? 'grid-cols-[104px_minmax(0,1fr)]' : 'grid-cols-[148px_minmax(0,1fr)]',
        wide && 'md:col-span-2'
      )}
    >
      <dt className="text-[13px] text-ink-3">{label}</dt>
      <dd
        className={cn(
          'min-w-0 break-words text-[14px] leading-5',
          empty ? 'text-ink-3' : 'text-ink',
          mono && !empty && 'font-mono text-[13px]'
        )}
      >
        {empty ? 'Not entered' : children}
      </dd>
    </div>
  );
}
