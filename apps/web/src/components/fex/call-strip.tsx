'use client';

/**
 * The live call, pinned over the quoter, so the agent never has to leave the
 * quote to mute, hold, add someone or hang up. Hidden when there is no call.
 *
 * Adding a third party is inline rather than the softphone's AddCallDialog:
 * the quoter is a modal drawer, and anything drawn outside it (as that dialog
 * is) cannot be clicked or typed into while it is open.
 */

import { Merge, Mic, MicOff, Pause, PhoneOff, Play, UserPlus, X } from 'lucide-react';
import * as React from 'react';

import { usePhone } from '@/components/phone/phone-provider';
import {
  formatCallTimer,
  formatPhoneNumber,
  isDialing,
  knownCallerName,
  normalizeThirdPartyNumber,
} from '@/components/phone/softphone/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export function CallStrip({ className }: { className?: string }): JSX.Element | null {
  const {
    currentCall,
    toggleMute,
    toggleHold,
    hangupCall,
    addThirdParty,
    mergeCalls,
    hasHeldCalls,
  } = usePhone();
  const [adding, setAdding] = React.useState(false);
  const [number, setNumber] = React.useState('');
  const [touched, setTouched] = React.useState(false);

  if (!currentCall || currentCall.state === 'ended' || currentCall.state === 'idle') return null;

  const onHold = currentCall.isOnHold;
  const name =
    knownCallerName(currentCall.callerName) ?? formatPhoneNumber(currentCall.phoneNumber);
  const live = currentCall.state === 'active' || currentCall.state === 'hold';
  const dialing = isDialing(currentCall);
  const conferenceWith = currentCall.conferenceWith ?? [];
  // One added party at a time: merge or hang up the first.
  const canAdd = live && !dialing && !hasHeldCalls && conferenceWith.length === 0;

  const normalized = normalizeThirdPartyNumber(number);
  const showInvalid = touched && number.trim() !== '' && !normalized;

  const closeAdd = () => {
    setAdding(false);
    setNumber('');
    setTouched(false);
  };

  const submitAdd = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!normalized) return;
    void addThirdParty(normalized);
    closeAdd();
  };

  return (
    <div
      role="region"
      aria-label="Live call"
      className={cn(
        'border-b border-rule px-4 py-2',
        onHold ? 'bg-ringing-tint' : 'bg-surface',
        className
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
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
            {conferenceWith.length > 0
              ? ` · 3-way with ${conferenceWith.map(n => formatPhoneNumber(n) || n).join(', ')}`
              : ''}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
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
          {hasHeldCalls ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void mergeCalls()}
              // Nothing to merge until the person being added picks up.
              disabled={dialing || currentCall.state !== 'active'}
            >
              <Merge className="mr-1.5 h-4 w-4" aria-hidden />
              {dialing ? 'Merge when they answer' : 'Merge calls'}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              aria-expanded={adding}
              onClick={() => (adding ? closeAdd() : setAdding(true))}
              disabled={!canAdd}
            >
              <UserPlus className="mr-1.5 h-4 w-4" aria-hidden />
              Add caller
            </Button>
          )}
          <Button size="sm" variant="destructive" onClick={() => void hangupCall()}>
            <PhoneOff className="mr-1.5 h-4 w-4" aria-hidden />
            Hang up
          </Button>
        </div>
      </div>

      {adding && canAdd ? (
        <form
          onSubmit={submitAdd}
          aria-label="Add a caller"
          className="mt-2 flex flex-wrap items-start gap-2"
        >
          <div className="min-w-[12rem] flex-1">
            <Input
              type="tel"
              inputMode="tel"
              autoFocus
              value={number}
              onChange={e => setNumber(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') {
                  // Close the form, not the quoter.
                  e.stopPropagation();
                  closeAdd();
                }
              }}
              placeholder="Number to add, e.g. (555) 123-4567"
              aria-label="Phone number to add"
              aria-invalid={showInvalid || undefined}
            />
            {showInvalid ? (
              <p className="t-meta mt-1 text-dropped-ink">Enter a 10-digit US phone number.</p>
            ) : (
              <p className="t-meta mt-1 text-ink-3">
                The customer goes on hold while you dial. Merge calls when they answer.
              </p>
            )}
          </div>
          <Button size="sm" type="submit">
            <UserPlus className="mr-1.5 h-4 w-4" aria-hidden />
            Call
          </Button>
          <Button size="sm" type="button" variant="ghost" onClick={closeAdd} aria-label="Cancel">
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </form>
      ) : null}
    </div>
  );
}
