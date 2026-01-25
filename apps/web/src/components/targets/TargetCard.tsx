'use client';

/**
 * Project Cortex | Target Card
 *
 * Individual buyer endpoint card with connectivity, caps, and dayparting.
 */

import { Building2, Phone, Settings, Pause, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GlassPanel } from '@/components/ui/glass-panel';
import { Button } from '@/components/ui/button';
import { VerticalBadge } from '@/components/ppcall';
import { CapacityMeter } from './CapacityMeter';
import { DaypartingIndicator } from './DaypartingIndicator';
import type { Target } from '@/types/target';
import { isTargetOpen, formatTargetNumber } from '@/types/target';

interface TargetCardProps {
  target: Target;
  onEdit?: (target: Target) => void;
  onTogglePause?: (target: Target) => void;
  className?: string;
}

export function TargetCard({ target, onEdit, onTogglePause, className }: TargetCardProps) {
  const isOpen = isTargetOpen(target);
  const isCapped =
    target.currentConcurrency >= target.concurrencyCap || target.dailyUsed >= target.dailyCap;

  // Determine accent color based on status
  const getAccentColor = (): 'cyan' | 'violet' | 'lime' => {
    if (target.isPaused) return 'violet';
    if (isCapped) return 'lime';
    return 'cyan';
  };

  return (
    <GlassPanel
      active={!target.isPaused}
      accentColor={getAccentColor()}
      className={cn('p-4 transition-all duration-300', target.isPaused && 'opacity-60', className)}
    >
      {/* Header Row */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-start gap-3">
          {/* Buyer Icon */}
          <div
            className={cn(
              'flex items-center justify-center w-10 h-10 rounded-lg',
              'bg-neon-cyan/10 border border-neon-cyan/20'
            )}
          >
            <Building2 className="h-5 w-5 text-neon-cyan" />
          </div>

          {/* Identity */}
          <div>
            <h3 className="font-display text-lg font-semibold text-text-primary">
              {target.buyerName}
            </h3>
            <p className="font-mono text-xs text-text-muted">└─ {target.targetName}</p>
          </div>
        </div>

        {/* Status & Dayparting */}
        <div className="flex items-center gap-4">
          <VerticalBadge vertical={target.vertical} size="sm" />
          <DaypartingIndicator
            hoursOfOperation={target.hoursOfOperation}
            timezone={target.timezone}
            isOpen={isOpen}
            size="sm"
          />
        </div>
      </div>

      {/* Connectivity & Constraints Grid */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        {/* Destination Number */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Phone className="h-3 w-3 text-text-muted" />
            <span className="font-mono text-[10px] text-text-muted uppercase tracking-widest">
              DESTINATION
            </span>
          </div>
          <p className="font-mono text-sm text-neon-cyan font-medium">
            {formatTargetNumber(target.destinationNumber)}
          </p>
          <span className="font-mono text-[9px] text-text-muted uppercase">
            {target.destinationType.toUpperCase()}
          </span>
        </div>

        {/* Concurrency Cap */}
        <CapacityMeter
          label="CONCURRENCY"
          used={target.currentConcurrency}
          cap={target.concurrencyCap}
          unit="SLOTS"
        />

        {/* Daily Cap */}
        <CapacityMeter
          label="DAILY CAP"
          used={target.dailyUsed}
          cap={target.dailyCap}
          unit="CONV"
        />
      </div>

      {/* Hours & Actions Row */}
      <div className="flex items-center justify-between pt-3 border-t border-white/5">
        {/* Full Hours Display */}
        <DaypartingIndicator
          hoursOfOperation={target.hoursOfOperation}
          timezone={target.timezone}
          isOpen={isOpen}
          size="md"
        />

        {/* Actions */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onEdit?.(target)}
            className="gap-1.5 border-white/10 text-text-muted hover:text-neon-cyan hover:border-neon-cyan/30"
          >
            <Settings className="h-3 w-3" />
            CONFIGURE
          </Button>

          <Button
            variant={target.isPaused ? 'default' : 'outline'}
            size="sm"
            onClick={() => onTogglePause?.(target)}
            className={cn(
              'gap-1.5',
              target.isPaused
                ? 'bg-status-success hover:bg-status-success/80 text-void'
                : 'border-status-warning/30 text-status-warning hover:bg-status-warning/10'
            )}
          >
            {target.isPaused ? (
              <>
                <Play className="h-3 w-3" />
                RESUME
              </>
            ) : (
              <>
                <Pause className="h-3 w-3" />
                PAUSE
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Paused Overlay */}
      {target.isPaused && (
        <div className="absolute inset-0 flex items-center justify-center bg-void/50 backdrop-blur-[1px] rounded-xl">
          <span className="px-4 py-2 rounded-lg bg-status-warning/10 border border-status-warning/30 font-mono text-sm text-status-warning uppercase">
            ⏸ TARGET PAUSED
          </span>
        </div>
      )}
    </GlassPanel>
  );
}

export default TargetCard;
