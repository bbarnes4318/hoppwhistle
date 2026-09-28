'use client';

import { Search, X } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * Toolbar — a page's filters and actions on ONE row.
 *
 * ── Why this exists next to FilterBar ────────────────────────────────────────
 *
 * FilterBar lays its controls out as a grid with a 168px floor per select, so
 * any page with more than four filters spills onto a second row and a page of
 * data starts a third of the way down the screen. This is the opposite
 * trade: every control shares the row's width, a select shows its category
 * name ("Campaign") until it is set and truncates rather than wraps, and the
 * page's own actions sit at the right end of the same row. Below xl the row
 * wraps, so nothing is clipped on a narrow screen.
 *
 * A control that is narrowing the data is tinted, and ToolbarClear appears
 * only when something is — so what the page is scoped to reads at a glance
 * without a second row of chips.
 */

export function Toolbar({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="toolbar"
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-card border border-rule bg-surface p-2 shadow-card xl:flex-nowrap',
        className
      )}
      {...props}
    />
  );
}

/** The width rule every filter cell shares. Half a row on a phone. */
export const TOOLBAR_CELL =
  'min-w-[calc(50%-4px)] flex-1 sm:min-w-[140px] xl:min-w-[64px] xl:max-w-[200px]';

/** Classes for a select trigger in the toolbar; `active` tints a set filter. */
export function toolbarTrigger(active: boolean): string {
  return cn(
    'h-8 w-full min-w-0 gap-1 px-2.5 text-xs [&>span]:truncate',
    active ? 'border-brand-ink bg-brand-tint text-brand-ink' : 'text-ink-2'
  );
}

export interface ToolbarSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function ToolbarSearch({ value, onChange, placeholder, className }: ToolbarSearchProps) {
  return (
    <div
      className={cn(
        'relative min-w-full flex-[1.6] sm:min-w-[200px] xl:min-w-[140px]',
        className
      )}
    >
      <Search
        aria-hidden
        className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3"
      />
      <Input
        type="search"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder ?? 'Search…'}
        aria-label={placeholder ?? 'Search'}
        className={cn('h-8 pl-8 text-xs', value && 'border-brand-ink')}
      />
    </div>
  );
}

export interface ToolbarSelectOption {
  value: string;
  label: string;
}

export interface ToolbarSelectProps {
  /** The category, shown on the trigger while nothing is chosen. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: ToolbarSelectOption[];
  /**
   * The value meaning "no filter". Shown as `label` on the trigger and as
   * `allLabel` in the menu. Pass null for a select that always has a value
   * (a period picker), which is then never tinted as a filter.
   */
  allValue?: string | null;
  /** The menu's "no filter" entry, e.g. "All campaigns". */
  allLabel?: string;
  className?: string;
}

export function ToolbarSelect({
  label,
  value,
  onChange,
  options,
  allValue = 'all',
  allLabel,
  className,
}: ToolbarSelectProps) {
  const unset = allValue !== null && value === allValue;

  return (
    <div className={cn(TOOLBAR_CELL, className)}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label={label} className={toolbarTrigger(allValue !== null && !unset)}>
          <SelectValue>{unset ? label : undefined}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {allValue !== null ? (
            <SelectItem value={allValue}>{allLabel ?? `All ${label.toLowerCase()}`}</SelectItem>
          ) : null}
          {options.map(o => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export interface ToolbarDateRangeProps {
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  className?: string;
}

/** Two compact date inputs joined by a dash. */
export function ToolbarDateRange({
  from,
  to,
  onFromChange,
  onToChange,
  className,
}: ToolbarDateRangeProps) {
  return (
    <div className={cn('flex min-w-full shrink-0 items-center gap-1 sm:min-w-0', className)}>
      <Input
        type="date"
        aria-label="From date"
        value={from}
        onChange={e => onFromChange(e.target.value)}
        className="h-8 w-full px-2 text-xs sm:w-[128px]"
      />
      <span aria-hidden className="t-meta text-ink-3">
        –
      </span>
      <Input
        type="date"
        aria-label="To date"
        value={to}
        onChange={e => onToChange(e.target.value)}
        className="h-8 w-full px-2 text-xs sm:w-[128px]"
      />
    </div>
  );
}

/** The page's actions, pinned to the right end of the row. */
export function ToolbarActions({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'ml-auto flex shrink-0 items-center gap-1 xl:border-l xl:border-rule xl:pl-2',
        className
      )}
      {...props}
    />
  );
}

/** Clears every filter. Render it only while something is filtered. */
export function ToolbarClear({ onClick }: { onClick: () => void }) {
  return (
    <Tooltip content="Clear all filters">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onClick}
        aria-label="Clear all filters"
        className="h-8 w-8 p-0 text-ink-3 hover:text-ink"
      >
        <X className="h-4 w-4" />
      </Button>
    </Tooltip>
  );
}

/** Compact text for a short status or count sitting in the toolbar. */
export function ToolbarMeta({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn('t-meta shrink-0 whitespace-nowrap px-1 text-ink-3 tabular-nums', className)}
      {...props}
    />
  );
}
