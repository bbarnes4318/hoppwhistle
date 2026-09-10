import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * The full NetEnroll lockup: the wordmark over the PAY-PER-APPLICATION line.
 *
 * This is the supplied artwork — `public/netenroll-logo.png`, cut from
 * `net-enroll-favicon.png`, which is the master. (The other supplied file,
 * `net-enroll-logo-updated.png`, is the same lockup clipped ~8px at the top:
 * the E and ll ascenders end flat against the canvas edge. The square file
 * carries the same mark uncropped at 2000px, so everything is cut from that.)
 *
 * The white ground was keyed out to real anti-aliased alpha, so the mark sits
 * on --paper, on --surface, or on anything else light without a pale rectangle
 * showing behind it. It is never placed on a dark ground: "net" is #000000 and
 * would disappear. A dark-ground lockup is different artwork and we do not
 * have it.
 *
 * `width` is the knob, not height: the lockup is set by how much horizontal
 * room it has, and the height follows from the artwork's aspect ratio.
 */

/** 1950 / 555, the artwork's own pixel dimensions. */
const ASPECT = 3.5135;

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
      {/*
        A plain <img> rather than next/image: `images.unoptimized` is on
        repo-wide, so next/image would add a wrapper and no optimisation.
      */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/netenroll-logo.png"
        alt="netEnroll — Pay-Per-Application"
        width={width}
        height={Math.round(width / ASPECT)}
        style={{ width, maxWidth: '100%', height: 'auto' }}
        draggable={false}
      />
    </span>
  );
}
