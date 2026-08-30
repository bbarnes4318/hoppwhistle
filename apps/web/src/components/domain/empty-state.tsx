import * as React from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * EmptyState — names the space and offers a verb.
 *
 * "No data found" tells someone nothing they had not already worked out from
 * the empty screen. The headline says what would live here, the line under it
 * says why it might be empty, and the action is the thing they came to do.
 *
 * `variant` matters: an empty table and a filtered-to-nothing table are
 * different situations and need different offers — the first wants "create
 * one", the second wants "clear the filters".
 */

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Names the space: "No calls yet", not "No results". */
  headline: string;
  /** One line. Why it is empty, or what will fill it. */
  body?: string;
  icon?: React.ComponentType<{ className?: string }>;
  /** The verb. "Create a campaign", not "OK". */
  action?: { label: string; onClick?: () => void; href?: string };
  secondaryAction?: { label: string; onClick?: () => void; href?: string };
  variant?: 'empty' | 'filtered' | 'error';
  size?: 'panel' | 'page';
}

export function EmptyState({
  headline,
  body,
  icon: Icon,
  action,
  secondaryAction,
  variant = 'empty',
  size = 'panel',
  className,
  ...props
}: EmptyStateProps) {
  const renderAction = (
    a: NonNullable<EmptyStateProps['action']>,
    kind: 'primary' | 'secondary'
  ) => {
    const classes =
      kind === 'primary'
        ? 'bg-money text-white hover:bg-money/90'
        : 'border border-rule bg-transparent text-ink hover:bg-sunken';
    if (a.href) {
      return (
        <Button asChild size="sm" className={cn('rounded-control', classes)}>
          <a href={a.href}>{a.label}</a>
        </Button>
      );
    }
    return (
      <Button size="sm" onClick={a.onClick} className={cn('rounded-control', classes)}>
        {a.label}
      </Button>
    );
  };

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center px-6 text-center',
        size === 'page' ? 'py-20' : 'py-12',
        className
      )}
      // Not a live region: an empty state is the content, not an alert.
      {...props}
    >
      {Icon ? (
        <Icon className={cn('mb-3 h-6 w-6', variant === 'error' ? 'text-dropped' : 'text-ink-3')} />
      ) : null}

      <h3 className={cn(size === 'page' ? 't-title' : 't-section', 'text-ink')}>{headline}</h3>

      {body ? <p className="t-body mt-1.5 max-w-sm text-ink-2">{body}</p> : null}

      {action || secondaryAction ? (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {action ? renderAction(action, 'primary') : null}
          {secondaryAction ? renderAction(secondaryAction, 'secondary') : null}
        </div>
      ) : null}
    </div>
  );
}
