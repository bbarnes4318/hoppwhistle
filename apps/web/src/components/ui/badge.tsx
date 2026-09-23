import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Badge — a 22px pill, 12px medium. Tones follow the status-tone palette:
 * each tint carries its own -ink text, contrast-checked in globals.css.
 */
const badgeVariants = cva(
  'inline-flex h-[22px] shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 text-[12px] font-medium leading-none transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-brand-tint text-brand-ink',
        secondary: 'border-transparent bg-sunken text-ink-2',
        destructive: 'border-transparent bg-dropped-tint text-dropped-ink',
        outline: 'border-rule-strong bg-surface text-ink-2',
        success: 'border-transparent bg-live-tint text-live-ink',
        warning: 'border-transparent bg-ringing-tint text-ringing-ink',
        info: 'border-transparent bg-money-tint text-money-ink',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
