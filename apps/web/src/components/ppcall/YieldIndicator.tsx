'use client';

/**
 * Project Cortex | Yield Indicator
 *
 * Real-time profit display for calls and campaigns.
 */

import { motion, AnimatePresence } from 'framer-motion';
import { TrendingUp, DollarSign, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

interface YieldIndicatorProps {
  /** Current yield amount */
  yield_: number;
  /** Show animation on change */
  animate?: boolean;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Show label */
  showLabel?: boolean;
  /** Additional class names */
  className?: string;
}

export function YieldIndicator({
  yield_,
  animate = true,
  size = 'md',
  showLabel = true,
  className,
}: YieldIndicatorProps) {
  const isPositive = yield_ > 0;

  const sizeClasses = {
    sm: { value: 'text-lg', label: 'text-[10px]', icon: 'h-3 w-3' },
    md: { value: 'text-2xl', label: 'text-xs', icon: 'h-4 w-4' },
    lg: { value: 'text-4xl', label: 'text-sm', icon: 'h-5 w-5' },
    xl: { value: 'text-6xl', label: 'text-base', icon: 'h-6 w-6' },
  };

  const s = sizeClasses[size];

  return (
    <div className={cn('flex flex-col items-center', className)}>
      {showLabel && (
        <span className={cn('font-mono text-text-muted uppercase tracking-widest mb-1', s.label)}>
          NET YIELD
        </span>
      )}
      <motion.div
        className="flex items-center gap-2"
        initial={animate ? { scale: 1 } : false}
        animate={animate && isPositive ? { scale: [1, 1.05, 1] } : {}}
        transition={{ duration: 0.3 }}
      >
        <span
          className={cn(
            'font-display font-bold tabular-nums',
            s.value,
            isPositive ? 'text-neon-mint' : yield_ < 0 ? 'text-status-error' : 'text-text-muted'
          )}
        >
          {isPositive && '+'}${yield_.toFixed(2)}
        </span>
        {isPositive && <TrendingUp className={cn(s.icon, 'text-neon-mint')} />}
      </motion.div>
    </div>
  );
}

/**
 * YieldCard - Card displaying yield with breakdown
 */
export function YieldCard({
  revenue,
  cost,
  callCount,
  className,
}: {
  revenue: number;
  cost: number;
  callCount?: number;
  className?: string;
}) {
  const yield_ = revenue - cost;
  const margin = revenue > 0 ? (yield_ / revenue) * 100 : 0;
  const isPositive = yield_ > 0;

  return (
    <div
      className={cn('p-4 rounded-xl bg-panel/60 backdrop-blur-sm border border-white/5', className)}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <span className="font-mono text-xs text-text-muted uppercase tracking-widest">
          TRADING SUMMARY
        </span>
        {callCount !== undefined && (
          <span className="font-mono text-xs text-neon-cyan">{callCount} CALLS</span>
        )}
      </div>

      {/* Breakdown */}
      <div className="space-y-2 mb-4">
        <div className="flex justify-between">
          <span className="font-mono text-xs text-text-muted">GROSS REVENUE</span>
          <span className="font-mono text-sm text-neon-cyan">${revenue.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="font-mono text-xs text-text-muted">PUBLISHER COST</span>
          <span className="font-mono text-sm text-status-warning">-${cost.toFixed(2)}</span>
        </div>
        <div className="h-px bg-white/10" />
      </div>

      {/* Net Yield */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className={cn(
              'flex items-center justify-center w-8 h-8 rounded-full',
              isPositive ? 'bg-neon-mint/10' : 'bg-status-error/10'
            )}
          >
            <DollarSign
              className={cn('h-4 w-4', isPositive ? 'text-neon-mint' : 'text-status-error')}
            />
          </div>
          <div>
            <p className="font-mono text-xs text-text-muted uppercase">NET YIELD</p>
            <p
              className={cn(
                'font-display text-xl font-bold',
                isPositive ? 'text-neon-mint' : 'text-status-error'
              )}
            >
              {isPositive && '+'}${yield_.toFixed(2)}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="font-mono text-xs text-text-muted uppercase">MARGIN</p>
          <p
            className={cn(
              'font-mono text-lg font-semibold',
              isPositive ? 'text-neon-mint' : 'text-status-error'
            )}
          >
            {margin.toFixed(1)}%
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * LiveYieldTicker - Animated ticker showing yield updates
 */
export function LiveYieldTicker({
  yields,
  className,
}: {
  yields: { id: string; amount: number; vertical?: string }[];
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-3 overflow-hidden', className)}>
      <Zap className="h-4 w-4 text-neon-mint shrink-0" />
      <div className="flex items-center gap-4 animate-marquee">
        <AnimatePresence>
          {yields.map((y, i) => (
            <motion.div
              key={y.id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="flex items-center gap-2"
            >
              <span className="font-mono text-xs text-neon-mint font-bold">
                +${y.amount.toFixed(2)}
              </span>
              {y.vertical && (
                <span className="font-mono text-[10px] text-text-muted uppercase">
                  {y.vertical}
                </span>
              )}
              {i < yields.length - 1 && <span className="text-white/20">•</span>}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

export default YieldIndicator;
