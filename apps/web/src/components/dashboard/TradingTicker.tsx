'use client';

/**
 * Project Cortex | Trading Ticker
 *
 * Row 1 of the Trading Desk - Compact financial metrics bar.
 * Includes:
 * - The Spread: GROSS REVENUE | PUB PAYOUT | NET MARGIN
 * - Vertical Ticker: Scrolling CPA/CPL rates
 */

import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, Activity, Users, Phone, DollarSign } from 'lucide-react';
import { cn } from '@/lib/utils';
import { VerticalTicker } from './VerticalTicker';

interface TradingTickerProps {
  grossRevenue: number;
  publisherCost: number;
  netYield: number;
  marginPercent: number;
  activeCalls: number;
  billableCalls: number;
  todayCalls: number;
  className?: string;
}

export function TradingTicker({
  grossRevenue,
  publisherCost,
  netYield,
  marginPercent,
  activeCalls,
  billableCalls,
  todayCalls,
  className,
}: TradingTickerProps) {
  const isPositiveYield = netYield > 0;

  return (
    <div className={cn('space-y-2', className)}>
      {/* Main Metrics Row */}
      <div
        className={cn(
          'flex items-center justify-between gap-4 p-3 rounded-xl',
          'bg-panel/60 backdrop-blur-sm border border-white/5'
        )}
      >
        {/* Left: The Spread (Financials) */}
        <div className="flex items-center gap-6">
          {/* Gross Revenue */}
          <div className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-neon-cyan" />
            <div>
              <p className="font-mono text-[10px] text-text-muted uppercase tracking-widest">
                GROSS REVENUE
              </p>
              <p className="font-display text-xl font-bold text-neon-cyan tabular-nums">
                ${grossRevenue.toLocaleString()}
              </p>
            </div>
          </div>

          {/* Publisher Payout */}
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-status-warning" />
            <div>
              <p className="font-mono text-[10px] text-text-muted uppercase tracking-widest">
                PUB PAYOUT
              </p>
              <p className="font-display text-xl font-bold text-status-warning tabular-nums">
                -${publisherCost.toLocaleString()}
              </p>
            </div>
          </div>

          {/* Divider */}
          <div className="w-px h-10 bg-white/10" />

          {/* NET MARGIN - Neon Mint, Space Grotesk Bold */}
          <div className="flex items-center gap-2">
            {isPositiveYield ? (
              <TrendingUp className="h-5 w-5 text-neon-mint" />
            ) : (
              <TrendingDown className="h-5 w-5 text-status-error" />
            )}
            <div>
              <p className="font-mono text-[10px] text-text-muted uppercase tracking-widest">
                NET MARGIN
              </p>
              <p
                className={cn(
                  'font-display text-2xl font-bold tabular-nums',
                  isPositiveYield ? 'text-neon-mint' : 'text-status-error'
                )}
              >
                {isPositiveYield ? '+' : ''}${netYield.toLocaleString()}
              </p>
            </div>
            <span
              className={cn(
                'ml-2 px-2 py-0.5 rounded text-sm font-display font-bold',
                isPositiveYield
                  ? 'bg-neon-mint/10 text-neon-mint'
                  : 'bg-status-error/10 text-status-error'
              )}
            >
              {marginPercent.toFixed(1)}%
            </span>
          </div>
        </div>

        {/* Right: Activity Metrics */}
        <div className="flex items-center gap-6">
          {/* Active Calls */}
          <div className="flex items-center gap-2">
            <motion.div
              className="w-2 h-2 rounded-full bg-toxic-lime"
              animate={{ opacity: [1, 0.4, 1] }}
              transition={{ duration: 1.5, repeat: Infinity }}
            />
            <div>
              <p className="font-mono text-[10px] text-text-muted uppercase">ACTIVE</p>
              <p className="font-display text-lg font-bold text-toxic-lime">{activeCalls}</p>
            </div>
          </div>

          {/* Billable */}
          <div className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-neon-mint" />
            <div>
              <p className="font-mono text-[10px] text-text-muted uppercase">BILLABLE</p>
              <p className="font-display text-lg font-bold text-neon-mint">{billableCalls}</p>
            </div>
          </div>

          {/* Today Total */}
          <div className="flex items-center gap-2">
            <Phone className="h-4 w-4 text-neon-cyan" />
            <div>
              <p className="font-mono text-[10px] text-text-muted uppercase">TODAY</p>
              <p className="font-display text-lg font-bold text-neon-cyan">{todayCalls}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Vertical Ticker (Scrolling CPA/CPL rates) */}
      <VerticalTicker />
    </div>
  );
}

export default TradingTicker;
