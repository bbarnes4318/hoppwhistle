import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * The shape every block in an agency's management panel takes: a title, one
 * line saying what it changes, and the controls beneath. They were four
 * differently-spaced rows of bare labels and text-styled buttons; this is what
 * makes them read as one panel.
 */
export function SettingsSection({
  title,
  description,
  meta,
  children,
  className,
  ...props
}: Omit<React.HTMLAttributes<HTMLElement>, 'title'> & {
  title: string;
  description?: React.ReactNode;
  /** A short figure at the right of the title: "7 in use". */
  meta?: React.ReactNode;
}): JSX.Element {
  return (
    <section
      className={cn('flex flex-col gap-4 border-b border-rule px-5 py-5 last:border-0', className)}
      {...props}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="t-section text-ink">{title}</h3>
          {description ? <p className="t-meta mt-1 text-ink-3">{description}</p> : null}
        </div>
        {meta ? <div className="t-meta shrink-0 tabular-nums text-ink-2">{meta}</div> : null}
      </header>
      {children}
    </section>
  );
}

/** A labelled field: label above, control below, optional hint under it. */
export function SettingsField({
  label,
  htmlFor,
  hint,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="t-label text-ink-2">
        {label}
      </label>
      {children}
      {hint ? <p className="t-meta text-ink-3">{hint}</p> : null}
    </div>
  );
}

/**
 * A bordered row with a name and a line of explanation at the left and a
 * control (a switch, a button) at the right.
 */
export function SettingsToggleRow({
  title,
  description,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 rounded-control border border-rule bg-surface px-3.5 py-3">
      <div className="min-w-0">
        <p className="t-body font-medium text-ink">{title}</p>
        {description ? <p className="t-meta mt-0.5 text-ink-3">{description}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

/** The native select, drawn like an Input so a form of both lines up. */
export const selectClass =
  'h-9 w-full min-w-0 rounded-control border border-rule bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';
