import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Segmented — a sunken track of mutually exclusive choices; the active one is
 * a raised white segment. Presentational only: each segment is an ordinary
 * button, so a page keeps its own click handler on each one exactly as it was.
 */
export function Segmented({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-control bg-sunken p-1',
        className
      )}
      {...props}
    />
  );
}

export interface SegmentedItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
}

export const SegmentedItem = React.forwardRef<HTMLButtonElement, SegmentedItemProps>(
  ({ active = false, className, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex h-7 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-[6px] px-3 text-sm font-medium',
        'transition-[color,background-color,box-shadow] duration-150 ease-out ne-motion',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:text-ink-3',
        '[@media(pointer:coarse)]:min-h-[40px]',
        active ? 'bg-surface text-ink shadow-card' : 'text-ink-2 hover:text-ink',
        className
      )}
      {...props}
    />
  )
);
SegmentedItem.displayName = 'SegmentedItem';
