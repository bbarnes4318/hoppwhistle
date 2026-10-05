'use client';

/**
 * A carrier's mark, wherever its name is shown.
 *
 * Logos sit on a light plate with a hairline border: carrier logos are drawn
 * for a white page, and the plate keeps them legible inside a branded or
 * tinted surface.
 *
 * A carrier with no logo file:
 * - `md` / `lg` (the plate *is* the carrier's identity): its name set as a
 *   wordmark, "Aetna" over "Continental Life", so a list of carriers keeps one
 *   rhythm and nothing looks like a broken image.
 * - `xs` / `sm` (inline, next to the carrier's name): nothing at all.
 *
 * Decorative by default (the name is beside it). Pass `labelled` when the
 * plate stands alone and must name the carrier itself.
 */

import * as React from 'react';

import { carrierBrand } from '@/lib/carrier-brand';
import { cn } from '@/lib/utils';

const SIZE = {
  xs: { box: 'h-7 w-[64px]', square: 'h-7 w-7' },
  sm: { box: 'h-9 w-[84px]', square: 'h-9 w-9' },
  md: { box: 'h-12 w-[128px]', square: 'h-12 w-12' },
  lg: { box: 'h-14 w-[168px]', square: 'h-14 w-14' },
} as const;

type Size = keyof typeof SIZE;

export interface CarrierLogoProps {
  /** Every name the carrier goes by here: family, product id, application name. */
  names: Array<string | null | undefined>;
  size?: Size;
  /** Keep the wide plate even for a square seal, so a column of logos lines up. */
  fixedWidth?: boolean;
  labelled?: boolean;
  className?: string;
}

/** "Aetna / Continental Life" -> ["Aetna", "Continental Life"]. */
function wordmarkParts(name: string): [string, string | null] {
  const [head, ...rest] = name.split(/\s*\/\s*/);
  const primary = head.replace(/\s*\(.*\)\s*$/, '').trim() || name;
  return [primary, rest.length ? rest.join(' / ') : null];
}

export function CarrierLogo({
  names,
  size = 'md',
  fixedWidth = true,
  labelled = false,
  className,
}: CarrierLogoProps): JSX.Element | null {
  const brand = carrierBrand(...names);
  const display = names.find((n): n is string => Boolean(n)) ?? 'Carrier';
  const s = SIZE[size];
  const [failed, setFailed] = React.useState(false);
  const hasLogo = Boolean(brand?.logo) && !failed;
  const inline = size === 'xs' || size === 'sm';

  if (!hasLogo && inline) return null;

  const square = !fixedWidth && hasLogo && brand?.shape === 'square';
  const label = brand?.name ?? display;
  const [primary, secondary] = wordmarkParts(display);

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-control border border-rule bg-logo-plate',
        square ? s.square : s.box,
        className
      )}
      role={labelled && hasLogo ? 'img' : undefined}
      aria-label={labelled && hasLogo ? label : undefined}
      aria-hidden={labelled ? undefined : true}
      data-carrier-logo={hasLogo ? label : 'wordmark'}
    >
      {hasLogo ? (
        // eslint-disable-next-line @next/next/no-img-element -- static asset, images are unoptimized
        <img
          src={brand!.logo!}
          alt=""
          decoding="async"
          onError={() => setFailed(true)}
          className={cn(
            'max-h-full max-w-full object-contain',
            brand!.shape === 'square' ? 'p-1' : inline ? 'px-1 py-0.5' : 'px-2.5 py-2'
          )}
        />
      ) : (
        <span className="flex min-w-0 flex-col items-center px-2 text-center leading-none">
          <span
            className={cn(
              'line-clamp-2 max-w-full font-bold leading-[1.1] tracking-tight text-logo-plate-ink',
              primary.length > 14 ? 'text-[13px]' : size === 'lg' ? 'text-[17px]' : 'text-[15px]'
            )}
          >
            {primary}
          </span>
          {secondary ? (
            <span className="mt-1 max-w-full truncate text-[9px] font-semibold uppercase tracking-[0.08em] text-logo-plate-ink opacity-60">
              {secondary}
            </span>
          ) : null}
        </span>
      )}
    </span>
  );
}
