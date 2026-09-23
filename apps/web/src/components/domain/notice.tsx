import { AlertTriangle, Info, XCircle } from 'lucide-react';
import * as React from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { cn } from '@/lib/utils';

/**
 * Notice — the one way a page says something about itself: a setting that
 * changes what the figures mean, a missing prerequisite, a load that failed.
 *
 *   info     money tint and bar   "this is how it works right now"
 *   warning  ringing tint and bar "this needs attention"
 *   error    dropped tint and bar "this did not work"
 *
 * `title` is the bold first line; children are the body, in ink-2. The text
 * is whatever the page already says — the notice only gives it a shape.
 */
export interface NoticeProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  tone?: 'info' | 'warning' | 'error';
  title?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  /** Controls at the right of the notice (an existing button, a link). */
  action?: React.ReactNode;
}

const ICONS = { info: Info, warning: AlertTriangle, error: XCircle } as const;

export function Notice({
  tone = 'info',
  title,
  icon,
  action,
  className,
  children,
  ...props
}: NoticeProps) {
  const Icon = icon ?? ICONS[tone];
  return (
    <Alert variant={tone} className={className} {...props}>
      <Icon />
      <div className={cn(action ? 'flex flex-wrap items-start justify-between gap-3' : undefined)}>
        <div className="min-w-0">
          {title ? <AlertTitle>{title}</AlertTitle> : null}
          {children ? <AlertDescription>{children}</AlertDescription> : null}
        </div>
        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </div>
    </Alert>
  );
}
