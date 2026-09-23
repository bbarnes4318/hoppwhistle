'use client';

import React from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

// ============================================================================
// Layout Helpers for Denser, Viewport-Aligned SaaS Console UI
// ============================================================================

interface CompactPageShellProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  fullHeight?: boolean;
}

/**
 * A container page shell that locks the viewport height, uses compact padding,
 * and organizes child components vertically.
 */
export function CompactPageShell({
  children,
  className,
  fullHeight = true,
  ...props
}: CompactPageShellProps) {
  return (
    <div
      className={cn(
        'w-full p-4 md:p-5 gap-4 bg-paper text-ink flex flex-col min-h-0',
        fullHeight ? 'h-full overflow-hidden' : 'h-auto overflow-y-auto',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

interface CompactPageHeaderProps {
  /** A context line: the range being shown, the day, the agency. Not a title. */
  subtitle?: React.ReactNode;
  /** The page's actions, right-aligned. */
  children?: React.ReactNode;
}

/**
 * The bar across the top of a page's CONTENT: its context line and its actions.
 *
 * ── It does not carry the page title, and that is the point ──────────────────
 *
 * It used to. So does the topbar, from `pageTitleFor(pathname)`. Both rendered
 * `<h1 className="t-title">` with the same words in the same face, one directly
 * above the other, on every screen under the dashboard -- "Delivery" over
 * "Delivery", "Applications" over "Applications". Several pages then opened
 * with a section heading as well, so the name of the page could appear three
 * times before any data did.
 *
 * Two `<h1>`s in one document is also simply wrong. A screen reader announces
 * the document's heading twice and the outline has no single root; every page
 * in this app had that.
 *
 * So the title is the topbar's, once, and it is derived from the nav -- see
 * `page-title.ts`, which is why renaming a sidebar entry renames the heading
 * and the browser tab with it. What is left here is what a title never was:
 * the line that says WHICH day or range is on screen, and the buttons that act
 * on it.
 *
 * Rendering nothing when given neither keeps a page that only wanted a title
 * from drawing an empty rule across the top of itself.
 */
export function CompactPageHeader({ subtitle, children }: CompactPageHeaderProps) {
  if (!subtitle && !children) return null;

  return (
    <div className="flex flex-row items-center justify-between gap-3 border-b border-rule pb-3 flex-shrink-0">
      {subtitle ? <p className="t-meta text-ink-3">{subtitle}</p> : <span />}
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}

interface DenseCardProps extends React.ComponentProps<typeof Card> {
  title?: string;
  icon?: React.ComponentType<{ className?: string }>;
  headerActions?: React.ReactNode;
}

/**
 * Card component with tightened padding and rigid vertical flex layout.
 */
export function DenseCard({
  title,
  icon: Icon,
  headerActions,
  children,
  className,
  ...props
}: DenseCardProps) {
  return (
    <Card
      className={cn(
        'bg-surface border-rule shadow-none flex flex-col min-h-0 overflow-hidden',
        className
      )}
      {...props}
    >
      {(title || Icon || headerActions) && (
        <CardHeader className="p-3 pb-2 flex flex-row items-center justify-between border-b border-rule space-y-0 flex-shrink-0">
          <CardTitle className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {Icon && <Icon className="w-3.5 h-3.5" />}
            {title}
          </CardTitle>
          {headerActions && <div>{headerActions}</div>}
        </CardHeader>
      )}
      <CardContent className="p-3 flex-1 min-h-0 overflow-auto">{children}</CardContent>
    </Card>
  );
}

/**
 * Metrics grid container, cleanly lining up KPI components.
 */
export function MetricStrip({ children, className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 flex-shrink-0',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * Rigid data panel wrapper for lists or tables scrolling internally.
 */
export function DataPanel({ children, className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex-1 min-h-0 overflow-auto border border-rule bg-surface rounded-card p-2.5',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
