'use client';

import {
  FEEDBACK_MAIN_PATH,
  FEEDBACK_TIMELINE_LABELS,
  feedbackProgress,
  type FeedbackStatus,
} from '@hopwhistle/shared';
import { Check, Loader2, Plus } from 'lucide-react';
import * as React from 'react';

import {
  STATUS_CHIP_CLASS,
  STATUS_DOT_CLASS,
  shortDate,
  statusLabel,
} from '@/lib/product-feedback';
import { cn } from '@/lib/utils';

/** A request's status, in the product's chip shape. */
export function FeedbackStatusChip({
  status,
  staff = false,
  className,
}: {
  status: FeedbackStatus;
  staff?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-[22px] max-w-full shrink-0 items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-full px-2.5 text-[12px] font-medium',
        STATUS_CHIP_CLASS[status],
        className
      )}
      data-status={status}
    >
      <span
        aria-hidden
        className={cn('h-1.5 w-1.5 shrink-0 rounded-full', STATUS_DOT_CLASS[status])}
      />
      <span className="truncate">{statusLabel(status, staff)}</span>
    </span>
  );
}

/**
 * How far along the road from submitted to shipped: five segments, filled to
 * the current stage. Nothing is drawn for a request that is off the road --
 * waiting on its submitter, not planned, merged.
 */
export function StageTrack({ status, className }: { status: FeedbackStatus; className?: string }) {
  const progress = feedbackProgress(status);
  if (progress === null) return null;
  const steps = FEEDBACK_MAIN_PATH.length - 1;
  const filled = Math.round(progress * steps);
  return (
    <span
      className={cn('inline-flex shrink-0 items-center gap-0.5', className)}
      role="img"
      aria-label={`Stage ${filled} of ${steps}`}
    >
      {Array.from({ length: steps }, (_, i) => (
        <span
          key={i}
          className={cn(
            'h-1.5 w-4 rounded-full',
            i < filled ? (status === 'SHIPPED' ? 'bg-live' : 'bg-brand') : 'bg-rule'
          )}
        />
      ))}
    </span>
  );
}

/**
 * "I want this too". One press, one person: there is no down, and the count is
 * a signal to the product team rather than a score.
 */
export function InterestButton({
  interested,
  count,
  isMine,
  disabled,
  busy,
  onToggle,
  size = 'sm',
}: {
  interested: boolean;
  count: number;
  isMine: boolean;
  disabled?: boolean;
  busy?: boolean;
  onToggle: () => void;
  size?: 'sm' | 'md';
}) {
  if (isMine) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap t-meta text-ink-3">
        Your request
      </span>
    );
  }
  return (
    <button
      type="button"
      aria-pressed={interested}
      disabled={disabled || busy}
      onClick={event => {
        event.stopPropagation();
        onToggle();
      }}
      title={
        interested
          ? 'You want this. Press to take it back.'
          : 'Tell the product team you want this too'
      }
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-control border font-medium transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60',
        size === 'sm' ? 'h-7 px-2.5 text-[12px]' : 'h-9 px-3.5 text-sm',
        interested
          ? 'border-brand-ink/30 bg-brand-tint text-brand-ink hover:bg-brand-tint/70'
          : 'border-rule-strong bg-surface text-ink-2 hover:border-ink-3 hover:text-ink'
      )}
      data-interest={interested ? 'on' : 'off'}
      data-count={count}
    >
      {busy ? (
        <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
      ) : interested ? (
        <Check aria-hidden className="h-3.5 w-3.5" />
      ) : (
        <Plus aria-hidden className="h-3.5 w-3.5" />
      )}
      {interested ? 'You want this' : 'I want this too'}
    </button>
  );
}

/** A small "New update" marker for something the reader has not opened yet. */
export function UnreadMarker({ label = 'New update' }: { label?: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-tint px-2 py-px text-[11.5px] font-medium text-brand-ink">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-brand" />
      {label}
    </span>
  );
}

interface TimelineStep {
  status: FeedbackStatus;
  at: string | null;
  state: 'done' | 'current' | 'future';
}

/**
 * The stages a request has actually reached, in order, with their dates --
 * then, while it is still on the road to release, the stages it has not
 * reached yet, drawn hollow. A stage that did not happen is never drawn done.
 */
export function buildTimeline(
  events: Array<{ status: FeedbackStatus; at: string }>,
  current: FeedbackStatus
): TimelineStep[] {
  const steps: TimelineStep[] = [];
  for (const event of events) {
    if (steps.length > 0 && steps[steps.length - 1].status === event.status) continue;
    steps.push({ status: event.status, at: event.at, state: 'done' });
  }
  if (steps.length > 0) steps[steps.length - 1].state = 'current';

  if (current === 'NOT_PLANNED' || current === 'MERGED' || current === 'SHIPPED') return steps;
  let reached = Math.max(-1, ...steps.map(step => FEEDBACK_MAIN_PATH.indexOf(step.status)));
  // Waiting on the submitter or being weighed up: the rest of the road starts
  // after review.
  if (current === 'NEEDS_INFO' || current === 'CONSIDERING') {
    reached = Math.max(reached, FEEDBACK_MAIN_PATH.indexOf('UNDER_REVIEW'));
  }
  for (const status of FEEDBACK_MAIN_PATH.slice(reached + 1)) {
    steps.push({ status, at: null, state: 'future' });
  }
  return steps;
}

export function StatusTimeline({
  events,
  current,
}: {
  events: Array<{ status: FeedbackStatus; at: string }>;
  current: FeedbackStatus;
}) {
  const steps = buildTimeline(events, current);
  return (
    <ol className="relative" aria-label="Progress">
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        const shipped = step.status === 'SHIPPED' && step.state !== 'future';
        return (
          <li
            key={`${step.status}-${index}`}
            className="relative flex gap-3 pb-3 last:pb-0"
            data-step={step.status}
            data-state={step.state}
          >
            {!last ? (
              <span
                aria-hidden
                className={cn(
                  'absolute left-[7px] top-4 h-[calc(100%-12px)] w-px',
                  step.state === 'future' || steps[index + 1]?.state === 'future'
                    ? 'border-l border-dashed border-rule-strong bg-transparent'
                    : 'bg-brand/50'
                )}
              />
            ) : null}
            <span
              aria-hidden
              className={cn(
                'relative z-10 mt-0.5 flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full border-2',
                step.state === 'future'
                  ? 'border-rule-strong bg-surface'
                  : shipped
                    ? 'border-live bg-live'
                    : step.state === 'current'
                      ? 'border-brand bg-surface ring-4 ring-brand-tint'
                      : 'border-brand bg-brand'
              )}
            >
              {shipped ? <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} /> : null}
            </span>
            <div className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
              <span
                className={cn(
                  't-body',
                  step.state === 'future' ? 'text-ink-3' : 'text-ink',
                  step.state === 'current' && 'font-medium'
                )}
              >
                {FEEDBACK_TIMELINE_LABELS[step.status]}
              </span>
              {step.at ? (
                <span className="shrink-0 t-meta tabular-nums text-ink-3">
                  {shortDate(step.at)}
                </span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** A request's skeleton row while the list loads. */
export function FeedbackRowSkeleton() {
  return (
    <div className="flex items-start gap-4 px-5 py-4" aria-hidden>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="h-4 w-3/5 animate-pulse rounded bg-sunken" />
        <div className="h-3 w-2/5 animate-pulse rounded bg-sunken" />
        <div className="h-3 w-4/5 animate-pulse rounded bg-sunken" />
      </div>
      <div className="h-7 w-28 animate-pulse rounded-control bg-sunken" />
    </div>
  );
}

export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}
