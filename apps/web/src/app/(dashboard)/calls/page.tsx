'use client';

/**
 * Project Cortex | Signal Stream (Calls Page)
 *
 * Active Money Timer — Live calls with buffer progress.
 * NO DUPLICATE HEADER — Uses global header from layout.
 */

import { RefreshCw, Phone, PhoneIncoming, PhoneOff } from 'lucide-react';
import { useState, useEffect } from 'react';

import { MoneyTimer, RouteIndicator, QualifiedFlag } from '@/components/calls';
import { PublisherMetrics } from '@/components/dashboard/PublisherMetrics';
import { VerticalBadge } from '@/components/ppcall';
import { Button } from '@/components/ui/button';
import { NeuralOrbMini } from '@/components/ui/neural-orb';
import { HideFromPublisher, PublisherOnly } from '@/components/ui/RoleGate';
import { useUser } from '@/contexts/UserContext';
import { cn } from '@/lib/utils';

type CallStatus = 'ringing' | 'buffering' | 'billable' | 'ended' | 'missed';

interface CallRecord {
  id: string;
  caller: string;
  vertical: string;
  status: CallStatus;
  duration: number;
  bufferThreshold: number;
  estimatedRevenue: number;
  publisherPayout: number;
  publisherName: string;
  targetName: string;
  buyerName: string;
  timestamp: string;
  isLive: boolean;
}

const mockCalls: CallRecord[] = [
  {
    id: 'sig_001',
    caller: '+1 (212) 555-1234',
    vertical: 'medicare',
    status: 'buffering',
    duration: 45,
    bufferThreshold: 90,
    estimatedRevenue: 45,
    publisherPayout: 25,
    publisherName: 'LeadGenius',
    targetName: 'Call Center A',
    buyerName: 'Mutual of Omaha',
    timestamp: '14:52:30',
    isLive: true,
  },
  {
    id: 'sig_002',
    caller: '+1 (415) 555-2345',
    vertical: 'mass-tort',
    status: 'billable',
    duration: 156,
    bufferThreshold: 120,
    estimatedRevenue: 85,
    publisherPayout: 35,
    publisherName: 'MediaBuyers',
    targetName: 'Mass Tort Intake',
    buyerName: 'Morgan & Morgan',
    timestamp: '14:50:12',
    isLive: true,
  },
  {
    id: 'sig_003',
    caller: '+1 (310) 555-3456',
    vertical: 'final-expense',
    status: 'billable',
    duration: 312,
    bufferThreshold: 90,
    estimatedRevenue: 27,
    publisherPayout: 15,
    publisherName: 'InsuranceLeads',
    targetName: 'Final Exp Team',
    buyerName: 'SelectQuote',
    timestamp: '14:47:45',
    isLive: true,
  },
  {
    id: 'sig_004',
    caller: '+1 (617) 555-4567',
    vertical: 'roofing',
    status: 'ringing',
    duration: 8,
    bufferThreshold: 60,
    estimatedRevenue: 35,
    publisherPayout: 18,
    publisherName: 'HomeServices Co',
    targetName: 'Inbound Team',
    buyerName: 'LeafFilter',
    timestamp: '14:52:55',
    isLive: true,
  },
  {
    id: 'sig_005',
    caller: '+1 (305) 555-5678',
    vertical: 'solar',
    status: 'ended',
    duration: 234,
    bufferThreshold: 90,
    estimatedRevenue: 45,
    publisherPayout: 22,
    publisherName: 'GreenLeads',
    targetName: 'Solar Inbound',
    buyerName: 'SunPower',
    timestamp: '14:42:00',
    isLive: false,
  },
  {
    id: 'sig_006',
    caller: '+1 (202) 555-6789',
    vertical: 'medicare',
    status: 'missed',
    duration: 0,
    bufferThreshold: 90,
    estimatedRevenue: 0,
    publisherPayout: 0,
    publisherName: 'SeniorLeads',
    targetName: 'Medicare Team',
    buyerName: 'UnitedHealth',
    timestamp: '14:40:15',
    isLive: false,
  },
];

