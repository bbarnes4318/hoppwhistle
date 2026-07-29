'use client';

import { Badge } from '@/components/ui/badge';

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning';

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  queued: 'outline',
  planning: 'secondary',
  running: 'secondary',
  waiting: 'secondary',
  completed: 'success',
  failed: 'destructive',
  canceled: 'outline',
  timed_out: 'destructive',
  budget_exceeded: 'warning',
  // stage statuses
  pending: 'outline',
  skipped: 'outline',
  fallback: 'warning',
};

const STATUS_LABEL: Record<string, string> = {
  budget_exceeded: 'Budget exceeded',
  timed_out: 'Timed out',
};

export function StatusBadge({ status }: { status: string }) {
  const variant = STATUS_VARIANT[status] ?? 'outline';
  const label = STATUS_LABEL[status] ?? status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <Badge variant={variant} className="text-[10px]">
      {label}
    </Badge>
  );
}

export function VerdictBadge({ verdict }: { verdict: string }) {
  const v = verdict.toUpperCase();
  const variant: BadgeVariant =
    v === 'GO' ? 'success' : v === 'DO_NOT_ENTER' ? 'destructive' : 'warning';
  const label =
    v === 'CONDITIONAL_GO' ? 'CONDITIONAL GO' : v === 'DO_NOT_ENTER' ? 'DO NOT ENTER' : v;
  return (
    <Badge variant={variant} className="text-[10px] font-bold">
      {label}
    </Badge>
  );
}
