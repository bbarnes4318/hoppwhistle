import type { ActiveBrand } from '@/lib/brand-themes';
import { cn } from '@/lib/utils';

/**
 * The surface an agency's wordmark sits on, which picks the artwork. Both files
 * are transparent, so the image is never given a ground of its own -- no plate,
 * no tile, no shadow. The surface chooses the image; the image never changes
 * the surface.
 *
 *   'dark'   `wordmarkOnDark`, lettering reversed out for the brand navy
 *   'light'  `wordmark`, the artwork's own colours, for white and light grounds
 */
export type BrandSurface = 'dark' | 'light';

/**
 * The default intrinsic canvas of both wordmark files, for a theme that does
 * not give its own (`BrandTheme.wordmarkSize`). Set as width/height attributes
 * so the box is reserved before the image arrives; the CSS width is the
 * caller's and the height follows the ratio.
 */
const WORDMARK_WIDTH = 900;
const WORDMARK_HEIGHT = 154;

/** Usable logo width per place in the chrome. */
const LOCATION_CLASS = {
  sidebar: 'w-[208px]',
  drawer: 'w-[188px]',
} as const;

/**
 * An agency's wordmark, laid out for the product's chrome: the navy rail and
 * the navy header of the mobile drawer. Sits directly on whatever surface it is
 * told it is on.
 */
export function BrandLockup({
  brand,
  surface,
  location = 'sidebar',
  className,
}: {
  brand: ActiveBrand;
  surface: BrandSurface;
  location?: keyof typeof LOCATION_CLASS;
  className?: string;
}): JSX.Element {
  return (
    <BrandWordmark
      brand={brand}
      surface={surface}
      className={cn(LOCATION_CLASS[location], className)}
    />
  );
}

/**
 * An agency's wordmark at any width: the sign-in page's panel and header, and
 * the chrome lockup above. Width is the caller's (`className`), height follows
 * the artwork's ratio -- never stretched, never cropped.
 */
export function BrandWordmark({
  brand,
  surface,
  className,
}: {
  brand: ActiveBrand;
  surface: BrandSurface;
  className?: string;
}): JSX.Element {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={surface === 'dark' ? brand.wordmarkOnDark : brand.wordmark}
      alt={brand.name}
      width={brand.wordmarkSize?.width ?? WORDMARK_WIDTH}
      height={brand.wordmarkSize?.height ?? WORDMARK_HEIGHT}
      className={cn('block h-auto max-w-full select-none', className)}
      draggable={false}
      translate="no"
      data-testid="brand-logo"
    />
  );
}
