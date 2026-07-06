'use client';

import { cn } from '@/lib/utils';

import { formatChange } from '../lib/utils';

interface StatCardProps {
  title: string;
  value: string;
  change: number;
  icon: React.ComponentType<{ className?: string }>;
  accentColor?: string;
}

export function StatCard({
  title,
  value,
  change,
  icon: Icon,
  accentColor = 'blue',
}: StatCardProps) {
  const { label, positive } = formatChange(change);

  const accentMap: Record<string, { bg: string; border: string; iconBg: string; iconText: string }> = {
    blue: {
      bg: 'from-blue-500/10 to-transparent',
      border: 'border-blue-500/20',
      iconBg: 'bg-blue-500/15',
      iconText: 'text-blue-400',
    },
    fuchsia: {
      bg: 'from-fuchsia-500/10 to-transparent',
      border: 'border-fuchsia-500/20',
      iconBg: 'bg-fuchsia-500/15',
      iconText: 'text-fuchsia-400',
    },
    cyan: {
      bg: 'from-cyan-500/10 to-transparent',
      border: 'border-cyan-500/20',
      iconBg: 'bg-cyan-500/15',
      iconText: 'text-cyan-400',
    },
    emerald: {
      bg: 'from-emerald-500/10 to-transparent',
      border: 'border-emerald-500/20',
      iconBg: 'bg-emerald-500/15',
      iconText: 'text-emerald-400',
    },
    amber: {
      bg: 'from-amber-500/10 to-transparent',
      border: 'border-amber-500/20',
      iconBg: 'bg-amber-500/15',
      iconText: 'text-amber-400',
    },
    rose: {
      bg: 'from-rose-500/10 to-transparent',
      border: 'border-rose-500/20',
      iconBg: 'bg-rose-500/15',
      iconText: 'text-rose-400',
    },
  };

  const accent = accentMap[accentColor] || accentMap.blue;

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-lg border bg-gradient-to-br p-4',
        accent.border,
        accent.bg,
        'bg-card/50 backdrop-blur-sm',
        'transition-all duration-300 hover:scale-[1.02] hover:shadow-lg hover:shadow-blue-500/5'
      )}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            {title}
          </p>
          <p className="text-2xl font-bold tracking-tight text-zinc-100">
            {value}
          </p>
        </div>
        <div className={cn('rounded-lg p-2', accent.iconBg)}>
          <Icon className={cn('h-5 w-5', accent.iconText)} />
        </div>
      </div>

      <div className="mt-3 flex items-center gap-1.5">
        <span
          className={cn(
            'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold',
            positive
              ? 'bg-emerald-500/15 text-emerald-400'
              : 'bg-red-500/15 text-red-400'
          )}
        >
          {positive ? '↑' : '↓'} {label}
        </span>
        <span className="text-xs text-zinc-500">vs last period</span>
      </div>

      {/* Decorative shimmer */}
      <div className="absolute -right-4 -top-4 h-20 w-20 rounded-full bg-white/[0.02] blur-2xl" />
    </div>
  );
}
