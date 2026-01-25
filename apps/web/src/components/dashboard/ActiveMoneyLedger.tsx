'use client';

/**
 * Project Cortex | Active Money Ledger
 *
 * Scrollable call table with sticky header for single-view dashboard.
 * Internal scroll only - no page scroll.
 */

import { Phone, DollarSign, Clock, PhoneIncoming, PhoneMissed } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BufferCountdownCompact, VerticalBadge } from '@/components/ppcall';
import { NeuralOrbMini } from '@/components/ui/neural-orb';

interface CallRecord {
  id: string;
  caller: string;
  vertical: string;
  status: 'billable' | 'buffering' | 'missed' | 'short';
  duration: number;
  bufferThreshold: number;
  yield: number;
  timestamp: string;
}

interface ActiveMoneyLedgerProps {
  calls?: CallRecord[];
  className?: string;
}

// Mock data
const mockCalls: CallRecord[] = [
  {
    id: 'sig_7f3a9c2e',
    caller: '+1 (212) 555-1234',
    vertical: 'medicare',
    status: 'billable',
    duration: 312,
    bufferThreshold: 90,
    yield: 27,
    timestamp: '14:45',
  },
  {
    id: 'sig_8b4c1d3f',
    caller: '+1 (415) 555-2345',
    vertical: 'final-expense',
    status: 'billable',
    duration: 187,
    bufferThreshold: 90,
    yield: 13,
    timestamp: '14:42',
  },
  {
    id: 'sig_9c5d2e4g',
    caller: '+1 (310) 555-3456',
    vertical: 'mass-tort',
    status: 'billable',
    duration: 245,
    bufferThreshold: 120,
    yield: 85,
    timestamp: '14:39',
  },
  {
    id: 'sig_0d6e3f5h',
    caller: '+1 (617) 555-4567',
    vertical: 'roofing',
    status: 'buffering',
    duration: 45,
    bufferThreshold: 60,
    yield: 0,
    timestamp: '14:36',
  },
  {
    id: 'sig_1e7f4g6i',
    caller: '+1 (305) 555-5678',
    vertical: 'solar',
    status: 'billable',
    duration: 156,
    bufferThreshold: 90,
    yield: 23,
    timestamp: '14:33',
  },
  {
    id: 'sig_2f8g5h7j',
    caller: '+1 (202) 555-6789',
    vertical: 'dme-cgm',
    status: 'billable',
    duration: 423,
    bufferThreshold: 120,
    yield: 40,
    timestamp: '14:30',
  },
  {
    id: 'sig_3g9h6i8k',
    caller: '+1 (408) 555-7890',
    vertical: 'aca',
    status: 'billable',
    duration: 289,
    bufferThreshold: 90,
    yield: 20,
    timestamp: '14:27',
  },
  {
    id: 'sig_4h0i7j9l',
    caller: '+1 (503) 555-8901',
    vertical: 'personal-injury',
    status: 'missed',
    duration: 0,
    bufferThreshold: 90,
    yield: 0,
    timestamp: '14:24',
  },
  {
    id: 'sig_5i1j8k0m',
    caller: '+1 (718) 555-9012',
    vertical: 'medicare',
    status: 'billable',
    duration: 198,
    bufferThreshold: 90,
    yield: 27,
    timestamp: '14:21',
  },
  {
    id: 'sig_6j2k9l1n',
    caller: '+1 (213) 555-0123',
    vertical: 'hvac',
    status: 'short',
    duration: 35,
    bufferThreshold: 60,
    yield: 0,
    timestamp: '14:18',
  },
  {
    id: 'sig_7k3l0m2o',
    caller: '+1 (512) 555-1234',
    vertical: 'mass-tort',
    status: 'billable',
    duration: 367,
    bufferThreshold: 120,
    yield: 85,
    timestamp: '14:15',
  },
  {
    id: 'sig_8l4m1n3p',
    caller: '+1 (619) 555-2345',
    vertical: 'final-expense',
    status: 'billable',
    duration: 145,
    bufferThreshold: 90,
    yield: 13,
    timestamp: '14:12',
  },
];

const statusConfig = {
  billable: {
    icon: DollarSign,
    color: 'text-neon-mint',
    bg: 'bg-neon-mint/10',
    orbState: 'speaking' as const,
  },
  buffering: {
    icon: Clock,
    color: 'text-neon-cyan',
    bg: 'bg-neon-cyan/10',
    orbState: 'processing' as const,
  },
  missed: {
    icon: PhoneMissed,
    color: 'text-status-error',
    bg: 'bg-status-error/10',
    orbState: 'idle' as const,
  },
  short: {
    icon: PhoneIncoming,
    color: 'text-status-warning',
    bg: 'bg-status-warning/10',
    orbState: 'idle' as const,
  },
};

