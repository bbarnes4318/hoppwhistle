'use client';

/**
 * Project Cortex | Publisher Card
 *
 * Publisher configuration card for Supply column.
 * Glassmorphism styling with DID assignment and payout model.
 */

import { Rss, Trash2, Phone, DollarSign, Percent, ShieldAlert, ShieldOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import type { CampaignPublisher, PayoutModel } from '@/types/campaign';

interface PublisherCardProps {
  publisher: CampaignPublisher;
  availableNumbers: { id: string; number: string }[];
  onChange: (publisher: CampaignPublisher) => void;
  onRemove: () => void;
  className?: string;
}

export function PublisherCard({
  publisher,
  availableNumbers,
  onChange,
  onRemove,
  className,
}: PublisherCardProps) {
  const updateField = <K extends keyof CampaignPublisher>(
    field: K,
    value: CampaignPublisher[K]
  ) => {
    onChange({ ...publisher, [field]: value });
  };

  return (
    <div
      className={cn(
        'relative rounded-xl overflow-hidden',
        'bg-panel/40 backdrop-blur-md border border-white/10',
        'hover:border-neon-cyan/20 transition-all duration-300',
        className
      )}
    >
      {/* Left Accent Bar */}
      <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-neon-cyan" />

      <div className="p-4 pl-5 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Rss className="h-4 w-4 text-neon-cyan" />
            <span className="font-display text-sm font-semibold text-text-primary">
              {publisher.publisherName}
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onRemove}
            className="h-6 w-6 text-text-muted hover:text-status-error hover:bg-status-error/10"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>

        {/* Promo Number (DID Assignment) */}
        <div className="space-y-1">
          <label className="flex items-center gap-1.5 font-mono text-[10px] text-text-muted uppercase tracking-widest">
            <Phone className="h-3 w-3" />
            PROMO NUMBER
          </label>
          <select
            value={publisher.promoNumber}
            onChange={e => updateField('promoNumber', e.target.value)}
            className={cn(
              'w-full h-9 px-3 rounded-lg',
              'bg-void border border-white/10',
              'font-mono text-sm text-neon-cyan',
              'focus:border-neon-cyan focus:ring-1 focus:ring-neon-cyan/30'
            )}
          >
            <option value="">Select DID...</option>
            {availableNumbers.map(n => (
              <option key={n.id} value={n.number}>
                {n.number}
              </option>
            ))}
          </select>
        </div>

        {/* Payout Model */}
        <div className="space-y-2">
          <span className="font-mono text-[10px] text-text-muted uppercase tracking-widest">
            PAYOUT MODEL
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => updateField('payoutModel', 'fixed')}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg font-mono text-xs transition-all',
                publisher.payoutModel === 'fixed'
                  ? 'bg-neon-cyan text-void'
                  : 'bg-panel border border-white/10 text-text-muted hover:text-text-primary'
              )}
            >
              <DollarSign className="h-3 w-3" />
              FIXED
            </button>
            <button
              onClick={() => updateField('payoutModel', 'revshare')}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg font-mono text-xs transition-all',
                publisher.payoutModel === 'revshare'
                  ? 'bg-neon-violet text-void'
                  : 'bg-panel border border-white/10 text-text-muted hover:text-text-primary'
              )}
            >
              <Percent className="h-3 w-3" />
              REVSHARE
            </button>
          </div>

          {/* Payout Amount */}
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-text-muted">
              {publisher.payoutModel === 'fixed' ? '$' : ''}
            </span>
            <Input
              type="number"
              value={publisher.payoutAmount}
              onChange={e => updateField('payoutAmount', parseFloat(e.target.value) || 0)}
              className={cn(
                'bg-void border-white/10 font-mono',
                publisher.payoutModel === 'fixed' ? 'pl-7' : 'pr-7'
              )}
            />
            {publisher.payoutModel === 'revshare' && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-sm text-text-muted">
                %
              </span>
            )}
          </div>
        </div>

        {/* Quality Filters */}
        <div className="space-y-2">
          <span className="font-mono text-[10px] text-text-muted uppercase tracking-widest">
            QUALITY FILTERS
          </span>
          <div className="space-y-2">
            <label className="flex items-center justify-between">
              <span className="flex items-center gap-2 font-mono text-xs text-text-secondary">
                <ShieldAlert className="h-3 w-3" />
                Block Anonymous
              </span>
              <Switch
                checked={publisher.blockAnonymous}
                onCheckedChange={v => updateField('blockAnonymous', v)}
                className="data-[state=checked]:bg-neon-cyan"
              />
            </label>
            <label className="flex items-center justify-between">
              <span className="flex items-center gap-2 font-mono text-xs text-text-secondary">
                <ShieldOff className="h-3 w-3" />
                Block Spam/Robocalls
              </span>
              <Switch
                checked={publisher.blockSpam}
                onCheckedChange={v => updateField('blockSpam', v)}
                className="data-[state=checked]:bg-neon-cyan"
              />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PublisherCard;
