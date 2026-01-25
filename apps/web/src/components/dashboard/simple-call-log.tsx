'use client';

/**
 * Project Cortex | Simple Call Log
 *
 * DataGrid without external dropdown-menu dependency.
 * Uses native select for column visibility.
 *
 * DEFAULT VIEW: Date, Campaign, Buyer, Pub, Target, CallerID, Duration, Rev, Payout, Recording
 * MISSED CALLS: Red tint on rows
 * FONT: JetBrains Mono for numbers
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Play, X, Check, Settings2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  type CallRecord,
  type ColumnDefinition,
  CALL_LOG_COLUMNS,
  CALL_LOG_COLUMNS_STORAGE_KEY,
  getDefaultVisibleColumns,
} from '@/types/call';

interface SimpleCallLogProps {
  campaignId?: string;
  className?: string;
}

// ============================================================================
// MOCK DATA
// ============================================================================

const mockCalls: CallRecord[] = [
  {
    id: 'call_001',
    campaignId: 'camp_medicare_01',
    campaignName: 'Medicare Advantage Q1',
    publisherId: 'pub_leadgenius',
    publisherName: 'LeadGenius',
    targetId: 'tgt_mutual',
    targetName: 'Mutual Intake',
    buyerId: 'buy_mutual',
    buyerName: 'Mutual of Omaha',
    callDate: new Date('2026-01-24T14:52:30'),
    connectedTime: new Date('2026-01-24T14:52:45'),
    completeTime: new Date('2026-01-24T14:58:12'),
    duration: 327,
    bufferThreshold: 90,
    callerId: '+1 (212) 555-1234',
    callerName: 'John Doe',
    targetNumber: '+1 (800) 555-0001',
    inboundDid: '+1 (888) 555-1000',
    vertical: 'medicare',
    verticalCategory: 'insurance',
    revenue: 45.0,
    payout: 25.0,
    profit: 20.0,
    cost: 0.02,
    converted: true,
    missedCall: false,
    isDuplicate: false,
    blocked: false,
    status: 'completed',
    isBillable: true,
    isLive: false,
    noPayoutReason: null,
    blockReason: null,
    recordingUrl: 'https://recordings.example.com/call_001.mp3',
    timestamp: '14:52:30',
    createdAt: '2026-01-24T14:52:30Z',
    updatedAt: '2026-01-24T14:58:12Z',
  },
  {
    id: 'call_002',
    campaignId: 'camp_masstort_01',
    campaignName: 'Mass Tort - Camp Lejeune',
    publisherId: 'pub_mediabuyers',
    publisherName: 'MediaBuyers',
    targetId: 'tgt_morgan',
    targetName: 'Morgan Intake',
    buyerId: 'buy_morgan',
    buyerName: 'Morgan & Morgan',
    callDate: new Date('2026-01-24T14:50:12'),
    connectedTime: new Date('2026-01-24T14:50:28'),
    completeTime: new Date('2026-01-24T14:55:45'),
    duration: 317,
    bufferThreshold: 120,
    callerId: '+1 (415) 555-2345',
    targetNumber: '+1 (800) 555-0002',
    inboundDid: '+1 (888) 555-2000',
    vertical: 'mass-tort',
    verticalCategory: 'legal',
    revenue: 85.0,
    payout: 35.0,
    profit: 50.0,
    cost: 0.03,
    converted: false,
    missedCall: false,
    isDuplicate: false,
    blocked: false,
    status: 'completed',
    isBillable: true,
    isLive: false,
    noPayoutReason: null,
    blockReason: null,
    recordingUrl: 'https://recordings.example.com/call_002.mp3',
    timestamp: '14:50:12',
    createdAt: '2026-01-24T14:50:12Z',
    updatedAt: '2026-01-24T14:55:45Z',
  },
  {
    id: 'call_003',
    campaignId: 'camp_medicare_01',
    campaignName: 'Medicare Advantage Q1',
    publisherId: 'pub_seniorleads',
    publisherName: 'SeniorLeads',
    targetId: 'tgt_united',
    targetName: 'United Intake',
    buyerId: 'buy_united',
    buyerName: 'UnitedHealth',
    callDate: new Date('2026-01-24T14:40:15'),
    connectedTime: null,
    completeTime: new Date('2026-01-24T14:40:45'),
    duration: 0,
    bufferThreshold: 90,
    callerId: '+1 (202) 555-6789',
    targetNumber: '+1 (800) 555-0003',
    inboundDid: '+1 (888) 555-3000',
    vertical: 'medicare',
    verticalCategory: 'insurance',
    revenue: 0,
    payout: 0,
    profit: 0,
    cost: 0,
    converted: false,
    missedCall: true,
    isDuplicate: false,
    blocked: false,
    status: 'missed',
    isBillable: false,
    isLive: false,
    noPayoutReason: 'No Answer',
    blockReason: null,
    recordingUrl: null,
    timestamp: '14:40:15',
    createdAt: '2026-01-24T14:40:15Z',
    updatedAt: '2026-01-24T14:40:45Z',
  },
  {
    id: 'call_004',
    campaignId: 'camp_solar_01',
    campaignName: 'Solar Installation',
    publisherId: 'pub_greenleads',
    publisherName: 'GreenLeads',
    targetId: 'tgt_sunpower',
    targetName: 'SunPower Inbound',
    buyerId: 'buy_sunpower',
    buyerName: 'SunPower',
    callDate: new Date('2026-01-24T14:35:00'),
    connectedTime: null,
    completeTime: new Date('2026-01-24T14:35:30'),
    duration: 0,
    bufferThreshold: 90,
    callerId: '+1 (305) 555-5678',
    targetNumber: '+1 (800) 555-0004',
    inboundDid: '+1 (888) 555-4000',
    vertical: 'solar',
    verticalCategory: 'home_services',
    revenue: 0,
    payout: 0,
    profit: 0,
    cost: 0,
    converted: false,
    missedCall: true,
    isDuplicate: false,
    blocked: false,
    status: 'missed',
    isBillable: false,
    isLive: false,
    noPayoutReason: 'No Answer',
    blockReason: null,
    recordingUrl: null,
    timestamp: '14:35:00',
    createdAt: '2026-01-24T14:35:00Z',
    updatedAt: '2026-01-24T14:35:30Z',
  },
  {
    id: 'call_005',
    campaignId: 'camp_roofing_01',
    campaignName: 'Roofing Leads',
    publisherId: 'pub_homeservices',
    publisherName: 'HomeServices Co',
    targetId: 'tgt_leaffilter',
    targetName: 'LeafFilter Inbound',
    buyerId: 'buy_leaffilter',
    buyerName: 'LeafFilter',
    callDate: new Date('2026-01-24T14:30:00'),
    connectedTime: new Date('2026-01-24T14:30:15'),
    completeTime: new Date('2026-01-24T14:34:22'),
    duration: 247,
    bufferThreshold: 60,
    callerId: '+1 (617) 555-4567',
    targetNumber: '+1 (800) 555-0005',
    inboundDid: '+1 (888) 555-5000',
    vertical: 'roofing',
    verticalCategory: 'home_services',
    revenue: 35.0,
    payout: 18.0,
    profit: 17.0,
    cost: 0.02,
    converted: true,
    missedCall: false,
    isDuplicate: false,
    blocked: false,
    status: 'completed',
    isBillable: true,
    isLive: false,
    noPayoutReason: null,
    blockReason: null,
    recordingUrl: 'https://recordings.example.com/call_005.mp3',
    timestamp: '14:30:00',
    createdAt: '2026-01-24T14:30:00Z',
    updatedAt: '2026-01-24T14:34:22Z',
  },
];

// ============================================================================
// COMPONENT
// ============================================================================

export function SimpleCallLog({ campaignId, className }: SimpleCallLogProps) {
  const [calls] = useState<CallRecord[]>(mockCalls);
  const [visibleColumns, setVisibleColumns] = useState<string[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Load column preferences from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(CALL_LOG_COLUMNS_STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setVisibleColumns(parsed);
          return;
        }
      } catch {
        // Invalid JSON, use defaults
      }
    }
    setVisibleColumns(getDefaultVisibleColumns());
  }, []);

  // Save column preferences
  const saveColumns = useCallback((columns: string[]) => {
    localStorage.setItem(CALL_LOG_COLUMNS_STORAGE_KEY, JSON.stringify(columns));
    setVisibleColumns(columns);
  }, []);

  // Toggle column
  const toggleColumn = useCallback(
    (columnKey: string) => {
      setVisibleColumns(prev => {
        const newColumns = prev.includes(columnKey)
          ? prev.filter(k => k !== columnKey)
          : [...prev, columnKey];
        saveColumns(newColumns);
        return newColumns;
      });
    },
    [saveColumns]
  );

  // Reset to defaults
  const resetToDefaults = useCallback(() => {
    const defaults = getDefaultVisibleColumns();
    saveColumns(defaults);
  }, [saveColumns]);

  // Active columns
  const activeColumns = useMemo(() => {
    return CALL_LOG_COLUMNS.filter(col => visibleColumns.includes(col.key));
  }, [visibleColumns]);

  // Filter by campaign
  const filteredCalls = useMemo(() => {
    if (!campaignId) return calls;
    return calls.filter(call => call.campaignId === campaignId);
  }, [calls, campaignId]);

  // Format cell value
  const formatCellValue = (call: CallRecord, column: ColumnDefinition): React.ReactNode => {
    const value = call[column.key];

    switch (column.format) {
      case 'currency':
        return (
          <span
            className="font-mono tabular-nums"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            ${typeof value === 'number' ? value.toFixed(2) : '0.00'}
          </span>
        );

      case 'time':
        if (column.key === 'duration') {
          const secs = typeof value === 'number' ? value : 0;
          const mins = Math.floor(secs / 60);
          const s = secs % 60;
          return (
            <span
              className="font-mono tabular-nums"
              style={{ fontFamily: "'JetBrains Mono', monospace" }}
            >
              {mins}:{s.toString().padStart(2, '0')}
            </span>
          );
        }
        return <span className="font-mono text-xs">{String(value ?? '-')}</span>;

      case 'date':
        if (value instanceof Date) {
          return (
            <span
              className="font-mono text-xs"
              style={{ fontFamily: "'JetBrains Mono', monospace" }}
            >
              {value.toLocaleDateString()}{' '}
              {value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          );
        }
        return <span className="font-mono text-xs">{String(value ?? '-')}</span>;

      case 'boolean':
        return value ? (
          <Check className="h-4 w-4 text-neon-mint mx-auto" />
        ) : (
          <X className="h-4 w-4 text-text-muted mx-auto" />
        );

      case 'url':
        if (value && typeof value === 'string') {
          return (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-neon-cyan hover:text-neon-cyan/80"
              onClick={() => window.open(value, '_blank')}
            >
              <Play className="h-3 w-3" />
            </Button>
          );
        }
        return <span className="text-text-muted">—</span>;

      default:
        return <span className="truncate max-w-[150px] block">{String(value ?? '-')}</span>;
    }
  };

  // Group columns by category
  const columnsByCategory = useMemo(() => {
    const categories: Record<string, ColumnDefinition[]> = {
      default: [],
      ids: [],
      times: [],
      finance: [],
      logic: [],
      meta: [],
    };
    CALL_LOG_COLUMNS.forEach(col => {
      categories[col.category].push(col);
    });
    return categories;
  }, []);

  return (
    <div
      className={cn(
        'flex flex-col rounded-xl bg-panel/60 backdrop-blur-sm border border-white/5 overflow-hidden',
        className
      )}
    >
      {/* Compact Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5 shrink-0">
        <span className="font-mono text-[10px] text-text-muted">
          {filteredCalls.length} RECORDS
        </span>

        {/* Column Picker Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 gap-1 font-mono text-[10px] text-text-muted hover:text-neon-cyan"
            >
              <Settings2 className="h-3 w-3" />
              Columns
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center justify-between">
                <span>Column Visibility</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-neon-cyan"
                  onClick={resetToDefaults}
                >
                  Reset
                </Button>
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              {Object.entries(columnsByCategory).map(([category, cols]) => (
                <div key={category}>
                  <p className="font-mono text-[10px] text-text-muted uppercase tracking-widest mb-2">
                    {category}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {cols.map(col => (
                      <label key={col.key} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={visibleColumns.includes(col.key)}
                          onChange={() => toggleColumn(col.key)}
                          className="rounded border-white/20 bg-panel text-neon-cyan focus:ring-neon-cyan"
                        />
                        <span className="font-mono text-xs text-text-secondary">{col.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-panel border-b border-white/5">
            <tr>
              {activeColumns.map(col => (
                <th
                  key={col.key}
                  className={cn(
                    'px-3 py-2 text-[10px] font-mono font-medium text-neon-cyan uppercase tracking-widest whitespace-nowrap',
                    col.align === 'right' && 'text-right',
                    col.align === 'center' && 'text-center'
                  )}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <AnimatePresence>
              {filteredCalls.map((call, index) => (
                <motion.tr
                  key={call.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: index * 0.02 }}
                  className={cn(
                    'border-b border-white/5 transition-colors',
                    'hover:bg-neon-cyan/5',
                    call.missedCall && 'bg-red-500/10 hover:bg-red-500/15'
                  )}
                >
                  {activeColumns.map(col => (
                    <td
                      key={col.key}
                      className={cn(
                        'px-3 py-2 text-xs text-text-primary whitespace-nowrap',
                        col.align === 'right' && 'text-right',
                        col.align === 'center' && 'text-center',
                        call.missedCall && col.key !== 'recordingUrl' && 'text-red-400/80'
                      )}
                    >
                      {formatCellValue(call, col)}
                    </td>
                  ))}
                </motion.tr>
              ))}
            </AnimatePresence>
          </tbody>
        </table>

        {filteredCalls.length === 0 && (
          <div className="flex items-center justify-center h-32 text-text-muted font-mono text-sm">
            No calls found
          </div>
        )}
      </div>
    </div>
  );
}

export default SimpleCallLog;
