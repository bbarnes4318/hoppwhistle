'use client';

/**
 * One section of the quote intake, in one of two states.
 *
 * Closed, it is its STATE: a status mark, the title, and one or two lines of
 * what was answered ("AL · Male · Age 65 · Non-tobacco"). Open, it is its
 * editor. Only one section is open at a time, so the column always shows all
 * four sections and never grows into a page: the open editor is the only
 * thing with height, and it opens where the agent clicked.
 */

import { AlertCircle, Check, ChevronRight } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

import { FOCUS } from '../parts';

/**
 * complete  -- answered; nothing changes the quote by being asked again.
 * attention -- quotes, but something here is unanswered and the engine assumes.
 * required  -- the quote cannot run until this is answered.
 * empty     -- optional, and nothing added (no conditions, no medications).
 */
export type SectionStatus = 'complete' | 'attention' | 'required' | 'empty';

const STATUS_WORD: Record<SectionStatus, string> = {
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
        'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full',
        status === 'complete' && 'bg-live text-white',
        status === 'attention' && 'bg-ringing text-white',
        status === 'required' && 'border-[1.5px] border-ringing text-ringing-ink',
        status === 'empty' && 'border-[1.5px] border-rule-strong',
        className
      )}
    >
      {status === 'complete' ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
      {status === 'attention' ? (
        <span className="text-[11px] font-bold leading-none">!</span>
      ) : null}
    </span>
  );
}

export interface IntakeSectionProps {
  id: string;
  title: string;
  status: SectionStatus;
  /** Right of the title: "2 conditions", "Needs state". */
  meta?: React.ReactNode;
  /** Tone for `meta`. */
  metaTone?: 'quiet' | 'attention';
  open: boolean;
  onOpen: () => void;
  /** Close it again from its title (the open editor folds back to its state). */
  onClose: () => void;
  /** Closed: what the section holds, as lines. May contain its own buttons. */
  summary: React.ReactNode;
  /** Open: the footer action ("Next: Coverage", "Done"). */
  next?: { label: string; onClick: () => void };
  children: React.ReactNode;
}

export function IntakeSection({
  id,
  title,
  status,
  meta,
  metaTone = 'quiet',
  open,
  onOpen,
  onClose,
  summary,
  next,
  children,
}: IntakeSectionProps): JSX.Element {
  const headingId = `${id}-heading`;
  const titleId = `${id}-title`;
  const stateId = `${id}-state`;
  const bodyId = `${id}-body`;
  return (
    <section
      aria-labelledby={headingId}
      data-intake-section={id}
      data-open={open || undefined}
      className={cn(
        'relative min-w-0',
        // The open section is the one being worked: a brand rule down its
        // edge, so where the agent is never needs looking for.
        open &&
          'bg-surface before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:rounded-r-full before:bg-brand-strong'
      )}
    >
      <div className="flex min-h-[44px] items-center gap-2 pl-4 pr-3">
        <h3 id={headingId} className="min-w-0 flex-1">
          <button
            type="button"
            // Named by its title alone; its state and meta are its description.
            aria-labelledby={titleId}
            aria-describedby={stateId}
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={open ? onClose : onOpen}
            className={cn(
              'flex w-full min-w-0 items-center gap-2.5 rounded-[6px] py-2 text-left',
              FOCUS
            )}
          >
            <StatusMark status={status} />
            <span id={titleId} className="text-[14px] font-semibold tracking-[-0.005em] text-ink">
              {title}
            </span>
            <span id={stateId} className="sr-only">
              {STATUS_WORD[status]}
              {typeof meta === 'string' ? `, ${meta}` : ''}
            </span>
            {meta && !(open && next) ? (
              <span
                aria-hidden
                className={cn(
                  'ml-auto truncate pl-2 text-[12px]',
                  metaTone === 'attention' ? 'font-medium text-ringing-ink' : 'text-ink-3'
                )}
              >
                {meta}
              </span>
            ) : null}
            {!open ? (
              <span
                aria-hidden
                className={cn(
                  'flex shrink-0 items-center text-[12px] font-medium text-brand-ink',
                  !meta && 'ml-auto'
                )}
              >
                Edit
                <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              </span>
            ) : null}
          </button>
        </h3>
        {open && next ? (
          // Where the agent goes next, in the title row: a footer row of its
          // own would be height the questions need.
          <button
            type="button"
            onClick={next.onClick}
            className={cn(
              '-mr-1 inline-flex h-7 shrink-0 items-center gap-0.5 rounded-control pl-2 pr-1 text-[12px] font-semibold text-brand-ink hover:bg-brand-tint',
              FOCUS
            )}
          >
            {next.label}
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </button>
        ) : null}
      </div>

      {open ? (
        <div id={bodyId} className="px-4 pb-3">
          {children}
        </div>
      ) : (
        // A mouse convenience: the whole closed section opens it. The header
        // button above is the keyboard and screen-reader control.
        <div
          id={bodyId}
          className="-mt-1.5 cursor-pointer pb-3 pl-[44px] pr-4"
          onClick={e => {
            if ((e.target as HTMLElement).closest('button, a, input, select')) return;
            onOpen();
          }}
        >
          {summary}
        </div>
      )}
    </section>
  );
}

/** A summary line that opens one item (a condition, a medication) directly. */
export function SummaryItem({
  status,
  onClick,
  title,
  detail,
  attention,
  capitalize,
}: {
  status: 'complete' | 'attention';
  onClick: () => void;
  title: string;
  detail?: string;
  attention?: string;
  capitalize?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex w-full min-w-0 items-center gap-1.5 rounded-[4px] py-[1px] text-left text-[12.5px] leading-[18px]',
        FOCUS
      )}
    >
      {status === 'attention' ? (
        <AlertCircle className="h-3.5 w-3.5 shrink-0 text-ringing-ink" aria-hidden />
      ) : (
        <Check className="h-3.5 w-3.5 shrink-0 text-live-ink" aria-hidden />
      )}
      <span className="min-w-0 truncate">
        <span
          className={cn('font-medium text-ink group-hover:underline', capitalize && 'capitalize')}
        >
          {title}
        </span>
        {attention ? (
          <span className="font-medium text-ringing-ink"> — {attention}</span>
        ) : detail ? (
          <span className="text-ink-2"> · {detail}</span>
        ) : null}
      </span>
    </button>
  );
}

/** A plain summary line. */
export function SummaryText({
  children,
  tone = 'ink',
}: {
  children: React.ReactNode;
  tone?: 'ink' | 'quiet' | 'attention';
}): JSX.Element {
  return (
    <p
      className={cn(
        'truncate text-[12.5px] leading-[18px] tabular-nums',
        tone === 'ink' && 'text-ink-2',
        tone === 'quiet' && 'text-ink-3',
        tone === 'attention' && 'font-medium text-ringing-ink'
      )}
    >
      {children}
    </p>
  );
}
