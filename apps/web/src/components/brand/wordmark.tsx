import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * The NetEnroll wordmark: "net" in black, "Enroll" in brand green.
 *
 * This is the supplied artwork, not a reconstruction. It used to be two
 * coloured <span>s set in whatever display face the product happened to load,
 * which meant the mark changed shape with the font stack and never matched the
 * files the business actually uses. It is now `public/netenroll-wordmark.svg`
 * — outlined paths, so it is crisp at every size, identical in every browser,
 * and needs no font to be present.
 *
 * The two colours are literal on purpose: the mark is #000000 and #10B981
 * wherever it appears, on a light ground, and does not follow the theme
 * tokens. It is never placed on a dark ground; the one dark screen does not
 * render the sidebar.
 *
 * `Logo` (./logo.tsx) is the full lockup — this mark over the
 * PAY-PER-APPLICATION line — for the places that get the whole thing.
 */

/** Rendered height of the mark, in px, per size. */
const HEIGHTS = { sm: 12, md: 15, lg: 26 } as const;

/** 743.2 / 118.72, from the artwork's viewBox. */
const ASPECT = 6.2601;

export function Wordmark({
  className,
  size = 'md',
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { size?: 'sm' | 'md' | 'lg' }) {
  const height = HEIGHTS[size];

  return (
    <span
      className={cn('inline-flex select-none items-center leading-none', className)}
      translate="no"
      data-testid="wordmark"
      {...props}
    >
      {/*
        A plain <img> rather than next/image: `images.unoptimized` is on
        repo-wide, so next/image would add a wrapper and no optimisation.
      */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/netenroll-wordmark.svg"
        alt="netEnroll"
        width={Math.round(height * ASPECT)}
        height={height}
        style={{ height, width: 'auto' }}
        className="max-w-full"
        draggable={false}
      />
    </span>
  );
}
