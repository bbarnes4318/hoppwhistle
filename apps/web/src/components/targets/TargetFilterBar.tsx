'use client';

/**
 * Project Cortex | Target Filter Bar
 *
 * Filter buttons and search for targets list.
 */

import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

type FilterStatus = 'all' | 'active' | 'paused' | 'capped';

interface TargetFilterBarProps {
  filter: FilterStatus;
  onFilterChange: (filter: FilterStatus) => void;
  search: string;
  onSearchChange: (search: string) => void;
  counts: {
    all: number;
    active: number;
    paused: number;
    capped: number;
  };
  className?: string;
}

const filters: { value: FilterStatus; label: string }[] = [
  { value: 'all', label: 'ALL' },
  { value: 'active', label: 'ACTIVE' },
  { value: 'paused', label: 'PAUSED' },
  { value: 'capped', label: 'CAPPED' },
];

export function TargetFilterBar({
  filter,
  onFilterChange,
  search,
  onSearchChange,
  counts,
  className,
}: TargetFilterBarProps) {
  return (
    <div className={cn('flex items-center justify-between gap-4 px-4 py-3', className)}>
      {/* Filter Buttons */}
      <div className="flex items-center gap-1 rounded-lg border border-white/5 bg-panel/50 p-1">
        {filters.map(f => (
          <Button
            key={f.value}
            variant={filter === f.value ? 'default' : 'ghost'}
            size="sm"
            onClick={() => onFilterChange(f.value)}
            className={cn(
              'h-7 px-3 gap-1.5 font-mono text-[10px]',
              filter === f.value
                ? 'bg-neon-cyan text-void'
                : 'text-text-secondary hover:text-text-primary hover:bg-white/5'
            )}
          >
            {f.label}
            <span
              className={cn(
                'px-1.5 py-0.5 rounded text-[9px]',
                filter === f.value ? 'bg-void/20 text-void' : 'bg-white/5 text-text-muted'
              )}
            >
              {counts[f.value]}
            </span>
          </Button>
        ))}
      </div>

      {/* Search */}
      <div className="relative w-64">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
        <Input
          id="targets-search"
          name="targets-search"
          placeholder="Search buyers..."
          value={search}
          onChange={e => onSearchChange(e.target.value)}
          className={cn(
            'pl-10 h-8 bg-void border-white/10 font-mono text-xs',
            'placeholder:text-text-muted/50',
            'focus:border-neon-cyan focus:ring-neon-cyan/20'
          )}
        />
      </div>
    </div>
  );
}

export default TargetFilterBar;
