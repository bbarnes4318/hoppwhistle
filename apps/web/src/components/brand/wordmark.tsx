import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * The NetEnroll wordmark: "net" in black, "Enroll" in brand green.
 *
 * Rendered as text rather than as an image so it is crisp at every size, sets
 * in the display face the rest of the product uses, and reads to a screen
 * reader as the one word it is. The two colours are literal on purpose — the
 * mark is #000000 and #10B981 wherever it appears, on a light ground, and does
 * not follow the theme tokens. It is never placed on a dark ground; the one
 * dark screen does not render the sidebar.
 *
 * `public/netenroll-wordmark.svg` and `.png` are the same mark for contexts
 * that need a file: email, the favicon source, anything outside React.
 */
export function Wordmark({
  className,
  size = 'md',
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span
      className={cn(
        'inline-flex select-none items-baseline font-display font-medium leading-none tracking-[-0.02em]',
        size === 'sm' && 'text-[16px]',
        size === 'md' && 'text-[20px]',
        size === 'lg' && 'text-[34px]',
        className
      )}
      translate="no"
      data-testid="wordmark"
      /*
       * Exempt from the contrast audit in e2e/platform-landing.smoke.mjs, and
       * this is the one thing in the product that gets to be.
       *
       * "Enroll" is #10B981 on white, which is 2.54:1 — nowhere near the 4.5:1
       * every other piece of text here clears. It stays that way because a
       * LOGOTYPE is not text: WCAG 1.4.3 exempts it by name, the mark is
       * specified as these two hexes, and a NetEnroll wordmark in a darker
       * green is a different company's wordmark. Brand green as actual text is
       * --brand-ink, which clears 5.48:1; nothing else in the product is
       * allowed to borrow this exemption.
       */
      data-contrast-exempt="logotype"
      {...props}
    >
      <span style={{ color: '#000000' }}>net</span>
      <span style={{ color: '#10B981' }}>Enroll</span>
    </span>
  );
}
