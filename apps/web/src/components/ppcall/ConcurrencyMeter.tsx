'use client';

/**
 * Project Cortex | Concurrency Meter
 *
 * Visual representation of buyer concurrency cap usage.
 * Shows X/Y slots filled with color-coded urgency.
 */

import { motion } from 'framer-motion';
import { Phone, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ConcurrencyMeterProps {
  /** Current active calls */
  current: number;
  /** Maximum concurrency cap */
  max: number;
  /** Show numeric label */
  showLabel?: boolean;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Additional class names */
  className?: string;
}

export function ConcurrencyMeter({
  current,
  max,
  showLabel = true,
  size = 'md',
  className,
}: ConcurrencyMeterProps) {
  const percentage = Math.min(100, (current / max) * 100);
  const isNearCap = percentage >= 80;
  const isAtCap = current >= max;

  const sizeClasses = {
    sm: { height: 'h-2', text: 'text-xs', icon: 'h-3 w-3' },
    md: { height: 'h-3', text: 'text-sm', icon: 'h-4 w-4' },
    lg: { height: 'h-4', text: 'text-base', icon: 'h-5 w-5' },
  };

  const s = sizeClasses[size];

  // Color based on capacity
  const getColor = () => {
    if (isAtCap) return 'bg-status-error';
    if (isNearCap) return 'bg-toxic-lime';
    return 'bg-neon-cyan';
  };

  const getTextColor = () => {
    if (isAtCap) return 'text-status-error';
    if (isNearCap) return 'text-toxic-lime';
    return 'text-neon-cyan';
  };

  return (
    <div className={cn('space-y-1', className)}>
      {/* Label */}
      {showLabel && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Phone className={cn(s.icon, getTextColor())} />
            <span className={cn('font-mono uppercase tracking-widest text-text-muted', s.text)}>
              CONCURRENCY
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {isAtCap && <AlertTriangle className={cn(s.icon, 'text-status-error')} />}
            <span className={cn('font-mono font-bold tabular-nums', s.text, getTextColor())}>
              {current}/{max}
            </span>
          </div>
        </div>
      )}

      {/* Progress Bar */}
      <div
        className={cn(
          'relative w-full rounded-full overflow-hidden bg-panel border border-white/5',
          s.height
        )}
      >
        <motion.div
          className={cn('absolute inset-y-0 left-0 rounded-full', getColor())}
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        />

        {/* Pulse animation when at cap */}
        {isAtCap && (
          <motion.div
            className="absolute inset-0 rounded-full bg-status-error"
            animate={{ opacity: [0.3, 0.6, 0.3] }}
            transition={{ duration: 1, repeat: Infinity }}
          />
        )}
      </div>
    </div>
  );
}

/**
 * ConcurrencySlots - Visual slot-based representation
 */
export function ConcurrencySlots({
  current,
  max,
  className,
}: {
  current: number;
  max: number;
  className?: string;
}) {
  const slots = Array.from({ length: max }, (_, i) => i < current);

  return (
    <div className={cn('flex items-center gap-1', className)}>
      {slots.map((filled, i) => (
        <motion.div
          key={i}
          className={cn(
            'w-3 h-3 rounded-full border',
            filled
              ? 'bg-neon-cyan border-neon-cyan shadow-[0_0_6px_rgba(0,229,255,0.5)]'
              : 'border-white/20 bg-transparent'
          )}
          initial={filled ? { scale: 0 } : false}
          animate={filled ? { scale: 1 } : {}}
          transition={{ delay: i * 0.05 }}
        />
      ))}
    </div>
  );
}

/**
 * BuyerCapCard - Card showing buyer capacity status
 */
export function BuyerCapCard({
  buyerName,
  current,
  concurrencyCap,
  dailyCap,
  dailyUsed,
  className,
}: {
  buyerName: string;
  current: number;
  concurrencyCap: number;
  dailyCap: number;
  dailyUsed: number;
  className?: string;
}) {
  const ccPercent = (current / concurrencyCap) * 100;
  const dailyPercent = (dailyUsed / dailyCap) * 100;
  const isAtConcurrencyCap = current >= concurrencyCap;
  const isAtDailyCap = dailyUsed >= dailyCap;
  const isBlocked = isAtConcurrencyCap || isAtDailyCap;

  return (
    <div
      className={cn(
        'p-4 rounded-xl bg-panel/60 backdrop-blur-sm border',
        isBlocked ? 'border-status-error/30' : 'border-white/5',
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <span className="font-display font-semibold text-text-primary">{buyerName}</span>
        {isBlocked && (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-status-error/10 border border-status-error/30">
            <AlertTriangle className="h-3 w-3 text-status-error" />
            <span className="font-mono text-[10px] text-status-error uppercase">CAPPED</span>
          </span>
        )}
      </div>

      {/* Concurrency */}
      <div className="space-y-1 mb-3">
        <div className="flex justify-between text-xs">
          <span className="font-mono text-text-muted uppercase">CONCURRENT</span>
          <span
            className={cn(
              'font-mono font-bold',
              isAtConcurrencyCap ? 'text-status-error' : 'text-neon-cyan'
            )}
          >
            {current}/{concurrencyCap}
          </span>
        </div>
        <div className="h-2 rounded-full bg-panel border border-white/5 overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              isAtConcurrencyCap ? 'bg-status-error' : 'bg-neon-cyan'
            )}
            style={{ width: `${Math.min(100, ccPercent)}%` }}
          />
        </div>
      </div>

      {/* Daily Cap */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs">
          <span className="font-mono text-text-muted uppercase">DAILY</span>
          <span
            className={cn(
              'font-mono font-bold',
              isAtDailyCap ? 'text-status-error' : 'text-toxic-lime'
            )}
          >
            {dailyUsed}/{dailyCap}
          </span>
        </div>
        <div className="h-2 rounded-full bg-panel border border-white/5 overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              isAtDailyCap ? 'bg-status-error' : 'bg-toxic-lime'
            )}
            style={{ width: `${Math.min(100, dailyPercent)}%` }}
          />
        </div>
      </div>
    </div>
  );
}

export default ConcurrencyMeter;
