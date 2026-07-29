import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Shimmering placeholder. A travelling highlight reads as "loading" far more
 * clearly than a pulsing block, and looks considerably less cheap.
 */
const Skeleton = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('relative overflow-hidden rounded-md bg-muted/70', className)}
      {...props}
    >
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
    </div>
  )
);
Skeleton.displayName = 'Skeleton';

export { Skeleton };
