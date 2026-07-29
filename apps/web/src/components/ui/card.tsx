import * as React from 'react';

import { cn } from '@/lib/utils';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Flush cards sit lower in the elevation stack — use inside another card. */
  variant?: 'default' | 'flush' | 'glass';
  /** Lift slightly on hover. Only for cards that are actually clickable. */
  interactive?: boolean;
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant = 'default', interactive = false, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'rounded-lg text-card-foreground',
        variant === 'default' && 'surface',
        variant === 'flush' && 'surface-flush',
        variant === 'glass' && 'glass rounded-lg border border-border shadow-elevate',
        interactive &&
          'cursor-pointer transition-all duration-200 ease-premium hover:-translate-y-0.5 hover:border-border-strong hover:shadow-float',
        className
      )}
      {...props}
    />
  )
);
Card.displayName = 'Card';

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col space-y-1.5 p-5', className)} {...props} />
  )
);
CardHeader.displayName = 'CardHeader';

const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn('text-base font-semibold leading-none tracking-tight', className)}
      {...props}
    />
  )
);
CardTitle.displayName = 'CardTitle';

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn('text-[13px] leading-relaxed text-muted-foreground', className)}
    {...props}
  />
));
CardDescription.displayName = 'CardDescription';

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-5 pt-0', className)} {...props} />
  )
);
CardContent.displayName = 'CardContent';

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex items-center gap-2 border-t border-border/60 px-5 py-3.5', className)}
      {...props}
    />
  )
);
CardFooter.displayName = 'CardFooter';

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
