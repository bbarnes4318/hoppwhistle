'use client';

/**
 * The two shapes an added condition or medication takes: a row in its list,
 * and the bar its own questions open under. Shared so Health and Medications
 * read, and are worked, the same way.
 */

import { ArrowLeft, Check, ChevronRight, X } from 'lucide-react';
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
  /** Below the row: an inline answer that needs no editor (a medication's use). */
  children?: React.ReactNode;
}): JSX.Element {
  return (
    <li
      className={cn(
        'min-w-0 transition-colors duration-500 ne-motion',
        flash ? 'bg-brand-tint' : 'bg-surface'
      )}
    >
      <div className="flex items-center gap-1 pl-2.5 pr-1">
        <button
          type="button"
          onClick={onOpen}
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
                'block truncate text-[13.5px] font-medium leading-[18px] text-ink',
                capitalize && 'capitalize'
              )}
            >
              {title}
            </span>
            <span
              className={cn(
                'block truncate text-[12px] leading-[17px]',
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
            {action}
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
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
    </li>
  );
}

/** The breadcrumb bar every item editor opens with: back, where, and remove. */
export function EditorBar({
  backLabel,
  title,
  capitalize,
  onBack,
  removeLabel,
  onRemove,
}: {
  backLabel: string;
  title: string;
  capitalize?: boolean;
  onBack: () => void;
  removeLabel: string;
  onRemove: () => void;
}): JSX.Element {
  return (
    <div className="-mx-1 mb-2.5 flex items-center gap-1">
      <button
        type="button"
        onClick={onBack}
        aria-label={`Back to ${backLabel.toLowerCase()}`}
        className={cn(
          'inline-flex h-7 shrink-0 items-center gap-1 rounded-[6px] px-1.5 text-[12px] font-medium text-ink-2 hover:bg-sunken hover:text-ink',
          FOCUS
        )}
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        {backLabel}
      </button>
      <span aria-hidden className="text-ink-3">
        /
      </span>
      <h4
        className={cn(
          'min-w-0 flex-1 truncate px-1 text-[14px] font-semibold text-ink',
          capitalize && 'capitalize'
        )}
      >
        {title}
      </h4>
      <button
        type="button"
        onClick={onRemove}
        className={cn(
          'inline-flex h-7 shrink-0 items-center gap-1 rounded-[6px] px-1.5 text-[12px] font-medium text-ink-3 hover:bg-dropped-tint hover:text-dropped-ink',
          FOCUS
        )}
      >
        <X className="h-3.5 w-3.5" aria-hidden />
        {removeLabel}
      </button>
    </div>
  );
}
