import { MapPin, Phone, PhoneOff, Tag } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

import { formatCallTimer, formatPhoneNumber } from './format';
import { CallerAvatar, FOCUS_RING, Kbd, ON_SIGNAL, PRESS, TOUCH_TARGET } from './parts';

/**
 * A ringing call. Who it is, where it came from, and two buttons big enough
 * to hit without looking: Answer in the live colour, Decline in dropped, side
 * by side across the bottom.
 */
export interface IncomingCallViewProps {
  /** Null when the caller is not known; the number then leads. */
  callerName: string | null;
  phoneNumber: string;
  /** The queue or campaign the call arrived through. */
  source?: string | null;
  /** "Tampa, FL", from the prospect match. */
  location?: string | null;
  ringSeconds: number;
  onAnswer: () => void;
  onDecline: () => void;
  /** Prospect details under the caller block. */
  children?: React.ReactNode;
}

export function IncomingCallView({
  callerName,
  phoneNumber,
  source,
  location,
  ringSeconds,
  onAnswer,
  onDecline,
  children,
}: IncomingCallViewProps): JSX.Element {
  const number = formatPhoneNumber(phoneNumber) || 'Unknown number';

  return (
    <div className="flex flex-col animate-in fade-in-0 duration-200 motion-reduce:animate-none">
      <div className="flex flex-col items-center px-5 pb-4 pt-6 text-center">
        <div className="relative rounded-full">
          <span className="sp-ring" aria-hidden />
          <CallerAvatar name={callerName} tone="ringing" size="lg" />
        </div>

        <p className="t-title mt-4 max-w-full break-words text-ink">{callerName ?? number}</p>
        {callerName ? <p className="t-data mt-0.5 text-[15px] text-ink-2">{number}</p> : null}

        <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
          {source ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-sunken px-2.5 py-1 text-xs font-medium text-ink-2">
              <Tag className="h-3 w-3" aria-hidden />
              <span className="sr-only">From </span>
              {source}
            </span>
          ) : null}
          {location ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-sunken px-2.5 py-1 text-xs font-medium text-ink-2">
              <MapPin className="h-3 w-3" aria-hidden />
              {location}
            </span>
          ) : null}
        </div>

        <p className="t-meta mt-3 tabular-nums text-ink-3">
          Ringing{' '}
          <span className="font-semibold text-ringing-ink">{formatCallTimer(ringSeconds)}</span>
        </p>
      </div>

      {children ? <div className="px-4 pb-4">{children}</div> : null}

      <div className="sticky bottom-0 mt-auto border-t border-rule bg-surface px-4 pb-4 pt-3">
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onDecline}
            aria-label="Decline call"
            aria-keyshortcuts="D"
            className={cn(
              'inline-flex h-14 items-center justify-center gap-2 rounded-card text-base font-semibold',
              'bg-dropped hover:bg-dropped-ink',
              ON_SIGNAL,
              PRESS,
              FOCUS_RING,
              TOUCH_TARGET
            )}
          >
            <PhoneOff className="h-5 w-5" aria-hidden />
            Decline
          </button>
          <button
            type="button"
            onClick={onAnswer}
            aria-label="Answer call"
            aria-keyshortcuts="A"
            className={cn(
              'inline-flex h-14 items-center justify-center gap-2 rounded-card text-base font-semibold',
              'bg-live hover:bg-live-deep',
              ON_SIGNAL,
              PRESS,
              FOCUS_RING,
              TOUCH_TARGET
            )}
          >
            <Phone className="h-5 w-5" aria-hidden />
            Answer
          </button>
        </div>
        <p className="t-meta mt-2.5 hidden items-center justify-center gap-1.5 text-ink-3 [@media(pointer:fine)]:flex">
          <Kbd>A</Kbd> answer <span aria-hidden>·</span> <Kbd>D</Kbd> decline
        </p>
      </div>
    </div>
  );
}
