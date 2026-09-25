import { Delete, Loader2, Phone } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

import { formatPartialNumber } from './format';
import { FOCUS_RING, PRESS, TOUCH_TARGET } from './parts';

/**
 * A phone keypad: 3×4, letters under the digits, a number field that formats
 * as you type, backspace, and a Call button.
 *
 * In `dtmf` mode — on a call — there is no field and no Call button; the keys
 * send tones and the strip above shows what has been sent, which is what an
 * agent reading back an IVR menu choice needs to check.
 */
export const KEYPAD_KEYS: ReadonlyArray<{ digit: string; letters: string }> = [
  { digit: '1', letters: '' },
  { digit: '2', letters: 'ABC' },
  { digit: '3', letters: 'DEF' },
  { digit: '4', letters: 'GHI' },
  { digit: '5', letters: 'JKL' },
  { digit: '6', letters: 'MNO' },
  { digit: '7', letters: 'PQRS' },
  { digit: '8', letters: 'TUV' },
  { digit: '9', letters: 'WXYZ' },
  { digit: '*', letters: '' },
  { digit: '0', letters: '+' },
  { digit: '#', letters: '' },
];

const SPOKEN: Record<string, string> = { '*': 'star', '#': 'pound' };

export interface KeypadProps {
  mode?: 'dial' | 'dtmf';
  /** The number being dialled, or the tones sent so far. */
  value: string;
  /** Typing into the field directly (dial mode). */
  onChange?: (value: string) => void;
  onDigit: (digit: string) => void;
  onBackspace?: () => void;
  onDial?: () => void;
  dialing?: boolean;
  dialDisabled?: boolean;
  /** The key just pressed on a physical keyboard, to light the matching key. */
  pressedKey?: string | null;
  /** Sits above the field: the caller ID picker. */
  header?: React.ReactNode;
  size?: 'default' | 'compact';
}

export function Keypad({
  mode = 'dial',
  value,
  onChange,
  onDigit,
  onBackspace,
  onDial,
  dialing = false,
  dialDisabled = false,
  pressedKey,
  header,
  size = 'default',
}: KeypadProps): JSX.Element {
  const compact = size === 'compact';
  const inputId = React.useId();

  return (
    <div className="space-y-3">
      {header}

      {mode === 'dial' ? (
        <div
          className={cn(
            'flex items-center gap-1 rounded-card border border-rule-strong bg-surface pl-3 pr-1',
            'transition-[border-color,box-shadow] duration-150 ease-out ne-motion',
            'focus-within:border-brand-ink focus-within:ring-2 focus-within:ring-ring',
            compact ? 'h-12' : 'h-14'
          )}
        >
          <label htmlFor={inputId} className="sr-only">
            Phone number
          </label>
          <input
            id={inputId}
            type="tel"
            inputMode="tel"
            autoComplete="off"
            value={formatPartialNumber(value)}
            onChange={e => onChange?.(e.target.value.replace(/[^0-9*#+]/g, ''))}
            onKeyDown={e => {
              if (e.key === 'Enter' && !dialDisabled && value) {
                e.preventDefault();
                onDial?.();
              }
            }}
            placeholder="Enter a number"
            className={cn(
              'min-w-0 flex-1 bg-transparent font-mono tabular-nums text-ink outline-none placeholder:font-sans placeholder:text-ink-3',
              compact ? 'text-lg' : 'text-[22px]'
            )}
          />
          {value ? (
            <button
              type="button"
              onClick={onBackspace}
              aria-label="Delete last digit"
              className={cn(
                'inline-flex h-10 w-10 items-center justify-center rounded-control text-ink-2 hover:bg-sunken hover:text-ink',
                PRESS,
                FOCUS_RING,
                TOUCH_TARGET
              )}
            >
              <Delete className="h-5 w-5" />
            </button>
          ) : null}
        </div>
      ) : (
        <div
          className="flex h-10 items-center justify-center rounded-card bg-sunken px-3"
          aria-live="polite"
        >
          <span
            className={cn(
              't-data truncate text-lg tracking-[0.2em]',
              value ? 'text-ink' : 'text-ink-3'
            )}
          >
            {value || 'Tones you send appear here'}
          </span>
        </div>
      )}

      <div
        className={cn('grid grid-cols-3', compact ? 'gap-1.5' : 'gap-2')}
        role="group"
        aria-label="Keypad"
      >
        {KEYPAD_KEYS.map(({ digit, letters }) => (
          <button
            key={digit}
            type="button"
            onClick={() => onDigit(digit)}
            aria-label={
              letters && letters !== '+' ? `${digit} ${letters}` : (SPOKEN[digit] ?? digit)
            }
            data-pressed={pressedKey === digit ? '' : undefined}
            className={cn(
              'flex flex-col items-center justify-center rounded-card border border-transparent bg-sunken',
              'hover:border-rule-strong hover:bg-surface',
              'active:bg-brand-tint data-[pressed]:scale-[0.96] data-[pressed]:bg-brand-tint',
              compact ? 'h-12' : 'h-14',
              PRESS,
              FOCUS_RING,
              TOUCH_TARGET
            )}
          >
            <span
              className={cn('font-medium leading-none text-ink', compact ? 'text-xl' : 'text-2xl')}
            >
              {digit}
            </span>
            <span
              className={cn(
                'mt-1 h-[11px] text-[10px] font-semibold leading-none tracking-[0.14em] text-ink-3'
              )}
              aria-hidden
            >
              {letters}
            </span>
          </button>
        ))}
      </div>

      {mode === 'dial' ? (
        <button
          type="button"
          onClick={onDial}
          disabled={dialDisabled || dialing || !value}
          className={cn(
            'inline-flex w-full items-center justify-center gap-2 rounded-card text-base font-semibold',
            compact ? 'h-12' : 'h-14',
            // The primary action, so the primary button: live is reserved for
            // a connected call and is not a button colour.
            'bg-brand-strong text-white hover:bg-brand-strong-hover',
            'disabled:cursor-not-allowed disabled:bg-sunken disabled:text-ink-3',
            PRESS,
            FOCUS_RING,
            TOUCH_TARGET
          )}
        >
          {dialing ? (
            <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden />
          ) : (
            <Phone className="h-5 w-5" aria-hidden />
          )}
          {dialing ? 'Connecting…' : 'Call'}
        </button>
      ) : null}
    </div>
  );
}
