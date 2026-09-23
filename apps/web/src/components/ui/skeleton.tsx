import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Skeleton — the sunken ground with a soft shimmer passing over it. The
 * shimmer is switched off under prefers-reduced-motion (see .ne-shimmer in
 * globals.css), leaving a still placeholder.
 */
const Skeleton = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('ne-shimmer rounded-control', className)} {...props} />
  )
);
Skeleton.displayName = 'Skeleton';

export { Skeleton };
