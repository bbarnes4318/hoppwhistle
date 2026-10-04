'use client';

import { Check, Copy } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * One labelled line of an Account panel: the label and an optional hint at the
 * left, the value or control at the right, a hairline between rows. Stacks
 * below `sm`. Rows go inside a `SettingRows` list so the dividers are drawn
 * once, between them, and never at the panel's edge.
 */
export function SettingRows({
  className,
  ...props
}: React.HTMLAttributes<HTMLDListElement>): JSX.Element {
  return <dl className={cn('divide-y divide-rule', className)} {...props} />;
}

export interface SettingRowProps {
  label: React.ReactNode;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function SettingRow({ label, hint, children, className }: SettingRowProps): JSX.Element {
  return (
    <div
      className={cn(
        'grid gap-1.5 py-4 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:gap-6',
        className
      )}
    >
      <dt className="min-w-0">
        <span className="block text-sm font-medium text-ink">{label}</span>
        {hint ? <span className="t-meta mt-0.5 block text-ink-3">{hint}</span> : null}
      </dt>
      <dd className="flex min-w-0 items-center gap-2 text-sm text-ink">{children}</dd>
    </div>
  );
}

/** A small icon button that copies `value` and says so for two seconds. */
export function CopyButton({ value, label }: { value: string; label: string }): JSX.Element {
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard
          ?.writeText(value)
          .then(() => setCopied(true))
          .catch(() => {
            // Clipboard refused (insecure origin, permissions): nothing to say.
          });
      }}
      className={cn(
        'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-ink-3',
        'transition-colors duration-150 hover:bg-sunken hover:text-ink',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
      )}
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      title={copied ? 'Copied' : `Copy ${label}`}
    >
      {copied ? (
        <Check aria-hidden className="h-3.5 w-3.5 text-live-ink" />
      ) : (
        <Copy aria-hidden className="h-3.5 w-3.5" />
      )}
    </button>
  );
}
