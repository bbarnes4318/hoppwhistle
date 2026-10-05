'use client';

/**
 * The live call, pinned over the quoter, so the agent never has to leave the
 * quote to mute, hold or hang up. Hidden when there is no call.
 */

import { Mic, MicOff, Pause, PhoneOff, Play } from 'lucide-react';

import { usePhone } from '@/components/phone/phone-provider';
import {
  formatCallTimer,
  formatPhoneNumber,
  knownCallerName,
} from '@/components/phone/softphone/format';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function CallStrip({ className }: { className?: string }): JSX.Element | null {
  const { currentCall, toggleMute, toggleHold, hangupCall } = usePhone();
  if (!currentCall || currentCall.state === 'ended' || currentCall.state === 'idle') return null;

  const onHold = currentCall.isOnHold;
  const name =
    knownCallerName(currentCall.callerName) ?? formatPhoneNumber(currentCall.phoneNumber);
  const live = currentCall.state === 'active' || currentCall.state === 'hold';

  return (
    <div
      role="region"
      aria-label="Live call"
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-rule px-4 py-2',
        onHold ? 'bg-ringing-tint' : 'bg-surface',
        className
      )}
    >
      <span
        aria-hidden
        className={cn(
          'h-2 w-2 shrink-0 rounded-full',
          onHold ? 'bg-ringing' : live ? 'bg-live' : 'bg-ringing',
          live && !onHold && 'motion-safe:animate-pulse'
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{name || 'Unknown caller'}</p>
        <p className="t-meta tabular-nums text-ink-2">
          {onHold ? 'On hold · ' : ''}
          {formatCallTimer(currentCall.duration)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          size="sm"
          variant="outline"
          aria-pressed={currentCall.isMuted}
          onClick={toggleMute}
          disabled={!live}
        >
          {currentCall.isMuted ? (
            <MicOff className="mr-1.5 h-4 w-4" aria-hidden />
          ) : (
            <Mic className="mr-1.5 h-4 w-4" aria-hidden />
          )}
          {currentCall.isMuted ? 'Unmute' : 'Mute'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          aria-pressed={onHold}
          onClick={() => void toggleHold()}
          disabled={!live}
        >
          {onHold ? (
            <Play className="mr-1.5 h-4 w-4" aria-hidden />
          ) : (
            <Pause className="mr-1.5 h-4 w-4" aria-hidden />
          )}
          {onHold ? 'Resume' : 'Hold'}
        </Button>
        <Button size="sm" variant="destructive" onClick={() => void hangupCall()}>
          <PhoneOff className="mr-1.5 h-4 w-4" aria-hidden />
          Hang up
        </Button>
      </div>
    </div>
  );
}