type FilterType = 'all' | 'live' | 'billable' | 'ended';

const statusConfig: Record<
  CallStatus,
  { color: string; orbState: 'ringing' | 'processing' | 'speaking' | 'idle' }
> = {
  ringing: { color: 'text-neon-cyan', orbState: 'ringing' },
  buffering: { color: 'text-white', orbState: 'processing' },
  billable: { color: 'text-toxic-lime', orbState: 'speaking' },
  ended: { color: 'text-text-muted', orbState: 'idle' },
  missed: { color: 'text-status-error', orbState: 'idle' },
};

export default function CallsPage() {
  const { isPublisher, user } = useUser();
  const [calls, setCalls] = useState<CallRecord[]>(mockCalls);
  const [filter, setFilter] = useState<FilterType>('all');

  const publisherCalls = isPublisher
    ? calls.filter(c => c.publisherName === user?.publisherName || c.publisherName === 'LeadGenius')
    : calls;

  useEffect(() => {
    const interval = setInterval(() => {
      setCalls(prev =>
        prev.map(call => {
          if (!call.isLive) return call;
          const newDuration = call.duration + 1;
          const newStatus =
            call.status === 'ringing' && newDuration > 15
              ? 'buffering'
              : call.status === 'buffering' && newDuration >= call.bufferThreshold
                ? 'billable'
                : call.status;
          return { ...call, duration: newDuration, status: newStatus };
        })
      );
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const filteredCalls = publisherCalls.filter(call => {
    if (filter === 'all') return true;
    if (filter === 'live') return call.isLive;
    if (filter === 'billable') return call.status === 'billable';
    if (filter === 'ended') return !call.isLive;
    return true;
  });

  const liveCount = publisherCalls.filter(c => c.isLive).length;
  const billableCount = publisherCalls.filter(c => c.status === 'billable').length;
  const totalRevenue = publisherCalls
    .filter(c => c.status === 'billable')
    .reduce((sum, c) => sum + c.estimatedRevenue, 0);

  const qualifiedCalls = publisherCalls.filter(c => c.duration >= c.bufferThreshold).length;
  const totalCalls = publisherCalls.filter(c => c.status !== 'ringing').length;
  const revenuePerCall =
    qualifiedCalls > 0
      ? publisherCalls
          .filter(c => c.duration >= c.bufferThreshold)
          .reduce((sum, c) => sum + c.publisherPayout, 0) / qualifiedCalls
      : 0;
  const totalPayout = publisherCalls
    .filter(c => c.duration >= c.bufferThreshold)
    .reduce((sum, c) => sum + c.publisherPayout, 0);

  return (
    <div className="h-full flex flex-col overflow-hidden p-4 gap-3">
      {/* Compact Inline Controls */}
      <div className="flex items-center justify-between shrink-0">
        {/* Stats */}
        <div className="flex items-center gap-4">
          <HideFromPublisher>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-toxic-lime animate-pulse" />
                <span className="font-mono text-[10px] text-text-muted">LIVE</span>
                <span className="font-mono text-xs font-bold text-toxic-lime">{liveCount}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-[10px] text-text-muted">BILLABLE</span>
                <span className="font-mono text-xs font-bold text-neon-mint">{billableCount}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-[10px] text-text-muted">REV</span>
                <span className="font-mono text-xs font-bold text-neon-mint">${totalRevenue}</span>
              </div>
            </div>
          </HideFromPublisher>

          <PublisherOnly>
            <PublisherMetrics
              qualifiedCalls={qualifiedCalls}
              totalCalls={totalCalls}
              revenuePerCall={revenuePerCall}
              totalPayout={totalPayout}
            />
          </PublisherOnly>
        </div>

        {/* Filters + Refresh */}
        <div className="flex items-center gap-2">
          {(isPublisher
            ? (['all', 'live', 'ended'] as FilterType[])
            : (['all', 'live', 'billable', 'ended'] as FilterType[])
          ).map(f => (
            <Button
              key={f}
              variant={filter === f ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setFilter(f)}
              className={cn(
                'h-6 px-2 font-mono text-[10px] uppercase',
                filter === f ? 'bg-neon-cyan text-void' : 'text-text-muted hover:text-text-primary'
              )}
            >
              {f === 'billable' && isPublisher ? 'qualified' : f}
            </Button>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-text-muted hover:text-neon-cyan"
          >
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0 rounded-xl bg-panel/60 border border-white/5">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-panel border-b border-white/5">
            <tr>
              <th className="px-3 py-2 text-left text-[10px] font-mono text-neon-cyan uppercase tracking-widest">
                STATUS
              </th>
              <th className="px-3 py-2 text-left text-[10px] font-mono text-neon-cyan uppercase tracking-widest">
                CALLER
              </th>
              <th className="px-3 py-2 text-left text-[10px] font-mono text-neon-cyan uppercase tracking-widest">
                VERTICAL
              </th>
              {!isPublisher && (
                <th className="px-3 py-2 text-left text-[10px] font-mono text-neon-cyan uppercase tracking-widest">
                  ROUTE
                </th>
              )}
              <th className="px-3 py-2 text-left text-[10px] font-mono text-neon-cyan uppercase tracking-widest">
                {isPublisher ? 'DURATION' : 'MONEY TIMER'}
              </th>
              <th className="px-3 py-2 text-left text-[10px] font-mono text-neon-cyan uppercase tracking-widest">
                {isPublisher ? 'QUALIFIED' : 'TIME'}
              </th>
            </tr>
          </thead>
        </table>

        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-sm">
            <tbody>
              {filteredCalls.map(call => {
                const config = statusConfig[call.status];
                return (
                  <tr
                    key={call.id}
                    className={cn(
                      'border-b border-white/5 transition-colors hover:bg-neon-cyan/5',
                      call.isLive && 'bg-panel/30'
                    )}
                  >
                    <td className="px-3 py-2 w-28">
                      <div className="flex items-center gap-2">
                        <NeuralOrbMini state={config.orbState} />
                        <span className={cn('font-mono text-xs uppercase', config.color)}>
                          {call.status}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2 w-36">
                      <div className="flex items-center gap-2">
                        {call.isLive ? (
                          <PhoneIncoming className="h-3 w-3 text-neon-cyan" />
                        ) : call.status === 'missed' ? (
                          <PhoneOff className="h-3 w-3 text-status-error" />
                        ) : (
                          <Phone className="h-3 w-3 text-text-muted" />
                        )}
                        <span className="font-mono text-xs text-text-primary">{call.caller}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 w-28">
                      <VerticalBadge vertical={call.vertical} size="sm" />
                    </td>
                    {!isPublisher && (
                      <td className="px-3 py-2">
                        <RouteIndicator
                          publisherName={call.publisherName}
                          targetName={call.targetName}
                          buyerName={call.buyerName}
                        />
                      </td>
                    )}
                    <td className="px-3 py-2 w-48">
                      {isPublisher ? (
                        <span className="font-mono text-sm text-text-primary tabular-nums">
                          {Math.floor(call.duration / 60)}:
                          {(call.duration % 60).toString().padStart(2, '0')}
                        </span>
                      ) : (
                        <MoneyTimer
                          duration={call.duration}
                          bufferThreshold={call.bufferThreshold}
                          isLive={call.isLive && call.status !== 'ringing'}
                          estimatedRevenue={
                            call.status === 'billable' ? call.estimatedRevenue : undefined
                          }
                        />
                      )}
                    </td>
                    <td className="px-3 py-2 w-28">
                      {isPublisher ? (
                        <QualifiedFlag
                          status={call.status}
                          duration={call.duration}
                          bufferThreshold={call.bufferThreshold}
                          isLive={call.isLive}
                        />
                      ) : (
                        <span className="font-mono text-xs text-text-muted tabular-nums">
                          {call.timestamp}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
