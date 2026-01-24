'use client';

import { ArrowDown, ArrowUp, Minus, type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

interface KPICardProps {
  title: string;
  value: string | number;
  unit?: string;
  trend?: number; // percentage change, positive = up, negative = down
  trendLabel?: string;
  icon?: LucideIcon;
  onClick?: () => void;
  className?: string;
  loading?: boolean;
  variant?: 'default' | 'revenue' | 'conversion' | 'warning';
}

export function KPICard({
  title,
  value,
  unit,
  trend,
  trendLabel,
  icon: Icon,
  onClick,
  className,
  loading,
  variant = 'default',
}: KPICardProps) {
  const isPositive = trend && trend > 0;
  const isNegative = trend && trend < 0;
  const isNeutral = !trend || trend === 0;

  const variantStyles = {
    default: 'bg-card border-border',
    revenue: 'bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border-emerald-500/20',
    conversion: 'bg-gradient-to-br from-brand-cyan/10 to-brand-violet/5 border-brand-cyan/20',
    warning: 'bg-gradient-to-br from-amber-500/10 to-amber-600/5 border-amber-500/20',
  };

  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={e => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          onClick();
        }
      }}
      className={cn(
        'relative overflow-hidden rounded-xl border p-5 transition-all duration-200',
        variantStyles[variant],
        onClick && 'cursor-pointer hover:shadow-lg hover:scale-[1.02] active:scale-[0.98]',
        className
      )}
    >
      {/* Background accent */}
      {Icon && (
        <div className="absolute -right-4 -top-4 opacity-5">
          <Icon className="h-24 w-24" />
        </div>
      )}

      <div className="relative z-10 space-y-3">
        {/* Title */}
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">{title}</span>
          {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
        </div>

        {/* Value */}
        <div className="flex items-baseline gap-1.5">
          {loading ? (
            <div className="h-9 w-24 animate-pulse rounded bg-muted" />
          ) : (
            <>
              <span className="text-3xl font-bold tracking-tight text-foreground">
                {typeof value === 'number' ? value.toLocaleString() : value}
              </span>
              {unit && <span className="text-sm font-medium text-muted-foreground">{unit}</span>}
            </>
          )}
        </div>

        {/* Trend */}
        {trend !== undefined && !loading && (
          <div className="flex items-center gap-2">
            <div
              className={cn(
                'flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-medium',
                isPositive && 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                isNegative && 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
                isNeutral && 'bg-muted text-muted-foreground'
              )}
            >
              {isPositive && <ArrowUp className="h-3 w-3" />}
              {isNegative && <ArrowDown className="h-3 w-3" />}
              {isNeutral && <Minus className="h-3 w-3" />}
              <span>{Math.abs(trend).toFixed(1)}%</span>
            </div>
            {trendLabel && <span className="text-xs text-muted-foreground">{trendLabel}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
