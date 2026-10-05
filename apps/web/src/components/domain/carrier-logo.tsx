'use client';

/**
 * A carrier's mark, wherever its name is shown.
 *
 * Always on a light tile with a hairline border: carrier logos are drawn for a
 * white page, and the tile keeps them legible inside a branded or tinted
 * surface. A carrier with no logo gets its monogram on a sunken tile, at the
 * same size, so a list of carriers keeps one rhythm.
 *
 * Decorative next to the carrier's name (the default): `alt=""`. Pass
 * `labelled` when the logo stands alone and must name the carrier itself.
 */

import * as React from 'react';

import { carrierBrand, monogramFor } from '@/lib/carrier-brand';
import { cn } from '@/lib/utils';

const SIZE = {
  xs: { box: 'h-7 w-[60px]', square: 'h-7 w-7', text: 'text-[9px]' },
  sm: { box: 'h-9 w-[80px]', square: 'h-9 w-9', text: 'text-[10px]' },
  md: { box: 'h-11 w-[92px]', square: 'h-11 w-11', text: 'text-xs' },
  lg: { box: 'h-14 w-[120px]', square: 'h-14 w-14', text: 'text-sm' },
} as const;

export interface CarrierLogoProps {
  /** Every name the carrier goes by here: family, product id, application name. */
  names: Array<string | null | undefined>;
  size?: keyof typeof SIZE;
  /** Keep the wide box even for a square seal, so a column of logos lines up. */
  fixedWidth?: boolean;
  labelled?: boolean;
  className?: string;
}

export function CarrierLogo({
  names,
  size = 'md',
  fixedWidth = true,
  labelled = false,
  className,
}: CarrierLogoProps): JSX.Element {
  const brand = carrierBrand(...names);
  const display = names.find((n): n is string => Boolean(n)) ?? 'Carrier';
  const s = SIZE[size];
  const [failed, setFailed] = React.useState(false);
  const square = !fixedWidth && (!brand?.logo || brand.shape === 'square');

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-control border border-rule bg-surface',
        square ? s.square : s.box,
        className
      )}
      role={labelled ? 'img' : undefined}
      aria-label={labelled ? (brand?.name ?? display) : undefined}
      aria-hidden={labelled ? undefined : true}
      data-carrier-logo={brand?.logo && !failed ? brand.name : 'monogram'}
    >
      {brand?.logo && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- static asset, images are unoptimized
        <img
          src={brand.logo}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className={cn(
            'max-h-full max-w-full object-contain',
            brand.shape === 'square' ? 'p-0.5' : 'px-1 py-0.5'
          )}
        />
      ) : (
        <span
          className={cn(
            'flex h-full w-full items-center justify-center bg-sunken font-semibold tracking-wide text-ink-2',
            s.text
          )}
        >
          {monogramFor(brand?.name ?? display)}
        </span>
      )}
    </span>
  );
}
