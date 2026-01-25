'use client';

/**
 * Project Cortex | Qualified Flag
 *
 * Publisher-view indicator showing if call passed buffer threshold.
 * ✓ QUALIFIED (neon-mint) - duration >= buffer
 * ✗ MISSED (gray) - ended before buffer
 * ◐ BUFFERING (white) - still in progress
 */

import { Check, X, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

type QualifiedStatus = 'qualified' | 'missed' | 'buffering' | 'ringing';

interface QualifiedFlagProps {
  status: string;
  duration: number;
  bufferThreshold: number;
  isLive?: boolean;
  className?: string;
}

export function QualifiedFlag({
  status,
  duration,
  bufferThreshold,
  isLive = false,
  className,
}: QualifiedFlagProps) {
  // Determine qualified status
  const getQualifiedStatus = (): QualifiedStatus => {
    if (status === 'ringing') return 'ringing';
    if (isLive && duration < bufferThreshold) return 'buffering';
    if (duration >= bufferThreshold) return 'qualified';
    return 'missed';
  };

  const qualifiedStatus = getQualifiedStatus();

  const configs: Record<
    QualifiedStatus,
    {
      icon: typeof Check;
      label: string;
      colorClass: string;
      bgClass: string;
    }
  > = {
    qualified: {
      icon: Check,
      label: 'QUALIFIED',
      colorClass: 'text-neon-mint',
      bgClass: 'bg-neon-mint/10 border-neon-mint/30',
    },
    missed: {
      icon: X,
      label: 'MISSED',
      colorClass: 'text-text-muted',
      bgClass: 'bg-white/5 border-white/10',
    },
    buffering: {
      icon: Loader2,
      label: 'BUFFERING',
      colorClass: 'text-white',
      bgClass: 'bg-white/5 border-white/10',
    },
    ringing: {
      icon: Loader2,
      label: 'RINGING',
      colorClass: 'text-neon-cyan',
      bgClass: 'bg-neon-cyan/10 border-neon-cyan/30',
    },
  };

  const config = configs[qualifiedStatus];
  const Icon = config.icon;

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-1 rounded-md border',
        'font-mono text-[10px] uppercase tracking-wider',
        config.bgClass,
        config.colorClass,
        className
      )}
    >
      {qualifiedStatus === 'buffering' || qualifiedStatus === 'ringing' ? (
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        >
          <Icon className="h-3 w-3" />
        </motion.div>
      ) : (
        <Icon className="h-3 w-3" />
      )}
      <span className="font-semibold">{config.label}</span>
    </div>
  );
}

export default QualifiedFlag;
