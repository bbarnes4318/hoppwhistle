import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  [
    'inline-flex items-center gap-1.5 rounded-full border',
    'px-2.5 py-0.5 text-[11px] font-semibold leading-5 tracking-[-0.005em]',
    'transition-colors focus:outline-none focus:ring-2 focus:ring-ring/60 focus:ring-offset-1 focus:ring-offset-background',
  ].join(' '),
  {
    variants: {
      variant: {
        // Tinted-fill status pills read better on dark than solid blocks
        default: 'border-primary/25 bg-primary/12 text-primary',
        solid: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-border bg-secondary text-secondary-foreground',
        destructive: 'border-destructive/25 bg-destructive/12 text-destructive',
        outline: 'border-border-strong bg-transparent text-muted-foreground',
        success: 'border-emerald-500/25 bg-emerald-500/12 text-emerald-400',
        warning: 'border-amber-500/25 bg-amber-500/12 text-amber-400',
        info: 'border-sky-500/25 bg-sky-500/12 text-sky-400',
        gold: 'border-gold/30 bg-gold/12 text-gold',
        muted: 'border-border bg-muted/60 text-muted-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {
  /** Render a leading status dot in the badge's own colour. */
  dot?: boolean;
}

function Badge({ className, variant, dot = false, children, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </div>
  );
}

export { Badge, badgeVariants };
