'use client';

/**
 * Project Cortex | Spread Visualizer
 *
 * Shows Net Margin (Buyer Payout - Publisher Cost) with color coding.
 * The "Trading Desk" aesthetic.
 */

import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { calculateYield, calculateMargin } from '@/types/ppcall';

interface SpreadVisualizerProps {
  /** Buyer payout (revenue) */
  revenue: number;
  /** Publisher cost */
  cost: number;
  /** Show percentage margin */
  showMargin?: boolean;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Additional class names */
  className?: string;
}

export function SpreadVisualizer({
  revenue,
  cost,
  showMargin = true,
  size = 'md',
  className,
}: SpreadVisualizerProps) {
  const yield_ = calculateYield(revenue, cost);
  const margin = calculateMargin(revenue, cost);
  const isPositive = yield_ > 0;
  const isNeutral = yield_ === 0;

  const sizeClasses = {
    sm: {
      container: 'gap-2',
      value: 'text-lg',
      label: 'text-[10px]',
      icon: 'h-3 w-3',
    },
    md: {
      container: 'gap-3',
      value: 'text-2xl',
      label: 'text-xs',
      icon: 'h-4 w-4',
    },
    lg: {
      container: 'gap-4',
      value: 'text-4xl',
      label: 'text-sm',
      icon: 'h-5 w-5',
    },
  };

  const s = sizeClasses[size];

  return (
    <div className={cn('flex items-center', s.container, className)}>
      {/* Net Yield */}
      <div className="flex flex-col items-end">
        <span className={cn('font-mono text-text-muted uppercase tracking-widest', s.label)}>
          NET YIELD
        </span>
        <motion.span
          className={cn(
            'font-display font-bold tabular-nums',
            s.value,
            isPositive && 'text-neon-mint',
            isNeutral && 'text-text-muted',
            !isPositive && !isNeutral && 'text-status-error'
          )}
          initial={{ scale: 1 }}
          animate={isPositive ? { scale: [1, 1.05, 1] } : {}}
          transition={{ duration: 0.3 }}
        >
          {isPositive && '+'}${Math.abs(yield_).toFixed(2)}
        </motion.span>
      </div>

      {/* Trending Icon */}
      <div
        className={cn(
          'flex items-center justify-center rounded-full p-1.5',
          isPositive && 'bg-neon-mint/10 text-neon-mint',
          isNeutral && 'bg-text-muted/10 text-text-muted',
          !isPositive && !isNeutral && 'bg-status-error/10 text-status-error'
        )}
      >
        {isPositive && <TrendingUp className={s.icon} />}
        {isNeutral && <Minus className={s.icon} />}
        {!isPositive && !isNeutral && <TrendingDown className={s.icon} />}
      </div>

      {/* Margin Percentage */}
      {showMargin && (
        <div className="flex flex-col items-start">
          <span className={cn('font-mono text-text-muted uppercase tracking-widest', s.label)}>
            MARGIN
          </span>
          <span
            className={cn(
              'font-mono font-semibold tabular-nums',
              s.value,
              isPositive && 'text-neon-mint',
              isNeutral && 'text-text-muted',
              !isPositive && !isNeutral && 'text-status-error'
            )}
            style={{
              fontSize: `calc(${s.value === 'text-4xl' ? '2rem' : s.value === 'text-2xl' ? '1.25rem' : '0.875rem'} * 0.7)`,
            }}
          >
            {margin.toFixed(1)}%
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Spread Row - Compact inline spread display
 */
export function SpreadRow({
  label,
  revenue,
  cost,
  className,
}: {
  label: string;
  revenue: number;
  cost: number;
  className?: string;
}) {
  const yield_ = calculateYield(revenue, cost);
  const isPositive = yield_ > 0;

  return (
    <div
      className={cn('flex items-center justify-between py-2 border-b border-white/5', className)}
    >
      <span className="font-mono text-xs text-text-muted uppercase tracking-widest">{label}</span>
      <div className="flex items-center gap-4">
        <span className="font-mono text-sm text-neon-cyan">${revenue.toFixed(2)}</span>
        <span className="text-text-muted">-</span>
        <span className="font-mono text-sm text-status-warning">${cost.toFixed(2)}</span>
        <span className="text-text-muted">=</span>
        <span
          className={cn(
            'font-mono text-sm font-bold',
            isPositive ? 'text-neon-mint' : 'text-status-error'
          )}
        >
          {isPositive && '+'}${yield_.toFixed(2)}
        </span>
      </div>
    </div>
  );
}

export default SpreadVisualizer;
