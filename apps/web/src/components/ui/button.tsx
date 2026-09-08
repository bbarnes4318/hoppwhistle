import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
 'inline-flex items-center justify-center whitespace-nowrap rounded-control text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
 {
 variants: {
 variant: {
 default: 'bg-brand text-brand-fg hover:bg-brand-ink hover:text-surface',
 destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
 outline:
 'border border-rule bg-surface text-ink hover:bg-sunken',
 secondary: 'bg-sunken text-ink hover:bg-rule',
 ghost: 'text-ink-2 hover:bg-sunken hover:text-ink',
 link: 'text-brand-ink underline-offset-4 hover:underline',
 },
 size: {
 default: 'h-9 px-4 py-2',
 sm: 'h-8 rounded-control px-3',
 lg: 'h-11 rounded-control px-8',
 icon: 'h-9 w-9',
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

