import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md',
    'text-[13px] font-medium tracking-[-0.005em]',
    'ring-offset-background transition-all duration-150 ease-premium',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2',
    // A tactile press instead of a flat state change
    'active:translate-y-px',
    'disabled:pointer-events-none disabled:opacity-45',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  ].join(' '),
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground font-semibold shadow-subtle shadow-inset hover:bg-primary/90 hover:shadow-elevate',
        premium:
          'bg-gradient-to-b from-primary to-primary/85 text-primary-foreground font-semibold shadow-elevate shadow-inset hover:from-primary hover:to-primary hover:shadow-ring-primary',
        gold: 'bg-gold text-gold-foreground font-semibold shadow-subtle shadow-inset hover:bg-gold/90',
        destructive:
          'bg-destructive text-destructive-foreground font-semibold shadow-subtle hover:bg-destructive/90',
        outline:
          'border border-border bg-surface/40 text-foreground shadow-subtle hover:border-border-strong hover:bg-surface-raised',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/75',
        ghost: 'text-muted-foreground hover:bg-muted/70 hover:text-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2',
        xs: 'h-7 rounded-sm px-2.5 text-xs',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-11 rounded-lg px-7 text-sm',
        icon: 'h-9 w-9',
        'icon-sm': 'h-7 w-7 rounded-sm',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
