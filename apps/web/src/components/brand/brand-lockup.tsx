import type { ActiveBrand } from '@/lib/brand-themes';
import { cn } from '@/lib/utils';

/**
 * An agency's logo, laid out for the product's chrome: the full lockup
 * (`brand.logo`), on a white plate where the ground is navy.
 */
export function BrandLockup({
  brand,
  tone,
  size = 'md',
  className,
}: {
  brand: ActiveBrand;
  tone: 'dark' | 'light';
  size?: 'md' | 'sm';
  className?: string;
}): JSX.Element {
  const md = size === 'md';
  return (
    <span
      className={cn(
        'inline-flex select-none items-center',
        // The artwork has navy lettering and an opaque white ground, so on the
        // navy rail it sits on a white plate.
        tone === 'dark' &&
          'rounded-[10px] bg-white px-2 py-1 shadow-[0_1px_2px_rgba(0,0,0,0.3),0_0_0_1px_rgba(255,255,255,0.12)]',
        className
      )}
      translate="no"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={brand.logo}
        alt={brand.name}
        className={cn('w-auto', md ? 'h-[64px]' : 'h-[40px]')}
        draggable={false}
        data-testid="brand-logo"
      />
    </span>
  );
}

/**
 * An agency's wordmark alone, for a page that is mostly brand: the sign-in
 * page's panel and header. Not the chrome lockup above, whose artwork carries
 * an opaque white canvas -- set on a coloured ground that reads as a sticker.
 * Both wordmark files are transparent, so neither ever needs a plate:
 *
 *   surface 'dark'   `wordmarkOnDark`, lettering reversed out for navy
 *   surface 'light'  `wordmark`, the artwork's own colours
 *
 * Width is the caller's (`className`), height follows. The width and height
 * attributes are the files' own canvas, there to reserve the box before the
 * image arrives; the browser takes the real ratio from the file once it has.
 */
export function BrandWordmark({
  brand,
  surface,
  className,
}: {
  brand: ActiveBrand;
  surface: 'dark' | 'light';
  className?: string;
}): JSX.Element {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={surface === 'dark' ? brand.wordmarkOnDark : brand.wordmark}
      alt={brand.name}
      width={363}
      height={233}
      className={cn('block h-auto max-w-full select-none', className)}
      draggable={false}
      translate="no"
      data-testid="brand-logo"
    />
  );
}
