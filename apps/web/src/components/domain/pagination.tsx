'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

/**
 * Pagination — one implementation, replacing the three hand-rolled ones.
 *
 * States the range in words ("1–50 of 1,284") because "page 3" answers a
 * question nobody asked. Counts are mono and tabular so the numbers do not
 * jitter as you page through.
 */

export interface PaginationProps {
  /** 1-based. */
  page: number;
  pageSize: number;
  /** Total matching rows. `null` when the API does not return a count. */
  total: number | null;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
  /** What is being counted: "calls", "publishers". Used in the range label. */
  noun?: string;
  disabled?: boolean;
  className?: string;
}

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [25, 50, 100, 200],
  noun = 'rows',
  disabled = false,
  className,
}: PaginationProps) {
  const lastPage = total === null ? null : Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = total === null ? page * pageSize : Math.min(page * pageSize, total);

  const canPrev = page > 1 && !disabled;
  // Without a total we cannot know if there is a next page. Staying enabled and
  // landing on an empty page is better than disabling a page that does exist.
  const canNext = (lastPage === null ? true : page < lastPage) && !disabled;

  const fmt = (n: number) => n.toLocaleString('en-US');

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 border-t border-rule px-3 py-2',
        className
      )}
    >
      <p className="t-meta text-ink-3">
        {total === 0 ? (
          <>No {noun}</>
        ) : (
          <>
            <span className="t-data tabular text-ink-2">
              {fmt(first)}–{fmt(last)}
            </span>{' '}
            of{' '}
            <span className="t-data tabular text-ink-2">
              {total === null ? 'many' : fmt(total)}
            </span>{' '}
            {noun}
          </>
        )}
      </p>

      <div className="flex items-center gap-2">
        {onPageSizeChange ? (
          <label className="flex items-center gap-1.5">
            <span className="t-meta text-ink-3">Per page</span>
            <Select
              value={String(pageSize)}
              onValueChange={v => onPageSizeChange(Number(v))}
              disabled={disabled}
            >
              <SelectTrigger className="h-7 w-[72px] rounded-control border-rule bg-surface t-data text-ink">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pageSizeOptions.map(n => (
                  <SelectItem key={n} value={String(n)} className="t-data">
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        ) : null}

        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 rounded-control border-rule px-2 text-ink disabled:opacity-40"
            onClick={() => onPageChange(page - 1)}
            disabled={!canPrev}
            aria-label="Previous page"
          >
            <ChevronLeft aria-hidden className="h-4 w-4" />
          </Button>

          <span className="t-data tabular px-1 text-ink-2" aria-live="polite">
            {page}
            {lastPage !== null ? <span className="text-ink-3"> / {lastPage}</span> : null}
          </span>

          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 rounded-control border-rule px-2 text-ink disabled:opacity-40"
            onClick={() => onPageChange(page + 1)}
            disabled={!canNext}
            aria-label="Next page"
          >
            <ChevronRight aria-hidden className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
