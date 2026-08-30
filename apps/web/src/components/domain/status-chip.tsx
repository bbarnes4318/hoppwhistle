import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

import { formatEnumLabel, resolveTone, type StatusTone } from './status-tones';

/**
 * StatusChip — one variant per enum value in the Prisma schema.
 *
 * Pass the enum name alongside the value wherever you have it. The same word
 * means different things in different enums (a PAUSED buyer is out of money; a
 * PAUSED route was switched off by hand), and the enum name is what lets the
 * chip tell them apart. Without it the chip still works, using the by-name
 * default.
 *
 * `blocked` is violet, not red. A call stopped by a DNC or litigator gate is
 * the system working correctly, and colouring it like a failure trains people
 * to ignore the colour that should scare them.
 */

const TONE_CLASS: Record<StatusTone, string> = {
  live: 'bg-live-tint text-live-ink',
  ringing: 'bg-ringing-tint text-ringing-ink',
  dropped: 'bg-dropped-tint text-dropped-ink',
  blocked: 'bg-blocked-tint text-blocked-ink',
  money: 'bg-money-tint text-money-ink',
  neutral: 'bg-sunken text-ink-2',
};

/** A 4px dot carries the state for anyone who cannot separate the hues. */
const DOT_CLASS: Record<StatusTone, string> = {
  live: 'bg-live',
  ringing: 'bg-ringing',
  dropped: 'bg-dropped',
  blocked: 'bg-blocked',
  money: 'bg-money',
  neutral: 'bg-ink-3',
};

export interface StatusChipProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  /** The raw enum value, e.g. `NO_ANSWER`. */
  value: string;
  /** The Prisma enum it came from, e.g. `CallStatus`. Sharpens the tone. */
  enumName?: string;
  /** Override the tone. Use sparingly — the map is the point. */
  tone?: StatusTone;
  /** Override the text. Defaults to a humanised form of `value`. */
  label?: string;
  /**
   * Show the state dot. On by default: colour alone should never be the only
   * carrier of meaning.
   */
  dot?: boolean;
  size?: 'sm' | 'md';
}

export function StatusChip({
  value,
  enumName,
  tone,
  label,
  dot = true,
  size = 'md',
  className,
  ...props
}: StatusChipProps) {
  const resolved = tone ?? resolveTone(value, enumName);
  const text = label ?? formatEnumLabel(value, enumName);

  return (
    <Badge
      className={cn(
        'gap-1.5 border-transparent font-medium',
        'rounded-control',
        size === 'sm' ? 'px-1.5 py-0 text-[11px] leading-5' : 't-meta px-2 py-0.5',
        TONE_CLASS[resolved],
        // Badge's own hover styles assume a clickable chip. These are labels.
        'hover:bg-[color:inherit]',
        className
      )}
      data-tone={resolved}
      data-value={value}
      {...props}
    >
      {dot ? (
        <span aria-hidden className={cn('h-1 w-1 shrink-0 rounded-full', DOT_CLASS[resolved])} />
      ) : null}
      {text}
    </Badge>
  );
}

export { resolveTone, formatEnumLabel };
export type { StatusTone };
