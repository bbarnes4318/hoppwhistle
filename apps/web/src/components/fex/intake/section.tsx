'use client';

/**
 * One block of the quote intake: a status mark, the title, what it holds or
 * needs ("1 to review", "2 conditions"), an optional control at the right
 * (Coverage's Face amount / Monthly budget switch), and its fields.
 *
 * Always open. The intake is a live sales workflow, not a settings panel: an
 * agent on a call should never have to open a box to change an answer, so
 * every field is on screen and the blocks are separated by a hairline, not
 * nested cards.
 */

import { Check } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * complete  -- answered; nothing changes the quote by being asked again.
 * attention -- quotes, but something here is unanswered and the engine assumes.
 * required  -- the quote cannot run until this is answered.
 * empty     -- optional, and nothing added (no conditions, no medications).
 */
export type SectionStatus = 'complete' | 'attention' | 'required' | 'empty';

export const STATUS_WORD: Record<SectionStatus, string> = {
  complete: 'Complete',
  attention: 'Needs review',
  required: 'Required',
  empty: 'None added',
};

export function StatusMark({
  status,
  className,
}: {
  status: SectionStatus;
  className?: string;
}): JSX.Element {
  return (
    <span
      aria-hidden
      className={cn(
        'flex h-4 w-4 shrink-0 items-center justify-center rounded-full',
        status === 'complete' && 'bg-live text-white',
        status === 'attention' && 'bg-ringing text-white',
        status === 'required' && 'border-[1.5px] border-ringing text-ringing-ink',
        status === 'empty' && 'border-[1.5px] border-rule-strong',
        className
      )}
    >
      {status === 'complete' ? <Check className="h-2.5 w-2.5" strokeWidth={3.5} /> : null}
      {status === 'attention' ? (
        <span className="text-[10px] font-bold leading-none">!</span>
      ) : null}
    </span>
  );
}

export interface IntakeBlockProps {
  id: string;
  title: string;
  status: SectionStatus;
  /** Right of the title: "2 conditions", "1 to review". */
  meta?: React.ReactNode;
  metaTone?: 'quiet' | 'attention';
  /** A control in the title row (a mode switch). */
  action?: React.ReactNode;
  children: React.ReactNode;
}

export function IntakeBlock({
  id,
  title,
  status,
  meta,
  metaTone = 'quiet',
  action,
  children,
}: IntakeBlockProps): JSX.Element {
  const headingId = `${id}-heading`;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      data-intake-section={id}
      data-status={status}
      className="min-w-0 scroll-mt-2 px-4 pb-3.5 pt-2.5"
    >
      <div className="mb-2 flex min-h-[28px] items-center gap-2">
        <StatusMark status={status} />
        <h3 id={headingId} className="text-[12px] font-bold uppercase tracking-[0.08em] text-ink">
          {title}
        </h3>
        <span className="sr-only">
          {STATUS_WORD[status]}
          {typeof meta === 'string' ? `, ${meta}` : ''}
        </span>
        {meta ? (
          <span
            aria-hidden
            className={cn(
              'truncate text-[12px]',
              metaTone === 'attention' ? 'font-semibold text-ringing-ink' : 'text-ink-3'
            )}
          >
            {meta}
          </span>
        ) : null}
        {action ? <span className="ml-auto shrink-0">{action}</span> : null}
      </div>
      {children}
    </section>
  );
}
