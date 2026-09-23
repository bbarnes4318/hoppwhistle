import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Button.
 *
 * The primary fill is --brand-strong with white text (5.48:1), not the bright
 * brand green: #10B981 carries neither white nor legible ink at button size
 * with any authority. Disabled is a quiet sunken control with ink-3 text —
 * never a washed-out green, which reads as "almost available".
 *
 * On a touch screen every size grows to a 40px hit target.
 */
const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control text-sm font-medium',
    'transition-[color,background-color,border-color,box-shadow] duration-150 ease-out ne-motion',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-surface',
    'disabled:cursor-not-allowed disabled:text-ink-3 disabled:shadow-none',
    '[@media(pointer:coarse)]:min-h-[40px]',
  ].join(' '),
  {
    variants: {
      variant: {
        default:
          'bg-brand-strong text-white shadow-card hover:bg-brand-strong-hover disabled:bg-sunken',
        destructive: 'bg-dropped text-white shadow-card hover:bg-dropped-ink disabled:bg-sunken',
        outline:
          'border border-rule-strong bg-surface text-ink shadow-card hover:bg-sunken disabled:border-rule disabled:bg-sunken',
        secondary:
          'border border-rule-strong bg-surface text-ink shadow-card hover:bg-sunken disabled:border-rule disabled:bg-sunken',
        ghost: 'bg-transparent text-ink-2 hover:bg-sunken hover:text-ink',
        link: 'text-brand-ink underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4',
        sm: 'h-8 px-3',
        lg: 'h-11 px-6',
        icon: 'h-9 w-9 p-0 [@media(pointer:coarse)]:min-w-[40px]',
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
