'use client';

/**
 * An added condition or medication: a row in its list, with its own
 * questions opening directly under it -- never somewhere else in the column.
 * Shared so Health and Medications read, and are worked, the same way.
 */

import { Check, ChevronDown, X } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

import { FOCUS } from '../parts';

/** One added condition or medication: its state on two lines, open and remove. */
export function ItemRow({
  status,
  title,
  capitalize,
  line,
  action,
  onOpen,
  removeLabel,
  onRemove,
  flash,
  open = false,
  editor,
  children,
}: {
  status: 'complete' | 'attention';
  title: string;
  capitalize?: boolean;
  /** What was answered, or what is still needed. */
  line: React.ReactNode;
  /** The open button's verb: "Edit", "Answer". */
  action: string;
  onOpen: () => void;
  removeLabel: string;
  onRemove: () => void;
  /** Just added or answered: marked for a moment so the eye finds it. */
  flash?: boolean;
  /** Its questions are open, under the row. */
  open?: boolean;
  /** The questions, shown under the row while `open`. */
  editor?: React.ReactNode;
  /** Below the row: an inline answer that needs no editor (a medication's use). */
  children?: React.ReactNode;
}): JSX.Element {
  return (
    <li
      className={cn(
        'min-w-0 transition-colors duration-500 ne-motion',
        open
          ? 'bg-surface shadow-[inset_3px_0_0_var(--brand-strong)]'
          : flash
            ? 'bg-brand-tint'
            : status === 'attention'
              ? 'bg-[color-mix(in_srgb,var(--ringing-tint)_45%,var(--surface))]'
              : 'bg-surface'
      )}
    >
      <div className="flex items-center gap-1 pl-2.5 pr-1">
        <button
          type="button"
          onClick={onOpen}
          aria-expanded={open}
          className={cn(
            'group flex min-w-0 flex-1 items-start gap-2 rounded-[6px] py-2 text-left',
            FOCUS
          )}
        >
          <span className="mt-[1px] shrink-0">
            {status === 'attention' ? (
              <span
                aria-hidden
                className="flex h-4 w-4 items-center justify-center rounded-full bg-ringing text-[10px] font-bold text-white"
              >
                !
              </span>
            ) : (
              <span
                aria-hidden
                className="flex h-4 w-4 items-center justify-center rounded-full bg-live text-white"
              >
                <Check className="h-2.5 w-2.5" strokeWidth={3.5} />
              </span>
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span
              className={cn(
                'block truncate text-[13.5px] font-semibold leading-[18px] text-ink',
                capitalize && 'capitalize'
              )}
            >
              {title}
            </span>
            <span
              className={cn(
                'block text-[12px] leading-[17px]',
                status === 'attention' ? 'font-medium text-ringing-ink' : 'text-ink-2'
              )}
            >
              {line}
            </span>
          </span>
          <span
            className={cn(
              'mt-[1px] flex shrink-0 items-center text-[12px] font-semibold',
              status === 'attention'
                ? 'text-ringing-ink'
                : 'text-brand-ink opacity-70 group-hover:opacity-100'
            )}
          >
            {open ? 'Close' : action}
            <ChevronDown className={cn('ml-0.5 h-3.5 w-3.5', open && 'rotate-180')} aria-hidden />
          </span>
        </button>
        <button
          type="button"
          aria-label={removeLabel}
          onClick={onRemove}
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-ink-3 hover:bg-sunken hover:text-dropped-ink',
            FOCUS
          )}
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      {children}
      {open && editor ? <div className="px-3 pb-3 pt-1">{editor}</div> : null}
    </li>
  );
}
