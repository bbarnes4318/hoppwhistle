import {
  DISPOSITIONS,
  DISPOSITION_LABELS,
  FOLLOW_UP_DISPOSITIONS,
  type DispositionValue,
} from '@hopwhistle/shared';
import { CalendarClock, Check, CheckCircle2, ClipboardList, Loader2 } from 'lucide-react';
import * as React from 'react';

import { Notice } from '@/components/domain/notice';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

import { formatCallTimer, formatPhoneNumber } from './format';
import { FOCUS_RING, PRESS, TOUCH_TARGET } from './parts';

/**
 * Wrap-up: how the call ended, as large tiles, then whatever that answer
 * needs — a follow-up time, notes, and for a sale the application itself.
 *
 * Presentation only. GlobalDispositionModal owns the fields, the rules for
 * what is required and the single save request; this renders them.
 */

type Tone = 'live' | 'ringing' | 'dropped' | 'money' | 'neutral';

/*
 * The shared package's DISPOSITION_COLORS are raw palette classes written for
 * the old dark portal. These are the same outcomes in the signal tokens:
 * didn't reach anyone is dropped, a next step is ringing, a good outcome is
 * live, and a written application is money.
 */
const DISPOSITION_TONE: Record<DispositionValue, Tone> = {
  NO_ANSWER: 'dropped',
  DISCONNECTED: 'dropped',
  WRONG_NUMBER: 'dropped',
  NOT_INTERESTED: 'neutral',
  NOT_QUALIFIED: 'neutral',
  NO_MEMORY_CONFUSED: 'neutral',
  VERIFIED: 'live',
  FOLLOW_UP: 'ringing',
  SET_CALLBACK: 'ringing',
  SET_APPOINTMENT: 'live',
  LIVE_TRANSFER: 'live',
  APPLICATION_SUBMITTED: 'money',
};

const TILE_SELECTED: Record<Tone, string> = {
  live: 'border-live bg-live-tint text-live-ink',
  ringing: 'border-ringing bg-ringing-tint text-ringing-ink',
  dropped: 'border-dropped bg-dropped-tint text-dropped-ink',
  money: 'border-money bg-money-tint text-money-ink',
  neutral: 'border-ink-2 bg-sunken text-ink',
};

const TILE_DOT: Record<Tone, string> = {
  live: 'bg-live',
  ringing: 'bg-ringing',
  dropped: 'bg-dropped',
  money: 'bg-money',
  neutral: 'bg-ink-3',
};

export interface WrapUpViewProps {
  call: {
    phoneNumber: string;
    callerName?: string | null;
    direction: 'inbound' | 'outbound';
    duration: number;
  };
  selected: string;
  onSelect: (value: string) => void;
  notes: string;
  onNotesChange: (value: string) => void;
  followUpDate: string;
  followUpTime: string;
  onFollowUpDateChange: (value: string) => void;
  onFollowUpTimeChange: (value: string) => void;
  canSave: boolean;
  saving: boolean;
  saved: boolean;
  saveError?: string | null;
  /** The application save failed; the button offers a retry. */
  retry?: boolean;
  onSave: () => void;
  onSkip: () => void;
  /** The application form, shown for APPLICATION_SUBMITTED. */
  applicationSlot?: React.ReactNode;
  placement?: 'overlay' | 'inline';
}

