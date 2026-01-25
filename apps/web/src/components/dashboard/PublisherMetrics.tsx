'use client';

/**
 * Project Cortex | Publisher Metrics
 *
 * Dashboard metrics for publisher view:
 * - Qualified Calls
 * - Revenue Per Call (RPC)
 * - Total Payout
 */

import { Check, DollarSign, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PublisherMetricsProps {
  qualifiedCalls: number;
  totalCalls: number;
  revenuePerCall: number;
  totalPayout: number;
  className?: string;
}

export function PublisherMetrics({
  qualifiedCalls,
  totalCalls,
  revenuePerCall,
  totalPayout,
  className,
}: PublisherMetricsProps) {
  const qualifyRate = totalCalls > 0 ? ((qualifiedCalls / totalCalls) * 100).toFixed(1) : 0;

  return (
    <div
      className={cn(
        'flex items-center gap-6 p-4 rounded-xl',
        'bg-panel/60 backdrop-blur-sm border border-white/5',
        className
      )}
    >
      {/* Qualified Calls */}
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-neon-mint/10 border border-neon-mint/20">
          <Check className="h-5 w-5 text-neon-mint" />
        </div>
        <div>
          <p className="font-mono text-[10px] text-text-muted uppercase tracking-widest">
            QUALIFIED CALLS
          </p>
          <div className="flex items-baseline gap-2">
            <p className="font-display text-2xl font-bold text-neon-mint tabular-nums">
              {qualifiedCalls}
            </p>
            <span className="font-mono text-xs text-text-muted">/ {totalCalls}</span>
            <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-neon-mint/10 text-neon-mint">
              {qualifyRate}%
            </span>
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="w-px h-12 bg-white/10" />

      {/* RPC */}
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-neon-cyan/10 border border-neon-cyan/20">
          <TrendingUp className="h-5 w-5 text-neon-cyan" />
        </div>
        <div>
          <p className="font-mono text-[10px] text-text-muted uppercase tracking-widest">
            REVENUE PER CALL
          </p>
          <p className="font-display text-2xl font-bold text-neon-cyan tabular-nums">
            ${revenuePerCall.toFixed(2)}
          </p>
        </div>
      </div>

      {/* Divider */}
      <div className="w-px h-12 bg-white/10" />

      {/* Total Payout */}
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-neon-mint/10 border border-neon-mint/20">
          <DollarSign className="h-5 w-5 text-neon-mint" />
        </div>
        <div>
          <p className="font-mono text-[10px] text-text-muted uppercase tracking-widest">
            TOTAL PAYOUT
          </p>
          <p className="font-display text-2xl font-bold text-neon-mint tabular-nums">
            ${totalPayout.toLocaleString()}
          </p>
        </div>
      </div>
    </div>
  );
}

export default PublisherMetrics;
