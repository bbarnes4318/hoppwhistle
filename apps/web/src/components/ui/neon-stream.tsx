'use client';

/**
 * Project Cortex | Neon Stream Component
 *
 * Data visualization component replacing static tables.
 * Electric Cyan gradient lines with glow effects.
 *
 * Uses Framer Motion for smooth data transitions.
 */

import { motion, AnimatePresence } from 'framer-motion';
import { useMemo } from 'react';

import { cn } from '@/lib/utils';

export interface NeonStreamDataPoint {
  id: string;
  label: string;
  value: number;
  maxValue?: number;
  tier?: 'primary' | 'secondary' | 'accent';
}

interface NeonStreamProps {
  data: NeonStreamDataPoint[];
  /** Show value labels */
  showLabels?: boolean;
  /** Show percentage completion */
  showProgress?: boolean;
  /** Animate on mount */
  animate?: boolean;
  /** Vertical layout */
  vertical?: boolean;
  /** Additional classes */
  className?: string;
}

const tierColors = {
  primary: {
    bar: 'from-brand-cyan to-brand-cyan/60',
    glow: 'rgba(0, 229, 255, 0.4)',
    text: 'text-brand-cyan',
  },
  secondary: {
    bar: 'from-brand-violet to-brand-violet/60',
    glow: 'rgba(156, 74, 255, 0.4)',
    text: 'text-brand-violet',
  },
  accent: {
    bar: 'from-brand-lime to-brand-lime/60',
    glow: 'rgba(204, 255, 0, 0.4)',
    text: 'text-brand-lime',
  },
};

/**
 * Neon Stream - Animated Data Bars
 */
export function NeonStream({
  data,
  showLabels = true,
  showProgress = true,
  animate = true,
  vertical = false,
  className,
}: NeonStreamProps) {
  const maxValue = useMemo(() => {
    return Math.max(...data.map(d => d.maxValue ?? d.value));
  }, [data]);

  return (
    <div className={cn('flex gap-3', vertical ? 'flex-col' : 'flex-row items-end', className)}>
      <AnimatePresence mode="popLayout">
        {data.map((point, index) => {
          const percentage = (point.value / (point.maxValue ?? maxValue)) * 100;
          const tier = point.tier ?? 'primary';
          const colors = tierColors[tier];

          return (
            <motion.div
              key={point.id}
              className={cn('flex flex-col gap-1', vertical ? 'w-full' : 'flex-1')}
              initial={animate ? { opacity: 0, y: 20 } : undefined}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ delay: index * 0.05 }}
            >
              {/* Label */}
              {showLabels && (
                <div className="flex justify-between items-center">
                  <span className="telemetry-label text-[10px]">{point.label}</span>
                  <span className={cn('font-mono text-sm font-medium', colors.text)}>
                    {point.value.toLocaleString()}
                  </span>
                </div>
              )}

              {/* Bar Container */}
              <div className="relative h-2 bg-grid-line rounded-full overflow-hidden">
                {/* Animated Fill */}
                <motion.div
                  className={cn(
                    'absolute inset-y-0 left-0 rounded-full bg-gradient-to-r',
                    colors.bar
                  )}
                  initial={animate ? { width: 0 } : undefined}
                  animate={{ width: `${percentage}%` }}
                  transition={{
                    duration: 0.8,
                    delay: index * 0.1,
                    ease: 'easeOut',
                  }}
                  style={{
                    boxShadow: `0 0 12px ${colors.glow}`,
                  }}
                />

                {/* Glow Overlay */}
                <motion.div
                  className="absolute inset-y-0 left-0 rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${percentage}%` }}
                  transition={{ duration: 0.8, delay: index * 0.1 }}
                  style={{
                    background: `linear-gradient(90deg, transparent, ${colors.glow}, transparent)`,
                  }}
                />
              </div>

              {/* Progress Percentage */}
              {showProgress && (
                <motion.span
                  className="font-mono text-[10px] text-text-muted"
                  initial={animate ? { opacity: 0 } : undefined}
                  animate={{ opacity: 1 }}
                  transition={{ delay: index * 0.1 + 0.5 }}
                >
                  {percentage.toFixed(1)}%
                </motion.span>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

/**
 * Neon Stream Stat Card - Single metric display
 */
export function NeonStreamStat({
  label,
  value,
  trend,
  tier = 'primary',
  className,
}: {
  label: string;
  value: string | number;
  trend?: 'up' | 'down' | 'neutral';
  tier?: 'primary' | 'secondary' | 'accent';
  className?: string;
}) {
  const colors = tierColors[tier];

  return (
    <div className={cn('glass-panel p-4 rounded-lg', className)}>
      <span className="telemetry-label text-[10px] block mb-1">{label}</span>
      <div className="flex items-baseline gap-2">
        <span className={cn('font-display text-2xl font-bold', colors.text)}>
          {typeof value === 'number' ? value.toLocaleString() : value}
        </span>
        {trend && (
          <span
            className={cn(
              'text-xs font-mono',
              trend === 'up' && 'text-status-success',
              trend === 'down' && 'text-status-error',
              trend === 'neutral' && 'text-text-muted'
            )}
          >
            {trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→'}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * NeonStreamMini - Compact inline version
 */
export function NeonStreamMini({
  value,
  maxValue = 100,
  tier = 'primary',
  className,
}: {
  value: number;
  maxValue?: number;
  tier?: 'primary' | 'secondary' | 'accent';
  className?: string;
}) {
  const percentage = (value / maxValue) * 100;
  const colors = tierColors[tier];

  return (
    <div className={cn('h-1 bg-grid-line rounded-full overflow-hidden w-20', className)}>
      <motion.div
        className={cn('h-full rounded-full bg-gradient-to-r', colors.bar)}
        initial={{ width: 0 }}
        animate={{ width: `${percentage}%` }}
        style={{ boxShadow: `0 0 8px ${colors.glow}` }}
      />
    </div>
  );
}

export default NeonStream;
