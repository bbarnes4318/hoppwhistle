import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * The full NetEnroll lockup: the wordmark over the PAY-PER-APPLICATION line.
 *
 * The supplied artwork, outlined, in `public/netenroll-logo.svg`. This is the
 * mark for the places that carry the brand on its own — the sign-in screen,
 * which is the front door of agents.netenroll.com — as opposed to the bare
 * `Wordmark`, which is what fits a 48px sidebar header.
 *
 * `width` is the knob, not height: the lockup is set by how much horizontal
 * room it has, and the height follows from the artwork's aspect ratio.
 */

/** 743.2 / 182.72, from the artwork's viewBox. */
const ASPECT = 4.0674;

export function Logo({
  className,
  width = 260,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { width?: number }) {
  return (
    <span
      className={cn('inline-flex select-none items-center leading-none', className)}
      translate="no"
      data-testid="logo"
      {...props}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/netenroll-logo.svg"
        alt="netEnroll — Pay-Per-Application"
        width={width}
        height={Math.round(width / ASPECT)}
        style={{ width, maxWidth: '100%', height: 'auto' }}
        draggable={false}
      />
    </span>
  );
}
