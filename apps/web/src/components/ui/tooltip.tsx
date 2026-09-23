import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Tooltip — a small ink label shown on hover and on keyboard focus.
 *
 * Deliberately CSS-only. The text is carried in `data-tooltip` and painted by
 * a ::after pseudo-element (see .ne-tooltip in globals.css), so it adds no
 * node to the document: the wrapped control keeps exactly the accessible
 * name it already had, and no string appears twice for a test to trip over.
 * Pass the control's existing label or title text as `content`.
 */
export interface TooltipProps extends React.HTMLAttributes<HTMLSpanElement> {
  content: string;
  /** Which side of the trigger the label appears on. */
  side?: 'bottom' | 'top';
  /** `end` pins the label's right edge to the trigger's, for controls at a right edge. */
  align?: 'center' | 'end';
}

export function Tooltip({
  content,
  side = 'bottom',
  align = 'center',
  className,
  children,
  ...props
}: TooltipProps) {
  return (
    <span
      className={cn('ne-tooltip', className)}
      data-tooltip={content}
      data-tooltip-side={side}
      data-tooltip-align={align}
      {...props}
    >
      {children}
    </span>
  );
}
