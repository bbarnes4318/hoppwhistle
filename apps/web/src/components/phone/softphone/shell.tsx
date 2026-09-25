import { ChevronDown, ChevronUp, Keyboard, Settings, X } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

import { formatCallTimer, SOFTPHONE_STATE_META, type SoftphoneState } from './format';
import {
  FOCUS_RING,
  SoftphoneMotion,
  StateDot,
  TONE_HEADER,
  TONE_TEXT,
  TOUCH_TARGET,
} from './parts';

/**
 * The open softphone's frame: a header coloured by state, an optional notice
 * strip, and a scrolling body.
 *
 * From 640px up it floats at the bottom right, 380px wide. Below that it is a
 * bottom sheet across the full width, because a 380px card on a 360px phone
 * is a card with no margins and a close button under the thumb.
 */
export interface SoftphoneShellProps {
  state: SoftphoneState;
  /** Overrides the state's own label, e.g. "Reconnecting (3)". */
  label?: string;
  /** The agent status and availability controls, under the state label. */
  statusSlot?: React.ReactNode;
  /** Shown in the header on a call, so it survives minimising. */
  callSeconds?: number;
  /** Notices between the header and the body. */
  notices?: React.ReactNode;
  minimized?: boolean;
  onToggleMinimized?: () => void;
  onClose: () => void;
  onSettings?: () => void;
  onShortcuts?: () => void;
  placement?: 'floating' | 'inline';
  /** Laid over header and body, e.g. the shortcuts sheet. */
  overlay?: React.ReactNode;
  children: React.ReactNode;
}

export function SoftphoneShell({
  state,
  label,
  statusSlot,
  callSeconds,
  notices,
  minimized = false,
  onToggleMinimized,
  onClose,
  onSettings,
  onShortcuts,
  placement = 'floating',
  overlay,
  children,
}: SoftphoneShellProps): JSX.Element {
  const meta = SOFTPHONE_STATE_META[state];
  const onCall = state === 'connected' || state === 'hold';
  const headingId = React.useId();

  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        'flex flex-col overflow-hidden border border-rule bg-surface text-ink shadow-pop',
        placement === 'floating'
          ? [
              'fixed inset-x-0 bottom-0 z-40 max-h-[92dvh] rounded-t-[20px]',
              'sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-[380px] sm:rounded-card',
              'sm:max-h-[min(720px,calc(100vh-32px))]',
              'animate-in fade-in-0 slide-in-from-bottom-4 duration-200 motion-reduce:animate-none',
            ]
          : 'relative w-full max-w-[380px] rounded-card'
      )}
    >
      <SoftphoneMotion />
      <header
        className={cn(
          'flex shrink-0 flex-col gap-1.5 px-4 pb-3 pt-3.5',
          'transition-[background-color,box-shadow] duration-200 ease-out ne-motion',
          TONE_HEADER[meta.tone]
        )}
      >
        {placement === 'floating' ? (
          // A grab handle, so the sheet reads as a sheet. Decorative: closing
          // is the X, not a swipe.
          <div className="-mt-1.5 mb-0.5 flex justify-center sm:hidden" aria-hidden>
            <span className="h-1 w-10 rounded-full bg-rule-strong" />
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          <StateDot tone={meta.tone} pulse={state === 'incoming' || state === 'connecting'} />
          <h2
            id={headingId}
            className={cn('t-section min-w-0 flex-1 truncate', TONE_TEXT[meta.tone])}
            aria-live="polite"
          >
            {label ?? meta.label}
          </h2>
          {onCall && callSeconds !== undefined && minimized ? (
            <span className={cn('t-num font-semibold tabular-nums', TONE_TEXT[meta.tone])}>
              {formatCallTimer(callSeconds)}
            </span>
          ) : null}
          <div className="-mr-2 flex items-center">
            {onShortcuts ? (
              <HeaderButton label="Keyboard shortcuts" onClick={onShortcuts} fineOnly>
                <Keyboard className="h-4 w-4" />
              </HeaderButton>
            ) : null}
            {onSettings ? (
              <HeaderButton label="Phone settings" onClick={onSettings}>
                <Settings className="h-4 w-4" />
              </HeaderButton>
            ) : null}
            {onToggleMinimized ? (
              <HeaderButton
                label={minimized ? 'Expand phone' : 'Minimise phone'}
                onClick={onToggleMinimized}
                expanded={!minimized}
              >
                {minimized ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </HeaderButton>
            ) : null}
            <HeaderButton label="Close phone" onClick={onClose}>
              <X className="h-4 w-4" />
            </HeaderButton>
          </div>
        </div>
        {statusSlot ? <div className="flex flex-wrap items-center gap-2">{statusSlot}</div> : null}
      </header>

      {!minimized ? (
        <>
          {notices ? <div className="shrink-0 space-y-2 px-3 pt-3">{notices}</div> : null}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        </>
      ) : null}
      {overlay}
    </section>
  );
}

function HeaderButton({
  label,
  onClick,
  expanded,
  fineOnly = false,
  children,
}: {
  label: string;
  onClick: () => void;
  expanded?: boolean;
  /** Only where there is a keyboard to use it with. */
  fineOnly?: boolean;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-expanded={expanded}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-control text-ink-2',
        'transition-colors duration-150 ease-out ne-motion hover:bg-surface hover:text-ink',
        FOCUS_RING,
        TOUCH_TARGET,
        fineOnly && '[@media(pointer:coarse)]:hidden'
      )}
    >
      {children}
    </button>
  );
}
