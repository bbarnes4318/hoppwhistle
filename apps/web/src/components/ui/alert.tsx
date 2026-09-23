import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Alert — every notice on a page. A tinted card with a 4px bar in the tone
 * colour down its left edge, an 18px icon, a bold first line (AlertTitle)
 * and the body in ink-2.
 *
 *   warning      ringing-tint, ringing bar and icon
 *   info         money-tint, money bar and icon
 *   destructive  dropped-tint, dropped bar and icon ("error")
 *   default      sunken, neutral bar
 */
const alertVariants = cva(
  [
    'relative w-full rounded-card border px-4 py-3 text-sm text-ink-2',
    '[&>svg]:absolute [&>svg]:left-4 [&>svg]:top-3.5 [&>svg]:h-[18px] [&>svg]:w-[18px] [&>svg~*]:pl-7',
  ].join(' '),
  {
    variants: {
      variant: {
        default: 'border-rule bg-sunken shadow-[inset_4px_0_0_0_var(--ink-3)] [&>svg]:text-ink-3',
        destructive:
          'border-transparent bg-dropped-tint shadow-[inset_4px_0_0_0_var(--dropped)] [&>svg]:text-dropped',
        error:
          'border-transparent bg-dropped-tint shadow-[inset_4px_0_0_0_var(--dropped)] [&>svg]:text-dropped',
        warning:
          'border-transparent bg-ringing-tint shadow-[inset_4px_0_0_0_var(--ringing)] [&>svg]:text-ringing-ink',
        info: 'border-transparent bg-money-tint shadow-[inset_4px_0_0_0_var(--money)] [&>svg]:text-money',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
));
Alert.displayName = 'Alert';

const AlertTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h5 ref={ref} className={cn('mb-0.5 font-semibold leading-snug text-ink', className)} {...props} />
));
AlertTitle.displayName = 'AlertTitle';

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('text-sm text-ink-2 [&_p]:leading-relaxed', className)}
    {...props}
  />
));
AlertDescription.displayName = 'AlertDescription';

export { Alert, AlertTitle, AlertDescription, alertVariants };
