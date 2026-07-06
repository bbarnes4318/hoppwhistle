'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

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
        'w-full p-3 md:p-4 gap-3 bg-background text-foreground flex flex-col min-h-0',
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
  title: string;
  subtitle?: string;
  icon?: React.ComponentType<{ className?: string }>;
  children?: React.ReactNode;
}

/**
 * A standardized compact header (40-48px height) for dashboard pages.
 */
export function CompactPageHeader({
  title,
  subtitle,
  icon: Icon,
  children,
}: CompactPageHeaderProps) {
  return (
    <div className="flex flex-row items-center justify-between border-b border-border/40 pb-2.5 flex-shrink-0">
      <div className="flex items-center gap-2.5">
        {Icon && (
          <div className="w-8 h-8 rounded border border-border bg-card flex items-center justify-center flex-shrink-0">
            <Icon className="w-4 h-4 text-muted-foreground" />
          </div>
        )}
        <div>
          <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
            {title}
          </h1>
          {subtitle && <p className="text-[11px] text-muted-foreground mt-0.5 leading-none">{subtitle}</p>}
        </div>
      </div>
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
        'bg-card border-border/40 shadow-sm flex flex-col min-h-0 overflow-hidden',
        className
      )}
      {...props}
    >
      {(title || Icon || headerActions) && (
        <CardHeader className="p-3 pb-2 flex flex-row items-center justify-between border-b border-border/10 space-y-0 flex-shrink-0">
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
        'flex-1 min-h-0 overflow-auto border border-border/30 bg-card/20 rounded-lg p-2.5',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
