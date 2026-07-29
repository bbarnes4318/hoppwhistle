'use client';

import React from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

// ============================================================================
// Layout Helpers for a Dense, Viewport-Aligned SaaS Console UI
// ============================================================================

interface CompactPageShellProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  fullHeight?: boolean;
}

/**
 * Page container. Locks to the viewport, keeps padding consistent across every
 * screen, and fades content in so navigation never feels like a hard cut.
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
        'flex w-full min-h-0 flex-col gap-4 bg-transparent p-4 text-foreground md:p-6',
        'animate-in-up',
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
 * Standard page header. The icon sits in a tinted, softly glowing tile so each
 * page has a clear anchor point without shouting.
 */
export function CompactPageHeader({
  title,
  subtitle,
  icon: Icon,
  children,
}: CompactPageHeaderProps) {
  return (
    <div className="flex flex-shrink-0 flex-row items-center justify-between gap-4 border-b border-border pb-4">
      <div className="flex min-w-0 items-center gap-3">
        {Icon && (
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 shadow-inset">
            <Icon className="h-[18px] w-[18px] text-primary" />
          </div>
        )}
        <div className="min-w-0">
          <h1 className="truncate text-[19px] font-semibold leading-tight tracking-[-0.02em] text-foreground">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-0.5 truncate text-xs leading-tight text-muted-foreground">
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {children && <div className="flex flex-shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}

interface DenseCardProps extends React.ComponentProps<typeof Card> {
  title?: string;
  icon?: React.ComponentType<{ className?: string }>;
  headerActions?: React.ReactNode;
}

/**
 * Panel with a tightened header and an internally scrolling body.
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
    <Card className={cn('flex min-h-0 flex-col overflow-hidden', className)} {...props}>
      {(title || Icon || headerActions) && (
        <CardHeader className="flex flex-shrink-0 flex-row items-center justify-between space-y-0 border-b border-border px-4 py-3">
          <CardTitle className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-eyebrow text-muted-foreground">
            {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground/80" />}
            {title}
          </CardTitle>
          {headerActions && <div className="flex items-center gap-1.5">{headerActions}</div>}
        </CardHeader>
      )}
      <CardContent className="custom-scrollbar min-h-0 flex-1 overflow-auto p-4">
        {children}
      </CardContent>
    </Card>
  );
}

/**
 * Metrics grid container, cleanly lining up KPI components.
 */
export function MetricStrip({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'grid flex-shrink-0 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6',
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
        'surface-flush custom-scrollbar min-h-0 flex-1 overflow-auto p-3',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * Empty state. A quiet, well-composed nothing beats a bare "No data" string.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center px-6 py-14 text-center',
        className
      )}
    >
      {Icon && (
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface-raised">
          <Icon className="h-5 w-5 text-muted-foreground/70" />
        </div>
      )}
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {description && (
        <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
