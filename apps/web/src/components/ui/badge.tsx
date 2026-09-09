import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
 'inline-flex items-center rounded-control border px-2 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
 {
 variants: {
 variant: {
 default: 'border-transparent bg-brand-tint text-brand-ink',
 secondary: 'border-transparent bg-sunken text-ink-2',
 destructive: 'border-transparent bg-dropped-tint text-dropped-ink',
 outline: 'border-rule text-ink-2',
 success: 'border-transparent bg-live-tint text-live-ink',
 warning: 'border-transparent bg-ringing-tint text-ringing-ink',
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


