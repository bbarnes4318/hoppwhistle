'use client';

/**
 * Project Cortex | Buffer Countdown
 *
 * Countdown timer for call buffer threshold.
 * Turns Neon Mint when timer hits 0 (MONEY MADE).
 */

import { motion } from 'framer-motion';
import { DollarSign, Clock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

interface BufferCountdownProps {
  /** Total buffer threshold in seconds */
  bufferThreshold: number;
  /** Current call duration in seconds */
  duration: number;
  /** Whether the call is active */
  isActive?: boolean;
  /** Buyer payout when billable */
  payout?: number;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Additional class names */
  className?: string;
}

export function BufferCountdown({
  bufferThreshold,
  duration,
  isActive = true,
  payout,
  size = 'md',
  className,
}: BufferCountdownProps) {
  const remaining = Math.max(0, bufferThreshold - duration);
  const isBillable = remaining === 0 && duration > 0;
  const progress = Math.min(100, (duration / bufferThreshold) * 100);

  const sizeClasses = {
    sm: {
      container: 'h-6',
      text: 'text-xs',
      icon: 'h-3 w-3',
    },
    md: {
      container: 'h-8',
      text: 'text-sm',
      icon: 'h-4 w-4',
    },
    lg: {
      container: 'h-10',
      text: 'text-base',
      icon: 'h-5 w-5',
    },
  };

  const s = sizeClasses[size];

  // Format time as MM:SS
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {/* Status Label */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isBillable ? (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="flex items-center gap-1"
            >
              <DollarSign className={cn(s.icon, 'text-neon-mint')} />
              <span
                className={cn(
                  'font-mono font-bold uppercase tracking-widest text-neon-mint',
                  s.text
                )}
              >
                BILLABLE
              </span>
            </motion.div>
          ) : (
            <div className="flex items-center gap-1">
              <Clock className={cn(s.icon, 'text-neon-cyan')} />
              <span className={cn('font-mono uppercase tracking-widest text-text-muted', s.text)}>
                BUFFER
              </span>
            </div>
          )}
        </div>

        {/* Countdown or Payout */}
        <span
          className={cn(
            'font-mono font-bold tabular-nums',
            s.text,
            isBillable ? 'text-neon-mint' : 'text-neon-cyan'
          )}
        >
          {isBillable ? (payout ? `+$${payout.toFixed(2)}` : '💰') : formatTime(remaining)}
        </span>
      </div>

      {/* Progress Bar */}
      <div
        className={cn(
          'relative w-full rounded-full overflow-hidden bg-panel border border-white/5',
          s.container
        )}
      >
        {/* Background Track */}
        <div className="absolute inset-0 bg-white/5" />

        {/* Progress Fill */}
        <motion.div
          className={cn(
            'absolute inset-y-0 left-0 rounded-full',
            isBillable
              ? 'bg-gradient-to-r from-neon-mint/80 to-neon-mint'
              : 'bg-gradient-to-r from-neon-cyan/50 to-neon-cyan'
          )}
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        />

        {/* Glow Effect when Billable */}
        {isBillable && (
          <motion.div
            className="absolute inset-0 rounded-full"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0.3, 0.6, 0.3] }}
            transition={{ duration: 1.5, repeat: Infinity }}
            style={{
              boxShadow: '0 0 20px rgba(0, 255, 159, 0.5), inset 0 0 10px rgba(0, 255, 159, 0.3)',
            }}
          />
        )}

        {/* Threshold Marker */}
        {!isBillable && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-white/30"
            style={{ left: '100%', transform: 'translateX(-2px)' }}
          />
        )}
      </div>

      {/* Duration Display */}
      {isActive && (
        <div className="flex justify-between text-[10px] font-mono text-text-muted">
          <span>{formatTime(duration)}</span>
          <span>{formatTime(bufferThreshold)}</span>
        </div>
      )}
    </div>
  );
}

/**
 * BufferCountdownCompact - Inline version for tables
 */
export function BufferCountdownCompact({
  bufferThreshold,
  duration,
  payout,
  className,
}: {
  bufferThreshold: number;
  duration: number;
  payout?: number;
  className?: string;
}) {
  const remaining = Math.max(0, bufferThreshold - duration);
  const isBillable = remaining === 0 && duration > 0;
  const progress = Math.min(100, (duration / bufferThreshold) * 100);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {/* Mini Progress Bar */}
      <div className="relative w-16 h-2 rounded-full bg-panel border border-white/5 overflow-hidden">
        <motion.div
          className={cn(
            'absolute inset-y-0 left-0 rounded-full',
            isBillable ? 'bg-neon-mint' : 'bg-neon-cyan'
          )}
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Time or Payout */}
      <span
        className={cn(
          'font-mono text-xs tabular-nums',
          isBillable ? 'text-neon-mint font-bold' : 'text-text-muted'
        )}
      >
        {isBillable ? (payout ? `+$${payout.toFixed(0)}` : '💰') : formatTime(remaining)}
      </span>
    </div>
  );
}

export default BufferCountdown;