export function WrapUpView({
  call,
  selected,
  onSelect,
  notes,
  onNotesChange,
  followUpDate,
  followUpTime,
  onFollowUpDateChange,
  onFollowUpTimeChange,
  canSave,
  saving,
  saved,
  saveError,
  retry = false,
  onSave,
  onSkip,
  applicationSlot,
  placement = 'overlay',
}: WrapUpViewProps): JSX.Element {
  const headingId = React.useId();
  const needsFollowUp = (FOLLOW_UP_DISPOSITIONS as readonly string[]).includes(selected);
  const followUpRequired = selected === 'SET_CALLBACK' || selected === 'FOLLOW_UP';
  const number = formatPhoneNumber(call.phoneNumber) || 'Unknown number';

  const card = (
    <div
      role="dialog"
      aria-modal={placement === 'overlay' ? true : undefined}
      aria-labelledby={headingId}
      className={cn(
        'flex w-full flex-col overflow-hidden border border-rule bg-surface text-ink shadow-pop',
        placement === 'overlay'
          ? 'max-h-[92dvh] rounded-t-[20px] sm:max-h-[88vh] sm:max-w-lg sm:rounded-card animate-in fade-in-0 slide-in-from-bottom-4 duration-200 motion-reduce:animate-none'
          : 'max-w-lg rounded-card'
      )}
    >
      {saved ? (
        <div
          className="flex flex-col items-center justify-center px-6 py-14 text-center"
          role="status"
        >
          <span className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-live-tint text-live-ink">
            <CheckCircle2 className="h-6 w-6" aria-hidden />
          </span>
          <h2 id={headingId} className="t-section text-ink">
            Call wrapped up
          </h2>
          <p className="t-body mt-1 text-ink-2">Saved. Taking you back to your work.</p>
        </div>
      ) : (
        <>
          <header className="shrink-0 border-b border-rule bg-sunken px-5 pb-4 pt-4 shadow-[inset_0_3px_0_0_var(--rule-strong)]">
            <p className="t-label text-ink-3">Wrap-up</p>
            <h2 id={headingId} className="t-section mt-1 text-ink">
              How did the call end?
            </h2>
            <p className="t-meta mt-1 flex flex-wrap items-center gap-x-2 text-ink-2">
              {call.callerName ? (
                <span className="font-medium text-ink">{call.callerName}</span>
              ) : null}
              <span className="t-data text-[12px]">{number}</span>
              <span aria-hidden>·</span>
              <span>{call.direction === 'inbound' ? 'Inbound' : 'Outbound'}</span>
              <span aria-hidden>·</span>
              <span className="tabular-nums">{formatCallTimer(call.duration)}</span>
            </p>
          </header>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
            {saveError ? (
              <Notice tone="error" title="The wrap-up was not saved">
                Nothing was recorded. Check your connection and save again.
              </Notice>
            ) : null}

            <div role="radiogroup" aria-labelledby={headingId} className="grid grid-cols-2 gap-2">
              {DISPOSITIONS.map(value => {
                const tone = DISPOSITION_TONE[value];
                const isSelected = selected === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => onSelect(value)}
                    disabled={saving}
                    className={cn(
                      'relative flex min-h-[52px] items-center gap-2.5 rounded-card border-2 px-3 py-2 text-left text-sm font-medium',
                      isSelected
                        ? TILE_SELECTED[tone]
                        : 'border-rule bg-surface text-ink hover:border-rule-strong hover:bg-sunken',
                      'disabled:cursor-not-allowed disabled:opacity-60',
                      PRESS,
                      FOCUS_RING,
                      TOUCH_TARGET
                    )}
                  >
                    <span
                      className={cn('h-2.5 w-2.5 shrink-0 rounded-full', TILE_DOT[tone])}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 leading-snug">{DISPOSITION_LABELS[value]}</span>
                    {isSelected ? <Check className="h-4 w-4 shrink-0" aria-hidden /> : null}
                  </button>
                );
              })}
            </div>

            {needsFollowUp ? (
              <fieldset className="space-y-3 rounded-card border border-rule bg-sunken p-4">
                <legend className="sr-only">Follow-up</legend>
                <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <CalendarClock className="h-4 w-4 text-ink-2" aria-hidden />
                  {selected === 'SET_APPOINTMENT'
                    ? 'Appointment'
                    : selected === 'SET_CALLBACK'
                      ? 'Callback'
                      : 'Follow-up'}
                  <span
                    className={cn(
                      'text-xs font-medium',
                      followUpRequired ? 'text-ringing-ink' : 'text-ink-3'
                    )}
                  >
                    {followUpRequired ? 'Required' : 'Optional'}
                  </span>
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="t-label mb-1 block text-ink-3">Date</span>
                    <Input
                      type="date"
                      value={followUpDate}
                      onChange={e => onFollowUpDateChange(e.target.value)}
                      required={followUpRequired}
                      disabled={saving}
                    />
                  </label>
                  <label className="block">
                    <span className="t-label mb-1 block text-ink-3">Time</span>
                    <Input
                      type="time"
                      value={followUpTime}
                      onChange={e => onFollowUpTimeChange(e.target.value)}
                      required={followUpRequired}
                      disabled={saving}
                    />
                  </label>
                </div>
              </fieldset>
            ) : null}

            {selected ? (
              <label className="block">
                <span className="t-label mb-1 flex items-center gap-1.5 text-ink-3">
                  <ClipboardList className="h-3.5 w-3.5" aria-hidden />
                  Notes
                </span>
                <Textarea
                  value={notes}
                  onChange={e => onNotesChange(e.target.value)}
                  placeholder="What should the next person to call them know?"
                  rows={3}
                  disabled={saving}
                  className="resize-none"
                />
              </label>
            ) : null}

            {selected === 'APPLICATION_SUBMITTED' ? applicationSlot : null}
          </div>

          <footer className="flex shrink-0 flex-col-reverse gap-2 border-t border-rule px-5 py-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onSkip}
              disabled={saving}
              className={cn(
                'inline-flex h-11 items-center justify-center rounded-control px-4 text-sm font-medium text-ink-2 hover:bg-sunken hover:text-ink disabled:opacity-50',
                FOCUS_RING,
                TOUCH_TARGET
              )}
            >
              Skip for now
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={!canSave || saving}
              className={cn(
                'inline-flex h-11 items-center justify-center gap-2 rounded-control px-5 text-sm font-semibold',
                'bg-brand-strong text-white shadow-card hover:bg-brand-strong-hover',
                'disabled:cursor-not-allowed disabled:bg-sunken disabled:text-ink-3 disabled:shadow-none',
                PRESS,
                FOCUS_RING,
                TOUCH_TARGET
              )}
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
              ) : null}
              {saving ? 'Saving…' : retry ? 'Try saving again' : 'Save wrap-up'}
            </button>
          </footer>
        </>
      )}
    </div>
  );

  if (placement === 'inline') return card;

  return (
    <div className="fixed inset-0 z-[9999] flex items-end justify-center bg-[rgba(16,24,40,0.45)] sm:items-center sm:p-4 animate-in fade-in-0 duration-200 motion-reduce:animate-none">
      {card}
    </div>
  );
}
