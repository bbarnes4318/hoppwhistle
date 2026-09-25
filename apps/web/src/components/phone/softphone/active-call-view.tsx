import {
  Grid3x3,
  MapPin,
  Merge,
  Mic,
  MicOff,
  Pause,
  PhoneForwarded,
  PhoneOff,
  Play,
  Tag,
  UserPlus,
} from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

import { formatCallTimer, formatPhoneNumber } from './format';
import { CallerAvatar, FOCUS_RING, ON_SIGNAL, PRESS, TOUCH_TARGET } from './parts';

/**
 * A call in progress, connected or on hold.
 *
 * The timer is the largest thing on the card because it is what an agent
 * glances at. One row of five equal controls sits under the caller, labelled,
 * with Mute and Hold filled while they are on so their state is visible
 * without reading the label. Hang up is on its own, wider and red, so it is
 * never the button next to the one you meant.
 *
 * On hold the whole card takes the ringing tint and the timer counts the hold,
 * because "how long have I had them waiting" is the question on hold.
 */
export interface ActiveCallViewProps {
  callerName: string | null;
  phoneNumber: string;
  source?: string | null;
  location?: string | null;
  /** Talk time, from the answer. */
  callSeconds: number;
  /** Placed but not yet answered. */
  dialing?: boolean;
  isMuted: boolean;
  isOnHold: boolean;
  holdSeconds?: number;
  keypadOpen: boolean;
  hasHeldCalls?: boolean;
  onMute: () => void;
  onHold: () => void;
  onKeypad: () => void;
  onTransfer: () => void;
  onAddCall: () => void;
  onMerge?: () => void;
  onHangup: () => void;
  /** The in-call keypad, shown when `keypadOpen`. */
  keypad?: React.ReactNode;
  /** Prospect details under the controls. */
  children?: React.ReactNode;
}

export function ActiveCallView({
  callerName,
  phoneNumber,
  source,
  location,
  callSeconds,
  dialing = false,
  isMuted,
  isOnHold,
  holdSeconds = 0,
  keypadOpen,
  hasHeldCalls = false,
  onMute,
  onHold,
  onKeypad,
  onTransfer,
  onAddCall,
  onMerge,
  onHangup,
  keypad,
  children,
}: ActiveCallViewProps): JSX.Element {
  const number = formatPhoneNumber(phoneNumber) || 'Unknown number';
  const tone = isOnHold ? 'ringing' : 'live';

  return (
    <div
      className={cn(
        'flex flex-col transition-colors duration-200 ease-out ne-motion',
        isOnHold ? 'bg-ringing-tint' : 'bg-surface'
      )}
    >
      <div className="flex items-center gap-3 px-4 pb-2 pt-4">
        <CallerAvatar name={callerName} tone={tone} />
        <div className="min-w-0 flex-1">
          <p className="t-section truncate text-ink">{callerName ?? number}</p>
          {callerName ? <p className="t-data truncate text-ink-2">{number}</p> : null}
          {source || location ? (
            <p className="t-meta mt-0.5 flex min-w-0 items-center gap-2 text-ink-3">
              {source ? (
                <span className="inline-flex min-w-0 items-center gap-1">
                  <Tag className="h-3 w-3 shrink-0" aria-hidden />
                  <span className="truncate">{source}</span>
                </span>
              ) : null}
              {location ? (
                <span className="inline-flex shrink-0 items-center gap-1">
                  <MapPin className="h-3 w-3" aria-hidden />
                  {location}
                </span>
              ) : null}
            </p>
          ) : null}
        </div>
      </div>

      <div className="px-4 pb-4 pt-2 text-center" aria-live="off">
        {isOnHold ? (
          <>
            <p className="t-label inline-flex items-center gap-1.5 text-ringing-ink">
              <Pause className="h-3.5 w-3.5" aria-hidden />
              On hold
            </p>
            <p
              className="mt-1 text-[44px] font-semibold leading-none tracking-tight tabular-nums text-ringing-ink"
              role="timer"
              aria-label={`On hold for ${formatCallTimer(holdSeconds)}`}
            >
              {formatCallTimer(holdSeconds)}
            </p>
            <p className="t-meta mt-1.5 tabular-nums text-ink-2">
              Call time {formatCallTimer(callSeconds)}
            </p>
          </>
        ) : dialing ? (
          <>
            <p className="t-label text-ink-3">Calling</p>
            <p className="mt-1 text-[44px] font-semibold leading-none tracking-tight text-ink-3">
              <span className="animate-pulse motion-reduce:animate-none">···</span>
            </p>
            <p className="t-meta mt-1.5 text-ink-3">Waiting for them to pick up</p>
          </>
        ) : (
          <>
            <p className="t-label text-live-ink">Connected</p>
            <p
              className="mt-1 text-[44px] font-semibold leading-none tracking-tight tabular-nums text-ink"
              role="timer"
              aria-label={`Call time ${formatCallTimer(callSeconds)}`}
            >
              {formatCallTimer(callSeconds)}
            </p>
            {isMuted ? (
              <p className="t-meta mt-1.5 inline-flex items-center gap-1 font-medium text-ink-2">
                <MicOff className="h-3.5 w-3.5" aria-hidden />
                They cannot hear you
              </p>
            ) : (
              // Holds the line's height so muting does not shift the controls.
              <span className="mt-1.5 block h-[17px]" aria-hidden />
            )}
          </>
        )}
      </div>

      <div className="grid grid-cols-5 gap-1.5 px-3">
        <ControlButton
          label={isMuted ? 'Unmute' : 'Mute'}
          shortcut="M"
          active={isMuted}
          activeClass="bg-ink text-surface border-ink"
          onClick={onMute}
          disabled={dialing}
        >
          {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
        </ControlButton>
        <ControlButton
          label={isOnHold ? 'Resume' : 'Hold'}
          shortcut="H"
          active={isOnHold}
          activeClass={cn('bg-ringing border-ringing', ON_SIGNAL)}
          onClick={onHold}
          disabled={dialing}
        >
          {isOnHold ? <Play className="h-5 w-5" /> : <Pause className="h-5 w-5" />}
        </ControlButton>
        <ControlButton
          label="Keypad"
          shortcut="K"
          active={keypadOpen}
          activeClass="bg-ink text-surface border-ink"
          onClick={onKeypad}
        >
          <Grid3x3 className="h-5 w-5" />
        </ControlButton>
        <ControlButton label="Transfer" onClick={onTransfer} disabled={dialing}>
          <PhoneForwarded className="h-5 w-5" />
        </ControlButton>
        <ControlButton label="Add call" onClick={onAddCall} disabled={dialing}>
          <UserPlus className="h-5 w-5" />
        </ControlButton>
      </div>

      {keypadOpen && keypad ? (
        <div className="px-4 pt-4 animate-in fade-in-0 slide-in-from-top-1 duration-150 motion-reduce:animate-none">
          {keypad}
        </div>
      ) : null}

      <div className="space-y-2 px-4 pb-4 pt-4">
        {hasHeldCalls && onMerge ? (
          <button
            type="button"
            onClick={onMerge}
            className={cn(
              'inline-flex h-11 w-full items-center justify-center gap-2 rounded-card border border-rule-strong bg-surface text-sm font-semibold text-ink hover:bg-sunken',
              PRESS,
              FOCUS_RING,
              TOUCH_TARGET
            )}
          >
            <Merge className="h-4 w-4" aria-hidden />
            Merge calls
          </button>
        ) : null}
        <button
          type="button"
          onClick={onHangup}
          aria-label="Hang up"
          className={cn(
            'inline-flex h-14 w-full items-center justify-center gap-2 rounded-card text-base font-semibold',
            'bg-dropped hover:bg-dropped-ink',
            ON_SIGNAL,
            PRESS,
            FOCUS_RING,
            TOUCH_TARGET
          )}
        >
          <PhoneOff className="h-5 w-5" aria-hidden />
          Hang up
        </button>
      </div>

      {children ? <div className="px-4 pb-4">{children}</div> : null}
    </div>
  );
}

function ControlButton({
  label,
  shortcut,
  active = false,
  activeClass,
  disabled,
  onClick,
  children,
}: {
  label: string;
  shortcut?: string;
  active?: boolean;
  activeClass?: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={activeClass ? active : undefined}
      aria-keyshortcuts={shortcut}
      title={shortcut ? `${label} (${shortcut})` : label}
      className={cn(
        'group flex min-w-0 flex-col items-center gap-1.5 rounded-card py-1',
        'disabled:cursor-not-allowed disabled:opacity-50',
        FOCUS_RING
      )}
    >
      <span
        className={cn(
          'flex h-12 w-12 items-center justify-center rounded-full border',
          active && activeClass
            ? activeClass
            : 'border-rule-strong bg-surface text-ink group-enabled:group-hover:bg-sunken',
          PRESS,
          'group-active:scale-[0.94] motion-reduce:group-active:scale-100'
        )}
        aria-hidden
      >
        {children}
      </span>
      <span className="w-full truncate text-center text-xs font-medium text-ink-2" aria-hidden>
        {label}
      </span>
    </button>
  );
}
