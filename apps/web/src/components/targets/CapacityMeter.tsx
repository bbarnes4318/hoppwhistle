'use client';

/**
 * Project Cortex | Capacity Meter
 *
 * Mini progress bar for concurrency/daily caps.
 * Color-coded by utilization level.
 */

import { cn } from '@/lib/utils';
import { getCapacityPercent, getCapacityColor } from '@/types/target';

interface CapacityMeterProps {
  label: string;
  used: number;
  cap: number;
  unit?: string;
  size?: 'sm' | 'md';
  className?: string;
}

export function CapacityMeter({
  label,
  used,
  cap,
  unit = '',
  size = 'md',
  className,
}: CapacityMeterProps) {
  const percent = getCapacityPercent(used, cap);
  const color = getCapacityColor(percent);
  const isCapped = percent >= 100;

  const colorClasses = {
    cyan: {
      bar: 'bg-neon-cyan',
      text: 'text-neon-cyan',
      glow: '',
    },
    lime: {
      bar: 'bg-toxic-lime',
      text: 'text-toxic-lime',
      glow: '',
    },
    error: {
      bar: 'bg-status-error',
      text: 'text-status-error',
      glow: 'shadow-[0_0_8px_rgba(255,71,87,0.5)]',
    },
  };

  const c = colorClasses[color];
  const sizeClasses = size === 'sm' ? 'h-1.5' : 'h-2';

  return (
    <div className={cn('space-y-1', className)}>
      {/* Label and value */}
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] text-text-muted uppercase tracking-widest">
          {label}
        </span>
        <span className={cn('font-mono text-xs font-bold tabular-nums', c.text)}>
          {used}/{cap} {unit}
        </span>
      </div>

      {/* Progress bar */}
      <div
        className={cn(
          'w-full rounded-full bg-panel border border-white/5 overflow-hidden',
          sizeClasses
        )}
      >
        <div
          className={cn('h-full rounded-full transition-all duration-300', c.bar, c.glow)}
          style={{ width: `${Math.min(100, percent)}%` }}
        />
      </div>

      {/* Capped indicator */}
      {isCapped && (
        <span className="font-mono text-[9px] text-status-error uppercase tracking-widest">
          ⚠ CAPPED
        </span>
      )}
    </div>
  );
}

export default CapacityMeter;
