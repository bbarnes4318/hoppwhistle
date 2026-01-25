'use client';

/**
 * Project Cortex | Logic Gate Column
 *
 * Column 2: Traffic Filters (IVR, Geo, Dupe, Schedule).
 */

import { useState } from 'react';
import { Mic, Map, RefreshCcw, Calendar, Upload, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { FilterCard } from './FilterCard';
import { DaySelector } from '@/components/targets/DaypartingIndicator';
import type { CampaignFilters } from '@/types/campaign';
import { US_STATES } from '@/types/campaign';

interface LogicGateColumnProps {
  filters: CampaignFilters;
  onChange: (filters: CampaignFilters) => void;
  className?: string;
}

export function LogicGateColumn({ filters, onChange, className }: LogicGateColumnProps) {
  const updateFilter = <K extends keyof CampaignFilters>(key: K, value: CampaignFilters[K]) => {
    onChange({ ...filters, [key]: value });
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
          <div className="w-2 h-2 rounded-full bg-neon-violet animate-pulse" />
          <span className="font-mono text-xs text-neon-violet uppercase tracking-widest">
            LOGIC GATE
          </span>
        </div>
        <span className="font-mono text-[10px] text-text-muted">FILTER CORE</span>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
        {/* IVR Prompt */}
        <FilterCard
          icon={Mic}
          title="IVR PROMPT"
          enabled={filters.ivr.enabled}
          onToggle={v => updateFilter('ivr', { ...filters.ivr, enabled: v })}
        >
          <div className="space-y-3">
            {/* Audio Upload */}
            <div className="flex items-center gap-2 p-2 rounded-lg bg-void/50 border border-dashed border-white/10">
              {filters.ivr.audioUrl ? (
                <>
                  <Mic className="h-4 w-4 text-neon-cyan" />
                  <span className="flex-1 font-mono text-xs text-text-primary truncate">
                    {filters.ivr.audioName || 'greeting.mp3'}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() =>
                      updateFilter('ivr', {
                        ...filters.ivr,
                        audioUrl: undefined,
                        audioName: undefined,
                      })
                    }
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 text-text-muted" />
                  <span className="font-mono text-xs text-text-muted">Upload audio file</span>
                </>
              )}
            </div>

            {/* Keypress Config */}
            <div className="space-y-1">
              <span className="font-mono text-[10px] text-text-muted uppercase">
                KEYPRESS ROUTING
              </span>
              <Input
                placeholder="1 = Sales, 2 = Support"
                className="bg-void border-white/10 font-mono text-xs"
              />
            </div>
          </div>
        </FilterCard>

        {/* Geo-Fencing */}
        <FilterCard
          icon={Map}
          title="GEO-FENCING"
          enabled={filters.geoFencing.enabled}
          onToggle={v => updateFilter('geoFencing', { ...filters.geoFencing, enabled: v })}
        >
          <div className="space-y-3">
            {/* Mode Toggle */}
            <div className="flex gap-2">
              <button
                onClick={() => updateFilter('geoFencing', { ...filters.geoFencing, mode: 'allow' })}
                className={cn(
                  'flex-1 h-7 rounded-lg font-mono text-[10px] uppercase transition-all',
                  filters.geoFencing.mode === 'allow'
                    ? 'bg-neon-mint text-void'
                    : 'bg-panel border border-white/10 text-text-muted'
                )}
              >
                ALLOW LIST
              </button>
              <button
                onClick={() => updateFilter('geoFencing', { ...filters.geoFencing, mode: 'block' })}
                className={cn(
                  'flex-1 h-7 rounded-lg font-mono text-[10px] uppercase transition-all',
                  filters.geoFencing.mode === 'block'
                    ? 'bg-status-error text-white'
                    : 'bg-panel border border-white/10 text-text-muted'
                )}
              >
                BLOCK LIST
              </button>
            </div>

            {/* State Tags */}
            <div className="flex flex-wrap gap-1">
              {filters.geoFencing.states.map(state => (
                <span
                  key={state}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-neon-cyan/10 border border-neon-cyan/20 font-mono text-[10px] text-neon-cyan"
                >
                  {state}
                  <button
                    onClick={() =>
                      updateFilter('geoFencing', {
                        ...filters.geoFencing,
                        states: filters.geoFencing.states.filter(s => s !== state),
                      })
                    }
                    className="hover:text-white"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              ))}
              <select
                className="h-5 px-1 rounded bg-void border border-white/10 font-mono text-[10px] text-text-muted"
                value=""
                onChange={e => {
                  if (e.target.value && !filters.geoFencing.states.includes(e.target.value)) {
                    updateFilter('geoFencing', {
                      ...filters.geoFencing,
                      states: [...filters.geoFencing.states, e.target.value],
                    });
                  }
                }}
              >
                <option value="">+ Add</option>
                {US_STATES.filter(s => !filters.geoFencing.states.includes(s)).map(state => (
                  <option key={state} value={state}>
                    {state}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </FilterCard>

        {/* Duplicate Check */}
        <FilterCard
          icon={RefreshCcw}
          title="DUPLICATE CHECK"
          description="Block repeat callers from same ANI"
          enabled={filters.dupeCheck.enabled}
          onToggle={v => updateFilter('dupeCheck', { ...filters.dupeCheck, enabled: v })}
        >
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-text-muted">Lookback:</span>
            <Input
              type="number"
              value={filters.dupeCheck.lookbackDays}
              onChange={e =>
                updateFilter('dupeCheck', {
                  ...filters.dupeCheck,
                  lookbackDays: parseInt(e.target.value) || 30,
                })
              }
              className="w-16 h-7 bg-void border-white/10 font-mono text-xs text-center"
            />
            <span className="font-mono text-xs text-text-muted">Days</span>
          </div>
        </FilterCard>

        {/* Schedule */}
        <FilterCard
          icon={Calendar}
          title="SCHEDULE"
          enabled={filters.schedule.enabled}
          onToggle={v => updateFilter('schedule', { ...filters.schedule, enabled: v })}
        >
          <div className="space-y-3">
            {/* Day Selector */}
            <DaySelector
              selected={filters.schedule.daysOfWeek}
              onChange={days => updateFilter('schedule', { ...filters.schedule, daysOfWeek: days })}
            />

            {/* Time Range */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <span className="font-mono text-[9px] text-text-muted uppercase">START</span>
                <Input
                  type="time"
                  value={filters.schedule.startTime}
                  onChange={e =>
                    updateFilter('schedule', { ...filters.schedule, startTime: e.target.value })
                  }
                  className="h-7 bg-void border-white/10 font-mono text-xs"
                />
              </div>
              <div className="space-y-1">
                <span className="font-mono text-[9px] text-text-muted uppercase">END</span>
                <Input
                  type="time"
                  value={filters.schedule.endTime}
                  onChange={e =>
                    updateFilter('schedule', { ...filters.schedule, endTime: e.target.value })
                  }
                  className="h-7 bg-void border-white/10 font-mono text-xs"
                />
              </div>
            </div>
          </div>
        </FilterCard>
      </div>
    </div>
  );
}

export default LogicGateColumn;
