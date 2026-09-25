import type { ActiveBrand } from '@/lib/brand-themes';
import { cn } from '@/lib/utils';

/**
 * An agency's logo, laid out for the product's chrome.
 *
 * The supplied artwork is a stacked, near-square lockup: a glossy icon with
 * the wordmark tucked beside it. Scaled into a 248px rail it went to 96px tall
 * and the wordmark became unreadable, and its navy lettering disappears
 * entirely on a navy ground. So the chrome uses the two halves separately,
 * cut from that same artwork:
 *
 *   the icon     on a white app-icon tile, which keeps its navy shading
 *                legible on any ground
 *   the wordmark reversed out to white (`tone="dark"`) for the navy column,
 *                or in the artwork's own colours (`tone="light"`)
 *
 * The full lockup (`brand.logo`) is still the logo; this is how it sits in a
 * sidebar.
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
      className={cn('inline-flex select-none items-center', md ? 'gap-3' : 'gap-2.5', className)}
      translate="no"
    >
      <span
        className={cn(
          'grid shrink-0 place-items-center bg-white',
          md ? 'h-[52px] w-[52px] rounded-[12px]' : 'h-9 w-9 rounded-[8px]',
          tone === 'dark'
            ? 'shadow-[0_1px_2px_rgba(0,0,0,0.3),0_0_0_1px_rgba(255,255,255,0.12)]'
            : 'shadow-[0_1px_2px_rgba(15,23,42,0.08)] ring-1 ring-rule'
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={brand.markSmall}
          alt=""
          aria-hidden="true"
          className={md ? 'h-11 w-11' : 'h-7 w-7'}
          draggable={false}
        />
      </span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={tone === 'dark' ? brand.wordmarkOnDark : brand.wordmark}
        alt={brand.name}
        className={cn('w-auto', md ? 'h-[62px]' : 'h-[38px]')}
        draggable={false}
        data-testid="brand-logo"
      />
    </span>
  );
}
