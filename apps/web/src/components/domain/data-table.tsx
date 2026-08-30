'use client';

import * as React from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

import { EmptyState, type EmptyStateProps } from './empty-state';

/**
 * DataTable — the one table in the product.
 *
 * Sticky header, 40px rows, built-in empty and loading states, and keyboard row
 * navigation. Numeric columns are right-aligned and set in the mono face, which
 * is not decoration: a column of durations or money that does not align cannot
 * be compared, and comparing them is the job.
 *
 * KEYBOARD. Arrow up/down move between rows, Home/End jump to the ends, Enter
 * or Space activates. The table body is a single tab stop with roving focus, so
 * tabbing through a page does not mean 200 stops through a call log.
 */

export interface Column<T> {
  /** Stable key. Also the React key for the cell. */
  id: string;
  /** Column head text. Rendered in the label step. */
  header: React.ReactNode;
  /** Cell renderer. */
  cell: (row: T, index: number) => React.ReactNode;
  /**
   * `numeric` right-aligns and sets the mono face — use it for money,
   * durations, counts, rates. `align` overrides if you need to.
   */
  numeric?: boolean;
  align?: 'left' | 'right' | 'center';
  /** CSS width, e.g. '120px' or '20%'. Omit to size to content. */
  width?: string;
  /** Hide below this breakpoint so the table degrades to 768px and below. */
  hideBelow?: 'sm' | 'md' | 'lg';
  /** Header-only class, for a sort affordance or a tighter head. */
  headClassName?: string;
  cellClassName?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  /** Stable identity per row. Index is a last resort, not a default. */
  rowKey: (row: T, index: number) => string;
  loading?: boolean;
  /** Skeleton rows while loading. Match the usual page size. */
  loadingRows?: number;
  /** Shown when `rows` is empty and not loading. */
  empty?: EmptyStateProps;
  /** Row activation — opens the SheetDrawer, usually. */
  onRowActivate?: (row: T, index: number) => void;
  /** Marks a row as currently open in a drawer. */
  isRowActive?: (row: T, index: number) => boolean;
  /** Sticky header. On by default; off inside a short panel. */
  stickyHeader?: boolean;
  /** Accessible name for the table. */
  caption?: string;
  className?: string;
}

const HIDE_BELOW_CLASS = {
  sm: 'hidden sm:table-cell',
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
} as const;

function alignClass(col: Column<unknown>): string {
  const align = col.align ?? (col.numeric ? 'right' : 'left');
  return align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  loadingRows = 8,
  empty,
  onRowActivate,
  isRowActive,
  stickyHeader = true,
  caption,
  className,
}: DataTableProps<T>) {
  const interactive = Boolean(onRowActivate);
  // Roving tabindex: one tab stop for the whole body, arrows move within it.
  const [focusedIndex, setFocusedIndex] = React.useState(0);
  const bodyRef = React.useRef<HTMLTableSectionElement>(null);

  // A shrinking result set must not leave focus pointing past the end.
  React.useEffect(() => {
    setFocusedIndex(i => (rows.length === 0 ? 0 : Math.min(i, rows.length - 1)));
  }, [rows.length]);

  const focusRow = React.useCallback((index: number) => {
    const el = bodyRef.current?.querySelector<HTMLElement>(`[data-row-index="${index}"]`);
    el?.focus();
  }, []);

  const onKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLTableRowElement>, row: T, index: number) => {
      if (!interactive) return;
      let next: number | null = null;

      switch (e.key) {
        case 'ArrowDown':
          next = Math.min(index + 1, rows.length - 1);
          break;
        case 'ArrowUp':
          next = Math.max(index - 1, 0);
          break;
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = rows.length - 1;
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          onRowActivate?.(row, index);
          return;
        default:
          return;
      }

      e.preventDefault();
      setFocusedIndex(next);
      focusRow(next);
    },
    [interactive, onRowActivate, rows.length, focusRow]
  );

  const headCells = columns.map(col => (
    <TableHead
      key={col.id}
      scope="col"
      style={col.width ? { width: col.width } : undefined}
      className={cn(
        't-label h-9 whitespace-nowrap border-b border-rule bg-sunken px-3 py-0 font-medium text-ink-3',
        alignClass(col as Column<unknown>),
        col.hideBelow && HIDE_BELOW_CLASS[col.hideBelow],
        col.headClassName
      )}
    >
      {col.header}
    </TableHead>
  ));

  return (
    <div className={cn('relative w-full overflow-x-auto', className)}>
      <Table className="w-full caption-bottom border-separate border-spacing-0">
        {caption ? <caption className="sr-only">{caption}</caption> : null}

        <TableHeader className={cn(stickyHeader && 'sticky top-0 z-10')}>
          <TableRow className="border-0 hover:bg-transparent">{headCells}</TableRow>
        </TableHeader>

        <TableBody ref={bodyRef}>
          {loading ? (
            Array.from({ length: loadingRows }).map((_, i) => (
              <TableRow key={`skeleton-${i}`} className="h-row border-0 hover:bg-transparent">
                {columns.map(col => (
                  <TableCell
                    key={col.id}
                    className={cn(
                      'h-row border-b border-rule px-3 py-0',
                      col.hideBelow && HIDE_BELOW_CLASS[col.hideBelow]
                    )}
                  >
                    <Skeleton
                      className={cn('h-3 rounded-control', col.numeric ? 'ml-auto w-16' : 'w-28')}
                    />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : rows.length === 0 ? (
            <TableRow className="border-0 hover:bg-transparent">
              <TableCell colSpan={columns.length} className="border-b border-rule p-0">
                <EmptyState
                  headline={empty?.headline ?? 'Nothing here yet'}
                  body={empty?.body}
                  icon={empty?.icon}
                  action={empty?.action}
                  secondaryAction={empty?.secondaryAction}
                  variant={empty?.variant}
                />
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row, index) => {
              const active = isRowActive?.(row, index) ?? false;
              return (
                <TableRow
                  key={rowKey(row, index)}
                  data-row-index={index}
                  tabIndex={interactive ? (index === focusedIndex ? 0 : -1) : undefined}
                  role={interactive ? 'button' : undefined}
                  aria-current={active ? 'true' : undefined}
                  onClick={interactive ? () => onRowActivate?.(row, index) : undefined}
                  onFocus={interactive ? () => setFocusedIndex(index) : undefined}
                  onKeyDown={e => onKeyDown(e, row, index)}
                  className={cn(
                    'h-row border-0',
                    interactive && 'cursor-pointer',
                    // The focus ring is inset because a table row cannot carry
                    // an outline offset without being clipped by the scroller.
                    interactive &&
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-money',
                    active ? 'bg-money-tint' : 'hover:bg-sunken'
                  )}
                >
                  {columns.map(col => (
                    <TableCell
                      key={col.id}
                      className={cn(
                        'h-row border-b border-rule px-3 py-0',
                        col.numeric ? 't-data tabular text-ink' : 't-body text-ink',
                        alignClass(col as Column<unknown>),
                        col.hideBelow && HIDE_BELOW_CLASS[col.hideBelow],
                        col.cellClassName
                      )}
                    >
                      {col.cell(row, index)}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
