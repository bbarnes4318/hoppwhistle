'use client';

/**
 * A carrier's mark, wherever its name is shown.
 *
 * Logos sit on a light plate with a hairline border: carrier logos are drawn
 * for a white page, and the plate keeps them legible inside a branded or
 * tinted surface.
 *
 * A carrier with no logo file:
 * - `md` / `lg` / `row` / `quote*` (the plate *is* the carrier's identity): its name set as a
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
  /*
   * The quoter's result row: the logo IS how an agent finds the carrier, so
   * the plate is 120x50 and the mark may fill 110x40 of it. The files are
   * already trimmed to their mark, so the plate adds only 5px of air: a wide
   * wordmark runs the full width, a seal the full height.
   */
  row: { box: 'h-[50px] w-[120px]', square: 'h-[50px] w-[50px]' },
  /*
   * The quoter's result cards, largest first: the recommended carrier, the
   * two runner-up picks, and every other carrier in the list. Same plate as
   * `row`, more of it, so a wordmark is read at a glance rather than found.
   */
  quoteHero: { box: 'h-[76px] w-[190px]', square: 'h-[76px] w-[76px]' },
  quotePick: { box: 'h-[62px] w-[160px]', square: 'h-[62px] w-[62px]' },
  quoteRow: { box: 'h-[56px] w-[150px]', square: 'h-[56px] w-[56px]' },
  /*
   * The quoter's result list: one plate size for every carrier, so a column
   * of twenty logos lines up and no carrier is bigger than its neighbour
   * because of where it ranked. 104x44 lets a wordmark read at a glance in a
   * row ~68px tall.
   */
  quoteList: { box: 'h-[44px] w-[104px]', square: 'h-[44px] w-[44px]' },
} as const;

/** The plate sizes that fill edge to edge, with the mark scaled to the plate. */
const FILL_SIZES: ReadonlySet<Size> = new Set([
  'row',
  'quoteHero',
  'quotePick',
  'quoteRow',
  'quoteList',
]);
const PLATE_PADDING: Partial<Record<Size, string>> = {
  row: 'p-[5px]',
  quoteHero: 'px-3 py-2.5',
  quotePick: 'px-2.5 py-2',
  quoteRow: 'px-2.5 py-[7px]',
  quoteList: 'px-2 py-[5px]',
};

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
  const row = FILL_SIZES.has(size);
  const quote = row && size !== 'row';

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden border border-rule bg-logo-plate',
        row
          ? quote
            ? 'rounded-[8px] shadow-[0_1px_2px_rgba(15,23,42,0.06)]'
            : 'rounded-[6px]'
          : 'rounded-control',
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
            row
              ? // Fills the plate and scales up or down to it, never cropped.
                cn('h-full w-full object-contain', PLATE_PADDING[size])
              : cn(
                  'max-h-full max-w-full object-contain',
                  brand!.shape === 'square' ? 'p-1' : inline ? 'px-1 py-0.5' : 'px-2.5 py-2'
                )
          )}
        />
      ) : (
        <span className="flex min-w-0 flex-col items-center px-2 text-center leading-none">
          <span
            className={cn(
              'line-clamp-2 max-w-full font-bold leading-[1.1] tracking-tight text-logo-plate-ink',
              size === 'quoteHero'
                ? primary.length > 14
                  ? 'text-[16px]'
                  : 'text-[20px]'
                : primary.length > 14
                  ? 'text-[13px]'
                  : size === 'lg' || quote
                    ? 'text-[17px]'
                    : 'text-[15px]'
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
