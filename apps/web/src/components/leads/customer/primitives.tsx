'use client';

/**
 * The small, repeated pieces of the customer workspace, drawn once so every
 * tab speaks the same way: a group heading, the Edit control, an empty value
 * and an empty state.
 *
 * Language, everywhere on the page:
 *   - a field the agent needs and does not have: "Not entered"
 *   - an optional field with nothing in it: an em dash
 *   - an empty list: "No <things> yet", one line of why, and the verb
 */

import { Pencil } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

/** A heading inside a panel: sentence case, quieter than the panel's title. */
export function GroupHeading({
  id,
  children,
  action,
  className,
}: {
  id?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <div className={cn('flex min-h-7 items-center justify-between gap-2', className)}>
      <h3 id={id} className="text-[13px] font-semibold text-ink-2">
        {children}
      </h3>
      {action}
    </div>
  );
}

/** The one Edit control: same icon, label, size and hover wherever a group is editable. */
export function EditButton({
  onClick,
  label = 'Edit',
  'aria-label': ariaLabel,
  className,
}: {
  onClick: () => void;
  label?: string;
  'aria-label'?: string;
  className?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-control px-2 text-[13px] font-medium text-ink-2 transition-colors',
        'hover:bg-sunken hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className
      )}
    >
      <Pencil aria-hidden className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

/** A value that is not there. `missing` for one the agent should go and get. */
export function EmptyValue({ missing = false }: { missing?: boolean }): JSX.Element {
  return missing ? (
    <span className="text-ink-3">Not entered</span>
  ) : (
    <span aria-label="None" className="text-ink-3 opacity-60">
      —
    </span>
  );
}

/** An empty list inside a panel: icon, what would live here, why, and the verb. */
export function InlineEmpty({
  icon: Icon,
  title,
  body,
  action,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <div className={cn('flex items-start gap-3.5', className)}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sunken text-ink-3">
        <Icon aria-hidden className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1 pt-px">
        <p className="text-[14px] font-medium text-ink">{title}</p>
        {body ? <p className="mt-0.5 text-[13px] leading-5 text-ink-3">{body}</p> : null}
        {action ? <div className="mt-3">{action}</div> : null}
      </div>
    </div>
  );
}
