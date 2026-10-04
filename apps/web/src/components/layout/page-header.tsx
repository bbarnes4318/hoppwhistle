'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';

import { InHubContext } from '@/components/hub/hub-context';
import { cn } from '@/lib/utils';

import {
  DOCK_ACTIONS_QUERY,
  DOCK_DESCRIPTION_QUERY,
  useClaimPageTitle,
  useCurrentPageTitle,
  useMediaQuery,
  useTopbarSlots,
} from './use-page-title';

/**
 * PageHeader — a page's name, its one-line description and its own actions.
 *
 * ── It renders in the topbar ─────────────────────────────────────────────────
 *
 * The topbar is the page header. The title sits at its left with the
 * description in ink-3 under it, and the page's actions at its right beside the
 * search, so the content area opens on the content: no band under the bar
 * restating what the bar already says. See `useTopbarSlots`.
 *
 * The title is the page's nav name, which the topbar already shows, unless
 * `title` says otherwise; a custom title is rendered into the topbar's heading
 * in place of the nav name. `false` keeps the nav name. Inside a hub the hub's
 * tabs sit under the topbar and the view's title is the hub's.
 *
 * ── Where the room runs out, the page keeps it ───────────────────────────────
 *
 * Below 768px the description renders at the top of the page, and below 1024px
 * the actions do, right-aligned: the bar has room for the title alone on a
 * phone, and for the title and search on a laptop. With no topbar mounted at
 * all (a page rendered on its own) the whole header renders in place.
 *
 * `compact` keeps an in-page description on one line (truncated, never
 * wrapped), for a working list whose header should stay one row tall.
 */
export interface PageHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Defaults to the page's name in the viewer's nav. `false` for the nav name. */
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
  const slots = useTopbarSlots();
  const wideForDescription = useMediaQuery(DOCK_DESCRIPTION_QUERY);
  const wideForActions = useMediaQuery(DOCK_ACTIONS_QUERY);

  // A title of the page's own, rather than its nav name.
  const custom = title === false || title === undefined || inHub ? null : title || null;
  const titleTarget = custom !== null ? slots.title : null;
  useClaimPageTitle(titleTarget !== null);

  const descriptionTarget = description && wideForDescription ? slots.description : null;
  const actionsTarget = actions && wideForActions ? slots.actions : null;

  // No topbar at all: the page names itself, as it did before the bar could.
  const standalone = slots.title === null;
  const heading = standalone && !inHub && title !== false ? (custom ?? auto) || null : null;

  const inlineDescription = descriptionTarget ? null : description;
  const inlineActions = actionsTarget ? null : actions;
  const showInline = heading || inlineDescription || meta || inlineActions;

  return (
    <>
      {titleTarget ? createPortal(custom, titleTarget) : null}
      {/* Wrapped, so that when a view nested in a page brings a header of its
          own the topbar can show the innermost description alone. */}
      {descriptionTarget
        ? createPortal(<span data-docked="">{description}</span>, descriptionTarget)
        : null}
      {actionsTarget ? createPortal(actions, actionsTarget) : null}
      {showInline ? (
        <div
          className={cn(
            'flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-6',
            className
          )}
          data-compact={compact ? '' : undefined}
          data-page-header=""
          {...props}
        >
          {heading || inlineDescription || meta ? (
            <div className="min-w-0 max-w-[72ch]">
              {heading ? <h1 className="t-title text-ink">{heading}</h1> : null}
              {inlineDescription ? (
                <div
                  className={cn('t-body text-ink-2', heading && 'mt-1', compact && 'md:truncate')}
                >
                  {inlineDescription}
                </div>
              ) : null}
              {meta ? (
                <div
                  className={cn(
                    'flex flex-wrap items-center gap-2',
                    (heading || inlineDescription) && 'mt-2'
                  )}
                >
                  {meta}
                </div>
              ) : null}
            </div>
          ) : (
            <span className="hidden md:block" />
          )}
          {inlineActions ? (
            <div className="flex flex-wrap items-center gap-2 md:ml-auto md:shrink-0 md:justify-end">
              {inlineActions}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
