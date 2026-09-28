'use client';

import * as React from 'react';

import { InHubContext } from '@/components/hub/hub-context';
import { cn } from '@/lib/utils';

import { useClaimPageTitle, useCurrentPageTitle } from './use-page-title';

/**
 * PageHeader — the first row of a page's content.
 *
 * Title, a one-line description in ink-2 under it, and the page's own actions
 * right-aligned with 8px between them. Every page opens the same way, 24px
 * under the topbar (the canvas gutter), so moving between screens never moves
 * the eye.
 *
 * The title is the page's nav name unless `title` says otherwise, and `false`
 * leaves it out. Inside a hub the hub names the page above its tabs, so a
 * view's header there carries its description and actions only. A header that
 * shows the title claims it, and the topbar drops its own copy.
 *
 * Below 768px the actions wrap underneath the description rather than
 * squeezing it, so a subtitle never runs under a button.
 *
 * `compact` keeps the description on one line (truncated, never wrapped) with
 * tighter gaps, for a working list whose header should stay one row tall.
 */
export interface PageHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Defaults to the page's name in the viewer's nav. `false` for none. */
  title?: React.ReactNode | false;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  meta?: React.ReactNode;
  /** One-line description, tighter gaps. */
  compact?: boolean;
}

export function PageHeader({
  title,
  description,
  actions,
  meta,
  compact = false,
  className,
  ...props
}: PageHeaderProps) {
  const inHub = React.useContext(InHubContext);
  const auto = useCurrentPageTitle();
  const heading = title === false || inHub ? null : (title ?? auto) || null;
  useClaimPageTitle(heading !== null);

  if (!heading && !description && !actions && !meta) return null;

  return (
    <div
      className={cn(
        'flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-6',
        className
      )}
      data-compact={compact ? '' : undefined}
      data-page-header=""
      {...props}
    >
      {heading || description || meta ? (
        <div className="min-w-0 max-w-[72ch]">
          {heading ? <h1 className="t-title text-ink">{heading}</h1> : null}
          {description ? (
            <div className={cn('t-body text-ink-2', heading && 'mt-1', compact && 'md:truncate')}>
              {description}
            </div>
          ) : null}
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
