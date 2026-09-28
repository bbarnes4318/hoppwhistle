import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Table — a sticky header of 12px sentence-case column heads in ink-2, 14px
 * body, 44px rows divided by hairlines, no zebra, and a sunken row hover. The
 * container rounds to the card radius and scrolls sideways on its own, so a
 * wide ledger never pushes the page body into a horizontal scroll; below
 * 1024px the first column stays pinned while the rest scroll under it
 * (`data-pin-first`, styled in globals.css).
 *
 * Numbers are right-aligned with tabular figures: give the head and the cell
 * `text-right` and the cell inherits `tabular-nums` from the table.
 */

const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    // overflow-y is pinned to hidden: `overflow-x: auto` alone computes
    // overflow-y to auto as well, and sub-pixel rounding under display scaling
    // then draws a vertical scrollbar inside a one-row table.
    <div className="relative w-full overflow-x-auto overflow-y-hidden rounded-card">
      <table
        ref={ref}
        data-pin-first=""
        className={cn('w-full caption-bottom text-[14px] tabular-nums', className)}
        {...props}
      />
    </div>
  )
);
Table.displayName = 'Table';

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead
    ref={ref}
    className={cn(
      'sticky top-0 z-10 bg-surface [&_tr]:border-b [&_tr]:border-rule-strong [&_tr:hover]:bg-transparent',
      className
    )}
    {...props}
  />
));
TableHeader.displayName = 'TableHeader';

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn('[&_tr:last-child]:border-0', className)} {...props} />
));
TableBody.displayName = 'TableBody';

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn('border-t border-rule bg-sunken font-medium [&>tr]:last:border-b-0', className)}
    {...props}
  />
));
TableFooter.displayName = 'TableFooter';

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        'border-b border-rule transition-colors duration-150 ease-out hover:bg-sunken data-[state=selected]:bg-brand-tint',
        className
      )}
      {...props}
    />
  )
);
TableRow.displayName = 'TableRow';

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      'h-10 whitespace-nowrap bg-surface px-3 text-left align-middle t-caption text-ink-2 [&:has([role=checkbox])]:pr-0',
      className
    )}
    {...props}
  />
));
TableHead.displayName = 'TableHead';

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn('h-row px-3 py-2 align-middle [&:has([role=checkbox])]:pr-0', className)}
    {...props}
  />
));
TableCell.displayName = 'TableCell';

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption ref={ref} className={cn('mt-4 t-meta text-ink-3', className)} {...props} />
));
TableCaption.displayName = 'TableCaption';

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };
