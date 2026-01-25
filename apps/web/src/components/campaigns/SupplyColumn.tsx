'use client';

/**
 * Project Cortex | Supply Column
 *
 * Column 1: Publishers & Traffic Ingestion.
 */

import { Plus, Rss } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { PublisherCard } from './PublisherCard';
import type { CampaignPublisher } from '@/types/campaign';

interface SupplyColumnProps {
  publishers: CampaignPublisher[];
  onChange: (publishers: CampaignPublisher[]) => void;
  availableNumbers: { id: string; number: string }[];
  className?: string;
}

export function SupplyColumn({
  publishers,
  onChange,
  availableNumbers,
  className,
}: SupplyColumnProps) {
  const handleAddPublisher = () => {
    const newPublisher: CampaignPublisher = {
      id: `pub_${Date.now()}`,
      publisherId: '',
      publisherName: 'New Publisher',
      promoNumber: '',
      payoutModel: 'fixed',
      payoutAmount: 25,
      blockSpam: true,
      blockAnonymous: false,
    };
    onChange([...publishers, newPublisher]);
  };

  const handleUpdatePublisher = (index: number, publisher: CampaignPublisher) => {
    const updated = [...publishers];
    updated[index] = publisher;
    onChange(updated);
  };

  const handleRemovePublisher = (index: number) => {
    onChange(publishers.filter((_, i) => i !== index));
  };

  return (
    <div
      className={cn(
        'flex flex-col h-full rounded-xl overflow-hidden',
        'bg-panel/30 backdrop-blur-sm border border-white/5',
        className
      )}
    >
      {/* Column Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <div className="flex items-center gap-2">
          <Rss className="h-4 w-4 text-neon-cyan" />
          <span className="font-mono text-xs text-neon-cyan uppercase tracking-widest">SUPPLY</span>
        </div>
        <span className="font-mono text-[10px] text-text-muted">
          {publishers.length} PUBLISHERS
        </span>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
        {publishers.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-center">
            <Rss className="h-8 w-8 text-text-muted/30 mb-2" />
            <p className="font-mono text-xs text-text-muted">No publishers</p>
            <p className="font-mono text-[10px] text-text-muted/50">Add traffic sources</p>
          </div>
        ) : (
          publishers.map((pub, index) => (
            <PublisherCard
              key={pub.id}
              publisher={pub}
              availableNumbers={availableNumbers}
              onChange={p => handleUpdatePublisher(index, p)}
              onRemove={() => handleRemovePublisher(index)}
            />
          ))
        )}
      </div>

      {/* Add Button */}
      <div className="p-3 border-t border-white/5">
        <Button
          variant="outline"
          className="w-full gap-2 border-dashed border-white/20 text-text-muted hover:text-neon-cyan hover:border-neon-cyan/30"
          onClick={handleAddPublisher}
        >
          <Plus className="h-4 w-4" />
          ADD PUBLISHER
        </Button>
      </div>
    </div>
  );
}

export default SupplyColumn;