export function ActiveMoneyLedger({ calls = mockCalls, className }: ActiveMoneyLedgerProps) {
  const formatDuration = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    return `${mins}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div
      className={cn(
        'flex flex-col rounded-xl bg-panel/60 backdrop-blur-sm border border-white/5 overflow-hidden',
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/5">
        <h3 className="font-mono text-xs text-neon-cyan uppercase tracking-widest">
          ACTIVE MONEY LEDGER
        </h3>
        <span className="font-mono text-[10px] text-neon-mint">
          {calls.filter(c => c.status === 'billable').length} BILLABLE
        </span>
      </div>

      {/* Table Container - scrollable */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <table className="w-full text-sm font-mono">
          {/* Sticky Header */}
          <thead className="sticky top-0 z-10 bg-panel border-b border-white/5">
            <tr>
              <th className="px-4 py-2 text-left text-[10px] text-neon-cyan uppercase tracking-widest font-medium">
                SIGNAL
              </th>
              <th className="px-4 py-2 text-left text-[10px] text-neon-cyan uppercase tracking-widest font-medium">
                CALLER
              </th>
              <th className="px-4 py-2 text-left text-[10px] text-neon-cyan uppercase tracking-widest font-medium">
                VERTICAL
              </th>
              <th className="px-4 py-2 text-left text-[10px] text-neon-cyan uppercase tracking-widest font-medium">
                STATUS
              </th>
              <th className="px-4 py-2 text-left text-[10px] text-neon-cyan uppercase tracking-widest font-medium">
                BUFFER
              </th>
              <th className="px-4 py-2 text-left text-[10px] text-neon-cyan uppercase tracking-widest font-medium">
                DUR
              </th>
              <th className="px-4 py-2 text-right text-[10px] text-neon-cyan uppercase tracking-widest font-medium">
                YIELD
              </th>
              <th className="px-4 py-2 text-right text-[10px] text-neon-cyan uppercase tracking-widest font-medium">
                TIME
              </th>
            </tr>
          </thead>

          {/* Scrollable Body */}
          <tbody>
            {calls.map(call => {
              const config = statusConfig[call.status];
              const StatusIcon = config.icon;
              const isBillable = call.status === 'billable';

              return (
                <tr
                  key={call.id}
                  className={cn(
                    'border-b border-white/5 transition-colors',
                    'hover:bg-neon-cyan/5',
                    'relative',
                    // Hover glow bar
                    'before:absolute before:left-0 before:top-0 before:h-full before:w-0',
                    'before:bg-neon-cyan before:transition-all before:duration-200',
                    'hover:before:w-[3px] hover:before:shadow-[0_0_8px_rgba(0,229,255,0.5)]'
                  )}
                >
                  {/* Signal ID */}
                  <td className="px-4 py-2 text-xs text-neon-cyan">{call.id}</td>

                  {/* Caller */}
                  <td className="px-4 py-2 text-xs text-text-primary">{call.caller}</td>

                  {/* Vertical */}
                  <td className="px-4 py-2">
                    <VerticalBadge vertical={call.vertical} size="sm" showIcon={false} />
                  </td>

                  {/* Status */}
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <NeuralOrbMini state={config.orbState} />
                      <span
                        className={cn(
                          'px-1.5 py-0.5 rounded text-[10px] uppercase font-semibold',
                          config.color,
                          config.bg
                        )}
                      >
                        {call.status}
                      </span>
                    </div>
                  </td>

                  {/* Buffer */}
                  <td className="px-4 py-2">
                    <BufferCountdownCompact
                      bufferThreshold={call.bufferThreshold}
                      duration={call.duration}
                      payout={isBillable ? call.yield : undefined}
                    />
                  </td>

                  {/* Duration */}
                  <td className="px-4 py-2 text-xs text-text-muted tabular-nums">
                    {call.duration > 0 ? formatDuration(call.duration) : '—'}
                  </td>

                  {/* Yield */}
                  <td className="px-4 py-2 text-right">
                    {isBillable ? (
                      <span className="text-neon-mint font-bold">+${call.yield}</span>
                    ) : call.status === 'short' || call.status === 'missed' ? (
                      <span className="text-text-muted">$0</span>
                    ) : (
                      <span className="text-text-muted/50">—</span>
                    )}
                  </td>

                  {/* Timestamp */}
                  <td className="px-4 py-2 text-right text-xs text-text-muted tabular-nums">
                    {call.timestamp}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default ActiveMoneyLedger;
