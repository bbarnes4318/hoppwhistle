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
