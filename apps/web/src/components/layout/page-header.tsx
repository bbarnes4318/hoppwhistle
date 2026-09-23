import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * PageHeader — the first row of a page's content, under the LiveStrip.
 *
 * The page's title is already in the topbar (page-title.ts), so this row does
 * not repeat it. It carries what the page says about itself — the one-line
 * description, at body size in ink-2 and no wider than 72 characters — and
 * the page's own header actions, right-aligned with 8px between them. `meta`
 * sits under the description for a badge or a short status.
 *
 * Below 768px the actions wrap underneath the description rather than
 * squeezing it, so a subtitle never runs under a button.
 */
export interface PageHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  description?: React.ReactNode;
  actions?: React.ReactNode;
  meta?: React.ReactNode;
}

export function PageHeader({ description, actions, meta, className, ...props }: PageHeaderProps) {
  if (!description && !actions && !meta) return null;

  return (
    <div
      className={cn(
        'flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-6',
        className
      )}
      {...props}
    >
      {description || meta ? (
        <div className="min-w-0 max-w-[72ch]">
          {description ? <div className="t-body text-ink-2">{description}</div> : null}
          {meta ? <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div> : null}
        </div>
      ) : (
        <span className="hidden md:block" />
      )}
      {actions ? (
        <div className="flex flex-wrap items-center gap-2 md:shrink-0 md:justify-end">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
