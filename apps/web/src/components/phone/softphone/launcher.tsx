import { Phone, PhoneIncoming, PhoneOff, RefreshCw } from 'lucide-react';

import { cn } from '@/lib/utils';

import { formatCallTimer, SOFTPHONE_STATE_META, type SoftphoneState } from './format';
import { FOCUS_RING, PRESS, SoftphoneMotion, StateDot, TOUCH_TARGET } from './parts';

/**
 * The collapsed softphone: the one piece of it that is on screen at all
 * times, so it has to say what the phone is doing without being opened.
 *
 * It shows the state dot, the agent's status and, on a call, the running
 * timer. Ringing gets a ring that pulses out from the whole pill rather than a
 * pinging dot — a dot is easy to miss at the corner of a wide screen.
 *
 * Offline reads in the dropped colour and its label says so; an agent whose
 * phone never registered used to see a healthy green "Available" here.
 */
export interface SoftphoneLauncherProps {
  state: SoftphoneState;
  /** The agent's own status, e.g. "Available", "Away". */
  statusLabel: string;
  /** Seconds on the current call, shown when connected or held. */
  callSeconds?: number;
  /** Retry attempts so far, for "Reconnecting (3)". */
  attempts?: number;
  /** True when the phone has given up and a click should reconnect it. */
  failed?: boolean;
  onOpen: () => void;
  onReconnect?: () => void;
  /** `inline` renders in flow, for /design-preview. */
  placement?: 'floating' | 'inline';
}

export function SoftphoneLauncher({
  state,
  statusLabel,
  callSeconds = 0,
  attempts = 0,
  failed = false,
  onOpen,
  onReconnect,
  placement = 'floating',
}: SoftphoneLauncherProps): JSX.Element {
  const meta = SOFTPHONE_STATE_META[state];
  const onCall = state === 'connected' || state === 'hold';

  let label: string;
  let Icon = Phone;
  if (state === 'incoming') {
    label = 'Incoming call';
    Icon = PhoneIncoming;
  } else if (onCall) {
    label = state === 'hold' ? 'On hold' : 'On a call';
  } else if (state === 'offline' && failed) {
    label = 'Phone offline — reconnect';
    Icon = PhoneOff;
  } else if (state === 'offline') {
    label = 'Offline';
    Icon = PhoneOff;
  } else if (state === 'connecting') {
    label = attempts > 1 ? `Reconnecting (${attempts})` : 'Connecting';
    Icon = RefreshCw;
  } else if (state === 'wrapup') {
    label = 'Wrap-up';
  } else {
    label = statusLabel;
  }

  const ground =
    state === 'offline'
      ? 'bg-dropped-tint text-dropped-ink border-dropped'
      : state === 'incoming'
        ? 'bg-ringing-tint text-ringing-ink border-ringing'
        : state === 'hold'
          ? 'bg-ringing-tint text-ringing-ink border-rule-strong'
          : state === 'connected'
            ? 'bg-live-tint text-live-ink border-rule-strong'
            : 'bg-surface text-ink border-rule-strong';

  const handleClick = failed && onReconnect ? onReconnect : onOpen;

  return (
    <>
      <SoftphoneMotion />
      <button
        type="button"
        onClick={handleClick}
        aria-label={
          failed
            ? 'Phone offline. Reconnect.'
            : `Open phone. ${meta.label}${onCall ? `, ${formatCallTimer(callSeconds)}` : ''}.`
        }
        className={cn(
          placement === 'floating'
            ? 'fixed bottom-4 right-4 z-50 sm:bottom-6 sm:right-6 animate-in fade-in-0 zoom-in-95 duration-200 motion-reduce:animate-none'
            : 'relative',
          'inline-flex h-12 items-center gap-2.5 rounded-full border pl-3 pr-4',
          'text-sm font-semibold shadow-pop',
          'hover:shadow-raised hover:brightness-[0.98]',
          ground,
          PRESS,
          FOCUS_RING,
          TOUCH_TARGET
        )}
      >
        {state === 'incoming' ? <span className="sp-ring" aria-hidden /> : null}
        <span
          className={cn(
            'inline-flex h-8 w-8 items-center justify-center rounded-full',
            state === 'offline'
              ? 'bg-dropped text-white dark:text-paper'
              : state === 'incoming'
                ? 'bg-ringing text-white dark:text-paper'
                : onCall
                  ? 'bg-surface text-ink'
                  : 'bg-brand-tint text-brand-ink'
          )}
          aria-hidden
        >
          <Icon
            className={cn(
              'h-4 w-4',
              state === 'connecting' && 'animate-spin motion-reduce:animate-none'
            )}
          />
        </span>
        <span className="whitespace-nowrap">{label}</span>
        {onCall ? (
          <span className="t-num text-[13px] font-semibold tabular-nums">
            {formatCallTimer(callSeconds)}
          </span>
        ) : null}
        <StateDot tone={meta.tone} pulse={state === 'incoming' || state === 'connected'} />
      </button>
    </>
  );
}
