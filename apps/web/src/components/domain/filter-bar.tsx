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
import { cn } from '@/lib/utils';

import { useThemeScope } from './theme-scope';

/**
 * FilterBar — search, selects, date range, and chips for what is active.
 *
 * The chips are the important part. A filtered table that does not say it is
 * filtered is how someone concludes their calls have disappeared, and the
 * cheapest fix is to always show what is currently narrowing the list, each one
 * removable on its own.
 */

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterSelect {
  id: string;
  label: string;
  options: FilterOption[];
  value: string | null;
  /** Text for the "no selection" entry, e.g. "All buyers". */
  allLabel?: string;
}

export type DateRangeValue = { from: string | null; to: string | null };

export interface FilterBarProps {
  search?: {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
  };
  selects?: FilterSelect[];
  onSelectChange?: (id: string, value: string | null) => void;
  dateRange?: {
    value: DateRangeValue;
    onChange: (v: DateRangeValue) => void;
  };
  /** Cleared by "Clear all" and by each chip's own dismiss. */
  onClearAll?: () => void;
  /** Extra controls — SavedViews, an export button. */
  children?: React.ReactNode;
  className?: string;
}

/**
 * Radix Select has no empty-string value, so the "all" entry needs a sentinel.
 * It is converted back to null at the boundary and never leaves this file.
 */
const ALL = '__all__';

export function FilterBar({
  search,
  selects = [],
  onSelectChange,
  dateRange,
  onClearAll,
  children,
  className,
}: FilterBarProps) {
  // SelectContent is portalled — carry the theme scope onto each menu.
  const theme = useThemeScope();
  const activeChips: { id: string; label: string; onRemove: () => void }[] = [];

  for (const s of selects) {
    if (!s.value) continue;
    const opt = s.options.find(o => o.value === s.value);
    activeChips.push({
      id: s.id,
      label: `${s.label}: ${opt?.label ?? s.value}`,
      onRemove: () => onSelectChange?.(s.id, null),
    });
  }

  if (dateRange?.value.from || dateRange?.value.to) {
    activeChips.push({
      id: '__date__',
      label: `Date: ${dateRange.value.from ?? 'any'} → ${dateRange.value.to ?? 'any'}`,
      onRemove: () => dateRange.onChange({ from: null, to: null }),
    });
  }

  if (search?.value) {
    activeChips.push({
      id: '__search__',
      label: `Search: ${search.value}`,
      onRemove: () => search.onChange(''),
    });
  }

  return (
    <div className={cn('border-b border-rule', className)}>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        {search ? (
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3"
            />
            <Input
              type="search"
              value={search.value}
              onChange={e => search.onChange(e.target.value)}
              placeholder={search.placeholder ?? 'Search'}
              aria-label={search.placeholder ?? 'Search'}
              className="h-8 rounded-control border-rule bg-surface pl-7 t-body text-ink placeholder:text-ink-3"
            />
          </div>
        ) : null}

        {selects.map(s => (
          <Select
            key={s.id}
            value={s.value ?? ALL}
            onValueChange={v => onSelectChange?.(s.id, v === ALL ? null : v)}
          >
            <SelectTrigger
              aria-label={s.label}
              className="h-8 w-auto min-w-[128px] gap-1 rounded-control border-rule bg-surface t-body text-ink"
            >
              <SelectValue placeholder={s.allLabel ?? `All ${s.label.toLowerCase()}`} />
            </SelectTrigger>
            <SelectContent data-theme={theme}>
              <SelectItem value={ALL} className="t-body">
                {s.allLabel ?? `All ${s.label.toLowerCase()}`}
              </SelectItem>
              {s.options.map(o => (
                <SelectItem key={o.value} value={o.value} className="t-body">
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ))}

        {dateRange ? (
          <div className="flex items-center gap-1">
            <Input
              type="date"
              aria-label="From date"
              value={dateRange.value.from ?? ''}
              onChange={e =>
                dateRange.onChange({ ...dateRange.value, from: e.target.value || null })
              }
              className="h-8 w-[140px] rounded-control border-rule bg-surface t-data text-ink"
            />
            <span aria-hidden className="t-meta text-ink-3">
              →
            </span>
            <Input
              type="date"
              aria-label="To date"
              value={dateRange.value.to ?? ''}
              onChange={e => dateRange.onChange({ ...dateRange.value, to: e.target.value || null })}
              className="h-8 w-[140px] rounded-control border-rule bg-surface t-data text-ink"
            />
          </div>
        ) : null}

        {children ? <div className="ml-auto flex items-center gap-2">{children}</div> : null}
      </div>

      {activeChips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2">
          <span className="t-label text-ink-3">Filtered by</span>

          {activeChips.map(chip => (
            <span
              key={chip.id}
              className="t-meta inline-flex max-w-[240px] items-center gap-1 rounded-control bg-sunken py-0.5 pl-2 pr-1 text-ink-2"
            >
              <span className="truncate">{chip.label}</span>
              <button
                type="button"
                onClick={chip.onRemove}
                aria-label={`Remove filter ${chip.label}`}
                className="shrink-0 rounded-control p-0.5 text-ink-3 hover:bg-rule hover:text-ink focus-visible:outline-none"
              >
                <X aria-hidden className="h-3 w-3" />
              </button>
            </span>
          ))}

          {onClearAll ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClearAll}
              className="t-meta h-6 rounded-control px-1.5 text-ink-3 hover:bg-sunken hover:text-ink"
            >
              Clear all
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
