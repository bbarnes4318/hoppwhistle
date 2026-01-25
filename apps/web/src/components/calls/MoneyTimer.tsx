'use client';

/**
 * Project Cortex | Money Timer
 *
 * Displays call duration with buffer progress bar.
 * Flashes Toxic Lime when monetized (BILLABLE).
 */

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface MoneyTimerProps {
  duration: number; // Current duration in seconds
  bufferThreshold: number; // Buffer limit (e.g., 90s)
  isLive?: boolean; // If true, timer increments
  estimatedRevenue?: number; // Est. revenue when billable
  className?: string;
}

export function MoneyTimer({
  duration,
  bufferThreshold,
  isLive = false,
  estimatedRevenue,
  className,
}: MoneyTimerProps) {
  const [currentDuration, setCurrentDuration] = useState(duration);
  const isBillable = currentDuration >= bufferThreshold;
  const bufferPercent = Math.min(100, (currentDuration / bufferThreshold) * 100);

  // Live timer increment
  useEffect(() => {
    if (!isLive) return;

    const interval = setInterval(() => {
      setCurrentDuration(prev => prev + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [isLive]);

  // Sync with prop changes
  useEffect(() => {
    setCurrentDuration(duration);
  }, [duration]);

  // Format duration
  const formatDuration = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    return `${mins}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className={cn('space-y-1', className)}>
      {/* Timer Display */}
      <div className="flex items-center gap-2">
        <motion.span
          className={cn(
            'font-mono text-sm font-bold tabular-nums',
            isBillable ? 'text-toxic-lime' : 'text-white'
          )}
          animate={isBillable && isLive ? { opacity: [1, 0.6, 1] } : {}}
          transition={{ duration: 0.8, repeat: Infinity }}
        >
          {formatDuration(currentDuration)}
        </motion.span>

        {/* Status Badge */}
        {isBillable ? (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase bg-toxic-lime/20 text-toxic-lime border border-toxic-lime/30">
            BILLABLE
          </span>
        ) : (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-mono uppercase bg-white/5 text-text-muted">
            BUFFERING
          </span>
        )}

        {/* Estimated Revenue */}
        {isBillable && estimatedRevenue && (
          <span className="font-mono text-xs text-neon-mint font-semibold">
            +${estimatedRevenue.toFixed(2)}
          </span>
        )}
      </div>

      {/* Buffer Progress Bar */}
      <div className="relative h-1.5 w-full rounded-full bg-panel border border-white/5 overflow-hidden">
        <motion.div
          className={cn(
            'h-full rounded-full transition-colors duration-300',
            isBillable ? 'bg-toxic-lime shadow-[0_0_8px_rgba(204,255,0,0.5)]' : 'bg-text-muted/50'
          )}
          initial={{ width: 0 }}
          animate={{ width: `${bufferPercent}%` }}
          transition={{ duration: 0.3 }}
        />

        {/* Buffer threshold marker */}
        <div
          className="absolute top-0 bottom-0 w-px bg-neon-cyan/50"
          style={{ left: '100%', transform: 'translateX(-1px)' }}
        />
      </div>

      {/* Buffer label */}
      <div className="flex items-center justify-between">
        <span className="font-mono text-[9px] text-text-muted">0s</span>
        <span className="font-mono text-[9px] text-neon-cyan">{bufferThreshold}s</span>
      </div>
    </div>
  );
}

export default MoneyTimer;
