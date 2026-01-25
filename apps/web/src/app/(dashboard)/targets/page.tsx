'use client';

/**
 * Project Cortex | Global Targets (Buyer) Repository
 *
 * Database of Buyer Endpoints (SIP/PSTN destinations).
 * Split-Pane Layout with fixed header and scrollable list.
 */

import { useState, useMemo } from 'react';
import { Plus, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { CommandHeader } from '@/components/ui/command-grid';
import { TargetCard, TargetFilterBar, TargetEditModal } from '@/components/targets';
import type { Target } from '@/types/target';
import { cn } from '@/lib/utils';

// Mock data
const mockTargets: Target[] = [
  {
    id: 'tgt_001',
    buyerName: 'Mutual of Omaha',
    targetName: 'Call Center A - Final Expense',
    vertical: 'final-expense',
    destinationType: 'pstn',
    destinationNumber: '+18005551234',
    concurrencyCap: 15,
    currentConcurrency: 8,
    dailyCap: 50,
    dailyUsed: 23,
    timezone: 'America/New_York',
    hoursOfOperation: {
      daysOfWeek: [1, 2, 3, 4, 5],
      startTime: '08:00',
      endTime: '20:00',
    },
    status: 'active',
    isPaused: false,
    todayCalls: 156,
    todayRevenue: 3890,
    avgHandleTime: 312,
    createdAt: '2024-01-15T10:00:00Z',
    updatedAt: '2024-01-24T14:30:00Z',
  },
  {
    id: 'tgt_002',
    buyerName: 'SelectQuote',
    targetName: 'Medicare Inbound Team',
    vertical: 'medicare',
    destinationType: 'pstn',
    destinationNumber: '+18885559876',
    concurrencyCap: 25,
    currentConcurrency: 22,
    dailyCap: 100,
    dailyUsed: 87,
    timezone: 'America/Chicago',
    hoursOfOperation: {
      daysOfWeek: [1, 2, 3, 4, 5, 6],
      startTime: '07:00',
      endTime: '21:00',
    },
    status: 'active',
    isPaused: false,
    todayCalls: 342,
    todayRevenue: 8550,
    avgHandleTime: 245,
    createdAt: '2024-01-10T10:00:00Z',
    updatedAt: '2024-01-24T16:00:00Z',
  },
  {
    id: 'tgt_003',
    buyerName: 'Morgan & Morgan',
    targetName: 'Mass Tort Intake',
    vertical: 'mass-tort',
    destinationType: 'sip',
    destinationNumber: 'sip:intake@morgan.voip.net',
    concurrencyCap: 10,
    currentConcurrency: 10,
    dailyCap: 40,
    dailyUsed: 40,
    timezone: 'America/New_York',
    hoursOfOperation: {
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      startTime: '00:00',
      endTime: '23:59',
    },
    status: 'capped',
    isPaused: false,
    todayCalls: 98,
    todayRevenue: 14700,
    avgHandleTime: 420,
    createdAt: '2024-01-05T10:00:00Z',
    updatedAt: '2024-01-24T12:00:00Z',
  },
  {
    id: 'tgt_004',
    buyerName: 'LeafFilter',
    targetName: 'Home Services Inbound',
    vertical: 'roofing',
    destinationType: 'pstn',
    destinationNumber: '+18775553456',
    concurrencyCap: 8,
    currentConcurrency: 0,
    dailyCap: 30,
    dailyUsed: 12,
    timezone: 'America/Los_Angeles',
    hoursOfOperation: {
      daysOfWeek: [1, 2, 3, 4, 5],
      startTime: '09:00',
      endTime: '18:00',
    },
    status: 'paused',
    isPaused: true,
    todayCalls: 45,
    todayRevenue: 1575,
    avgHandleTime: 180,
    createdAt: '2024-01-20T10:00:00Z',
    updatedAt: '2024-01-24T09:00:00Z',
  },
  {
    id: 'tgt_005',
    buyerName: 'United Healthcare',
    targetName: 'ACA Enrollment Center',
    vertical: 'aca',
    destinationType: 'pstn',
    destinationNumber: '+18005557890',
    concurrencyCap: 20,
    currentConcurrency: 12,
    dailyCap: 75,
    dailyUsed: 45,
    timezone: 'America/New_York',
    hoursOfOperation: {
      daysOfWeek: [1, 2, 3, 4, 5],
      startTime: '08:00',
      endTime: '19:00',
    },
    status: 'active',
    isPaused: false,
    todayCalls: 189,
    todayRevenue: 6615,
    avgHandleTime: 267,
    createdAt: '2024-01-12T10:00:00Z',
    updatedAt: '2024-01-24T15:30:00Z',
  },
  {
    id: 'tgt_006',
    buyerName: 'SunPower',
    targetName: 'Solar Leads Team',
    vertical: 'solar',
    destinationType: 'pstn',
    destinationNumber: '+18885552345',
    concurrencyCap: 12,
    currentConcurrency: 5,
    dailyCap: 60,
    dailyUsed: 28,
    timezone: 'America/Denver',
    hoursOfOperation: {
      daysOfWeek: [1, 2, 3, 4, 5, 6],
      startTime: '08:00',
      endTime: '20:00',
    },
    status: 'active',
    isPaused: false,
    todayCalls: 112,
    todayRevenue: 5040,
    avgHandleTime: 210,
    createdAt: '2024-01-18T10:00:00Z',
    updatedAt: '2024-01-24T14:00:00Z',
  },
];

type FilterStatus = 'all' | 'active' | 'paused' | 'capped';

export default function TargetsPage() {
  const [targets, setTargets] = useState<Target[]>(mockTargets);
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [search, setSearch] = useState('');
  const [editingTarget, setEditingTarget] = useState<Target | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Filter and search
  const filteredTargets = useMemo(() => {
    return targets.filter(target => {
      // Filter by status
      if (filter === 'active' && (target.isPaused || target.status === 'capped')) return false;
      if (filter === 'paused' && !target.isPaused) return false;
      if (filter === 'capped' && target.status !== 'capped') return false;

      // Search
      if (search) {
        const searchLower = search.toLowerCase();
        return (
          target.buyerName.toLowerCase().includes(searchLower) ||
          target.targetName.toLowerCase().includes(searchLower) ||
          target.vertical.toLowerCase().includes(searchLower) ||
          target.destinationNumber.includes(search)
        );
      }

      return true;
    });
  }, [targets, filter, search]);

  // Count by status
  const counts = useMemo(
    () => ({
      all: targets.length,
      active: targets.filter(t => !t.isPaused && t.status !== 'capped').length,
      paused: targets.filter(t => t.isPaused).length,
      capped: targets.filter(t => t.status === 'capped').length,
    }),
    [targets]
  );

  // Handlers
  const handleEdit = (target: Target) => {
    setEditingTarget(target);
    setIsModalOpen(true);
  };

  const handleTogglePause = (target: Target) => {
    setTargets(prev =>
      prev.map(t =>
        t.id === target.id
          ? { ...t, isPaused: !t.isPaused, status: !t.isPaused ? 'paused' : 'active' }
          : t
      )
    );
  };

  const handleSave = (updatedTarget: Target) => {
    setTargets(prev => prev.map(t => (t.id === updatedTarget.id ? updatedTarget : t)));
  };

  const handleRefresh = () => {
    window.location.reload();
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Fixed Header */}
      <div className="shrink-0 border-b border-white/5">
        <CommandHeader
          title="GLOBAL TARGETS"
          subtitle="BUYER REPOSITORY // ENDPOINT DATABASE"
          actions={
            <div className="flex items-center gap-3">
              <Button
                className={cn(
                  'gap-2 font-mono text-xs',
                  'bg-neon-cyan text-void hover:bg-neon-cyan/90',
                  'shadow-[0_0_15px_rgba(0,229,255,0.2)]'
                )}
              >
                <Plus className="h-3 w-3" />
                NEW TARGET
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleRefresh}
                className="h-8 w-8 text-text-muted hover:text-neon-cyan"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          }
        />

        {/* Filter Bar */}
        <TargetFilterBar
          filter={filter}
          onFilterChange={setFilter}
          search={search}
          onSearchChange={setSearch}
          counts={counts}
          className="border-t border-white/5"
        />
      </div>

      {/* Scrollable Target List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {filteredTargets.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <p className="font-mono text-sm text-text-muted">No targets found</p>
            <p className="font-mono text-xs text-text-muted/50 mt-1">
              {search ? 'Try a different search term' : 'Add a new target to get started'}
            </p>
          </div>
        ) : (
          filteredTargets.map(target => (
            <TargetCard
              key={target.id}
              target={target}
              onEdit={handleEdit}
              onTogglePause={handleTogglePause}
            />
          ))
        )}
      </div>

      {/* Edit Modal */}
      <TargetEditModal
        target={editingTarget}
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingTarget(null);
        }}
        onSave={handleSave}
      />
    </div>
  );
}
