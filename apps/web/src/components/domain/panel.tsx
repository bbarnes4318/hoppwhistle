import * as React from 'react';

import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * Panel — the only card wrapper in the product.
 *
 * Composes shadcn's Card and drops its shadow: two flat surfaces are separated
 * by a hairline, never by a shadow. Every panel on every screen is this
 * component, which is what stops screens drifting apart.
 */

export const Panel = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <Card
      ref={ref}
      className={cn('rounded-card border-rule bg-surface text-ink shadow-none', className)}
      {...props}
    />
  )
);
Panel.displayName = 'Panel';

export interface PanelHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Rendered at the right of the header — filters, a link, a count. */
  action?: React.ReactNode;
}

export const PanelHeader = React.forwardRef<HTMLDivElement, PanelHeaderProps>(
  ({ className, children, action, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex items-center justify-between gap-3 border-b border-rule px-4 py-3',
        className
      )}
      {...props}
    >
      <div className="min-w-0">{children}</div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
);
PanelHeader.displayName = 'PanelHeader';

export const PanelTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h2 ref={ref} className={cn('t-section text-ink', className)} {...props} />
));
PanelTitle.displayName = 'PanelTitle';

export const PanelDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('t-meta mt-0.5 text-ink-3', className)} {...props} />
));
PanelDescription.displayName = 'PanelDescription';

export interface PanelBodyProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Drop the padding — for a DataTable, which manages its own edges. */
  flush?: boolean;
}

export const PanelBody = React.forwardRef<HTMLDivElement, PanelBodyProps>(
  ({ className, flush = false, ...props }, ref) => (
    <div ref={ref} className={cn(flush ? 'p-0' : 'p-4', className)} {...props} />
  )
);
PanelBody.displayName = 'PanelBody';
