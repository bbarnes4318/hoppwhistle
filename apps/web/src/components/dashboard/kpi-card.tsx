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

/**
 * A single headline metric.
 *
 * The number is the hero: everything else (label, icon, trend) is deliberately
 * quiet so a row of these scans as data rather than as decoration. Each variant
 * only changes a hairline accent — never the whole card — so the row stays
 * visually even.
 */
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
  const isPositive = trend !== undefined && trend > 0;
  const isNegative = trend !== undefined && trend < 0;
  const isNeutral = !trend || trend === 0;

  const accent = {
    default: 'from-primary/60',
    revenue: 'from-emerald-400/70',
    conversion: 'from-sky-400/70',
    warning: 'from-amber-400/70',
  }[variant];

  const iconTint = {
    default: 'text-muted-foreground',
    revenue: 'text-emerald-400/80',
    conversion: 'text-sky-400/80',
    warning: 'text-amber-400/80',
  }[variant];

  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={e => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        'surface bg-lift group relative overflow-hidden p-4',
        'transition-all duration-200 ease-premium',
        onClick &&
          'cursor-pointer hover:-translate-y-0.5 hover:border-border-strong hover:shadow-float',
        className
      )}
    >
      {/* Hairline accent along the top edge, brightening on hover */}
      <span
        aria-hidden
        className={cn(
          'absolute inset-x-0 top-0 h-px bg-gradient-to-r to-transparent opacity-70 transition-opacity duration-200 group-hover:opacity-100',
          accent
        )}
      />

      <div className="relative z-10 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="eyebrow truncate">{title}</span>
          {Icon && <Icon className={cn('h-3.5 w-3.5 flex-shrink-0', iconTint)} />}
        </div>

        <div className="flex items-baseline gap-1.5">
          {loading ? (
            <div className="h-8 w-24 animate-pulse rounded-md bg-muted" />
          ) : (
            <>
              <span
                data-numeric
                className="text-[28px] font-semibold leading-none tracking-tight text-foreground"
              >
                {typeof value === 'number' ? value.toLocaleString() : value}
              </span>
              {unit && (
                <span className="text-xs font-medium text-muted-foreground">{unit}</span>
              )}
            </>
          )}
        </div>

        {trend !== undefined && !loading ? (
          <div className="flex items-center gap-2">
            <div
              className={cn(
                'flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold',
                isPositive && 'bg-emerald-500/12 text-emerald-400',
                isNegative && 'bg-rose-500/12 text-rose-400',
                isNeutral && 'bg-muted/70 text-muted-foreground'
              )}
            >
              {isPositive && <ArrowUp className="h-3 w-3" />}
              {isNegative && <ArrowDown className="h-3 w-3" />}
              {isNeutral && <Minus className="h-3 w-3" />}
              <span data-numeric>{Math.abs(trend).toFixed(1)}%</span>
            </div>
            {trendLabel && (
              <span className="truncate text-[11px] text-muted-foreground">{trendLabel}</span>
            )}
          </div>
        ) : (
          // Reserve the row so cards with and without a trend stay the same height
          !loading && <div className="h-[22px]" aria-hidden />
        )}
      </div>
    </div>
  );
}
