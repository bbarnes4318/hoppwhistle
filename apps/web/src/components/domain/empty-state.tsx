import { Inbox } from 'lucide-react';
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
 * Centred, with a 44px brand-tint circle carrying a brand-ink icon above the
 * headline. `actions` takes a button that already exists on the page — with
 * its own handler — when the page wants to offer it here too.
 *
 * `variant` matters: an empty table and a filtered-to-nothing table are
 * different situations and need different offers — the first wants "create
 * one", the second wants "clear the filters".
 */

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Names the space: "No calls yet", not "No results". */
  headline: string;
  /** One line. Why it is empty, or what will fill it. */
  body?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  /** The verb. "Create a campaign", not "OK". */
  action?: { label: string; onClick?: () => void; href?: string };
  secondaryAction?: { label: string; onClick?: () => void; href?: string };
  /** Arbitrary existing controls, rendered beneath the text. */
  actions?: React.ReactNode;
  variant?: 'empty' | 'filtered' | 'error';
  size?: 'panel' | 'page';
}

export function EmptyState({
  headline,
  body,
  icon: Icon = Inbox,
  action,
  secondaryAction,
  actions,
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
        ? 'bg-brand-strong text-white hover:bg-brand-strong-hover'
        : 'border border-rule-strong bg-surface text-ink hover:bg-sunken';
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
      <span
        className={cn(
          'mb-4 flex h-11 w-11 items-center justify-center rounded-full',
          variant === 'error' ? 'bg-dropped-tint text-dropped' : 'bg-brand-tint text-brand-ink'
        )}
      >
        <Icon className="h-5 w-5" />
      </span>

      <h3 className={cn(size === 'page' ? 't-title' : 't-section', 'text-ink')}>{headline}</h3>

      {body ? <p className="t-body mt-1.5 max-w-md text-ink-2">{body}</p> : null}

      {action || secondaryAction || actions ? (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {action ? renderAction(action, 'primary') : null}
          {secondaryAction ? renderAction(secondaryAction, 'secondary') : null}
          {actions}
        </div>
      ) : null}
    </div>
  );
}
