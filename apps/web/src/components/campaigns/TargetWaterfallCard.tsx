'use client';

/**
 * Project Cortex | Target Waterfall Card
 *
 * Draggable target card for Demand column.
 * Shows global reference (read-only) + campaign-specific overrides.
 */

import { GripVertical, Phone, Clock, DollarSign, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { VerticalBadge } from '@/components/ppcall';
import { CapacityMeter } from '@/components/targets';
import type { CampaignTarget } from '@/types/campaign';
import { PRIORITY_ICONS } from '@/types/campaign';

interface TargetWaterfallCardProps {
  target: CampaignTarget;
  onChange: (target: CampaignTarget) => void;
  onRemove: () => void;
  isDragging?: boolean;
  className?: string;
}

export function TargetWaterfallCard({
  target,
  onChange,
  onRemove,
  isDragging,
  className,
}: TargetWaterfallCardProps) {
  const updateField = <K extends keyof CampaignTarget>(field: K, value: CampaignTarget[K]) => {
    onChange({ ...target, [field]: value });
  };

  const priorityIcon = PRIORITY_ICONS[target.priorityTier] || `${target.priorityTier}`;
  const isSkipped = target.isSkipped;

  return (
    <div
      className={cn(
        'relative rounded-xl overflow-hidden transition-all duration-300',
        'bg-panel/40 backdrop-blur-md border',
        isDragging && 'scale-[1.02] shadow-[0_0_30px_rgba(0,229,255,0.3)]',
        isSkipped
          ? 'border-status-warning/30 opacity-60'
          : 'border-white/10 hover:border-neon-cyan/30',
        className
      )}
    >
      {/* Left Accent Bar */}
      <div
        className={cn(
          'absolute left-0 top-0 bottom-0 w-[3px]',
          isSkipped ? 'bg-status-warning' : 'bg-neon-mint'
        )}
      />

      <div className="p-4 pl-5 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Drag Handle */}
            <div className="cursor-grab active:cursor-grabbing">
              <GripVertical className="h-4 w-4 text-text-muted" />
            </div>

            {/* Priority Icon */}
            <span className="text-lg">{priorityIcon}</span>

            {/* Target Info */}
            <div>
              <span className="font-display text-sm font-semibold text-text-primary">
                {target.buyerName}
              </span>
              <p className="font-mono text-[10px] text-text-muted">└─ {target.targetName}</p>
            </div>
          </div>

          <VerticalBadge vertical={target.vertical} size="sm" />
        </div>

        {/* Destination (Read-Only) */}
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-void/50 border border-white/5">
          <Phone className="h-3 w-3 text-neon-cyan" />
          <span className="font-mono text-xs text-neon-cyan">{target.destinationNumber}</span>
          <span className="ml-auto font-mono text-[9px] text-text-muted uppercase">READ-ONLY</span>
        </div>

        {/* Skip Reason */}
        {isSkipped && (
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-status-warning/10 border border-status-warning/20">
            <AlertTriangle className="h-3 w-3 text-status-warning" />
            <span className="font-mono text-xs text-status-warning uppercase">
              SKIPPED —{' '}
              {target.skipReason === 'capped'
                ? 'DAILY CAP REACHED'
                : target.skipReason?.toUpperCase()}
            </span>
          </div>
        )}

        {/* Override Grid */}
        <div className="grid grid-cols-4 gap-2">
          {/* Priority Tier */}
          <div className="space-y-1">
            <label className="font-mono text-[9px] text-text-muted uppercase tracking-widest">
              TIER
            </label>
            <Input
              type="number"
              min={1}
              max={10}
              value={target.priorityTier}
              onChange={e => updateField('priorityTier', parseInt(e.target.value) || 1)}
              className="h-8 bg-void border-white/10 font-mono text-xs text-center"
            />
          </div>

          {/* Weight */}
          <div className="space-y-1">
            <label className="font-mono text-[9px] text-text-muted uppercase tracking-widest">
              WEIGHT
            </label>
            <div className="relative">
              <Input
                type="number"
                min={0}
                max={100}
                value={target.weight}
                onChange={e => updateField('weight', parseInt(e.target.value) || 0)}
                className="h-8 bg-void border-white/10 font-mono text-xs text-center pr-6"
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-text-muted">
                %
              </span>
            </div>
          </div>

          {/* Buffer Override */}
          <div className="space-y-1">
            <label className="flex items-center gap-1 font-mono text-[9px] text-text-muted uppercase tracking-widest">
              <Clock className="h-2.5 w-2.5" />
              BUFFER
            </label>
            <div className="relative">
              <Input
                type="number"
                min={0}
                value={target.bufferOverride || ''}
                placeholder="—"
                onChange={e =>
                  updateField(
                    'bufferOverride',
                    e.target.value ? parseInt(e.target.value) : undefined
                  )
                }
                className="h-8 bg-void border-white/10 font-mono text-xs text-center pr-5"
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-text-muted">
                s
              </span>
            </div>
          </div>

          {/* Revenue Override */}
          <div className="space-y-1">
            <label className="flex items-center gap-1 font-mono text-[9px] text-text-muted uppercase tracking-widest">
              <DollarSign className="h-2.5 w-2.5" />
              REVENUE
            </label>
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-text-muted">
                $
              </span>
              <Input
                type="number"
                min={0}
                step={0.01}
                value={target.revenueOverride || ''}
                placeholder="—"
                onChange={e =>
                  updateField(
                    'revenueOverride',
                    e.target.value ? parseFloat(e.target.value) : undefined
                  )
                }
                className="h-8 bg-void border-white/10 font-mono text-xs text-center pl-5"
              />
            </div>
          </div>
        </div>

        {/* Campaign Caps */}
        <div className="grid grid-cols-2 gap-3 pt-2 border-t border-white/5">
          <CapacityMeter
            label="CAMPAIGN DAILY"
            used={target.campaignDailyUsed}
            cap={target.campaignDailyCap}
            size="sm"
          />
          <CapacityMeter
            label="CONCURRENCY"
            used={target.campaignCurrentCalls}
            cap={target.campaignConcurrency}
            size="sm"
          />
        </div>
      </div>
    </div>
  );
}

export default TargetWaterfallCard;
