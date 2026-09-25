import { Phone } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

import { initialsFor, type SoftphoneTone } from './format';

/**
 * Small shared pieces of the softphone's look. Class maps are written out in
 * full (never assembled from `bg-${tone}`) so Tailwind can see every class.
 */

export const TONE_DOT: Record<SoftphoneTone, string> = {
  live: 'bg-live',
  ringing: 'bg-ringing',
  dropped: 'bg-dropped',
  neutral: 'bg-ink-3',
};

/** The header ground and its accent bar: the state, readable from across a room. */
export const TONE_HEADER: Record<SoftphoneTone, string> = {
  live: 'bg-live-tint shadow-[inset_0_3px_0_0_var(--live)]',
  ringing: 'bg-ringing-tint shadow-[inset_0_3px_0_0_var(--ringing)]',
  dropped: 'bg-dropped-tint shadow-[inset_0_3px_0_0_var(--dropped)]',
  neutral: 'bg-sunken shadow-[inset_0_3px_0_0_var(--rule-strong)]',
};

export const TONE_TEXT: Record<SoftphoneTone, string> = {
  live: 'text-live-ink',
  ringing: 'text-ringing-ink',
  dropped: 'text-dropped-ink',
  neutral: 'text-ink-2',
};

/**
 * Text on a solid signal fill. White in light; in dark the signals are light
 * enough that white fails, so the text drops to the dark paper instead.
 */
export const ON_SIGNAL = 'text-white dark:text-paper';

/** Focus ring shared by every softphone control. */
export const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface';

/** 44px on touch screens, per the platform guidelines, whatever the visual size. */
export const TOUCH_TARGET =
  '[@media(pointer:coarse)]:min-h-[44px] [@media(pointer:coarse)]:min-w-[44px]';

/** Press feedback that a reduced-motion setting turns off. */
export const PRESS =
  'transition-[transform,background-color,border-color,color] duration-150 ease-out active:scale-[0.96] ne-motion motion-reduce:active:scale-100';

export function StateDot({
  tone,
  pulse = false,
  className,
}: {
  tone: SoftphoneTone;
  pulse?: boolean;
  className?: string;
}): JSX.Element {
  return (
    <span className={cn('relative inline-flex h-2.5 w-2.5 shrink-0', className)} aria-hidden>
      {pulse ? (
        <span className={cn('sp-dot-pulse absolute inset-0 rounded-full', TONE_DOT[tone])} />
      ) : null}
      <span className={cn('relative inline-flex h-2.5 w-2.5 rounded-full', TONE_DOT[tone])} />
    </span>
  );
}

/** Initials in a tinted circle, or a neutral mark when there is no name. */
export function CallerAvatar({
  name,
  tone,
  size = 'md',
}: {
  name: string | null;
  tone: SoftphoneTone;
  size?: 'md' | 'lg';
}): JSX.Element {
  const initials = initialsFor(name);
  const ground: Record<SoftphoneTone, string> = {
    live: 'bg-live-tint text-live-ink',
    ringing: 'bg-ringing-tint text-ringing-ink',
    dropped: 'bg-dropped-tint text-dropped-ink',
    neutral: 'bg-sunken text-ink-2',
  };
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold',
        'ring-1 ring-inset ring-rule',
        size === 'lg' ? 'h-16 w-16 text-xl' : 'h-12 w-12 text-base',
        ground[tone]
      )}
    >
      {initials || <Phone className={size === 'lg' ? 'h-6 w-6' : 'h-5 w-5'} />}
    </span>
  );
}

export function Kbd({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <kbd className="inline-flex min-w-[22px] items-center justify-center rounded-[5px] border border-rule-strong bg-surface px-1.5 py-0.5 font-sans text-[11px] font-semibold text-ink-2 shadow-card">
      {children}
    </kbd>
  );
}

/**
 * The keyframes the softphone needs beyond Tailwind's, and the reduced-motion
 * rule that stills them. Rendered once by each top-level softphone surface;
 * duplicate <style> blocks with the same rules are harmless.
 */
export function SoftphoneMotion(): JSX.Element {
  return (
    <style>{`
@keyframes sp-ring { 0% { box-shadow: 0 0 0 0 var(--ringing); opacity: .9 } 70% { box-shadow: 0 0 0 12px var(--ringing); opacity: 0 } 100% { box-shadow: 0 0 0 12px var(--ringing); opacity: 0 } }
@keyframes sp-dot { 0% { transform: scale(1); opacity: .7 } 80%, 100% { transform: scale(2.4); opacity: 0 } }
.sp-ring { position: absolute; inset: 0; border-radius: inherit; pointer-events: none; animation: sp-ring 1.6s cubic-bezier(.2,.6,.4,1) infinite; }
.sp-dot-pulse { animation: sp-dot 1.6s ease-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .sp-ring, .sp-dot-pulse { animation: none; }
  .sp-ring { box-shadow: 0 0 0 3px var(--ringing); opacity: 1; }
}
`}</style>
  );
}
