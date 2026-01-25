'use client';

/**
 * Project Cortex | Vertical Ticker
 *
 * Scrolling marquee showing CPA/CPL rates per vertical.
 */

import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface VerticalRate {
  vertical: string;
  rate: number;
  type: 'CPA' | 'CPL';
}

interface VerticalTickerProps {
  rates?: VerticalRate[];
  className?: string;
}

const defaultRates: VerticalRate[] = [
  { vertical: 'ACA', rate: 52, type: 'CPA' },
  { vertical: 'MVA', rate: 120, type: 'CPL' },
  { vertical: 'MEDICARE', rate: 45, type: 'CPL' },
  { vertical: 'ROOFING', rate: 35, type: 'CPL' },
  { vertical: 'MASS TORT', rate: 150, type: 'CPL' },
  { vertical: 'SOLAR', rate: 45, type: 'CPA' },
  { vertical: 'FINAL EXP', rate: 25, type: 'CPL' },
  { vertical: 'DME', rate: 75, type: 'CPL' },
  { vertical: 'HVAC', rate: 28, type: 'CPA' },
  { vertical: 'PI', rate: 85, type: 'CPL' },
];

export function VerticalTicker({ rates = defaultRates, className }: VerticalTickerProps) {
  // Duplicate rates for seamless loop
  const duplicatedRates = [...rates, ...rates];

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-lg bg-panel/40 border border-white/5',
        className
      )}
    >
      {/* Gradient fade edges */}
      <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-panel to-transparent z-10" />
      <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-panel to-transparent z-10" />

      {/* Scrolling content */}
      <motion.div
        className="flex items-center gap-6 py-2 px-4 whitespace-nowrap"
        animate={{ x: ['0%', '-50%'] }}
        transition={{
          duration: 30,
          repeat: Infinity,
          ease: 'linear',
        }}
      >
        {duplicatedRates.map((rate, i) => (
          <span key={`${rate.vertical}-${i}`} className="flex items-center gap-2">
            <span className="font-mono text-xs text-text-muted uppercase">{rate.vertical}:</span>
            <span className="font-display text-sm font-bold text-neon-mint">${rate.rate}</span>
            <span className="font-mono text-[10px] text-neon-cyan">{rate.type}</span>
            <span className="text-white/20 ml-4">•</span>
          </span>
        ))}
      </motion.div>
    </div>
  );
}

export default VerticalTicker;
