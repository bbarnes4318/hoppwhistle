'use client';

/**
 * Project Cortex | Call Telemetry
 *
 * Call history with Command Grid table styling.
 */

import { Search, Play } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { CommandHeader, CommandPanel } from '@/components/ui/command-grid';
import { NeuralOrbMini } from '@/components/ui/neural-orb';
import { formatPhoneNumber, formatDate, formatDuration, cn } from '@/lib/utils';

// Mock data
const mockCalls = [
  {
    id: 'call_1',
    from: '+12125551234',
    to: '+13105551234',
    status: 'completed',
    duration: 245,
    asr: 0.65,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'call_2',
    from: '+14155551234',
    to: '+12125551234',
    status: 'answered',
    duration: 120,
    asr: 0.58,
    createdAt: new Date(Date.now() - 3600000).toISOString(),
  },
];

export default function CallsPage() {
  const [search, setSearch] = useState('');

  const filteredCalls = mockCalls.filter(
    c =>
      c.from.includes(search) ||
      c.to.includes(search) ||
      c.id.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Command Header */}
      <CommandHeader
        title="Call Telemetry"
        subtitle="VECTORING // SIGNAL ARCHIVE"
        actions={
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <Input
              id="calls-search"
              name="calls-search"
              placeholder="Vectoring signal..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className={cn(
                'pl-10 bg-surface-dark border-grid-line font-mono text-sm',
                'placeholder:text-text-muted/50',
                'focus:border-brand-cyan focus:ring-brand-cyan/20'
              )}
            />
          </div>
        }
      />

      {/* Call Log Panel */}
      <CommandPanel
        title="Signal Archive"
        telemetry={`${filteredCalls.length} RECORDS`}
        variant="default"
        className="flex-1 overflow-hidden min-h-0"
      >
        <div className="overflow-y-auto h-full">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SIGNAL ID</TableHead>
                <TableHead>ORIGIN</TableHead>
                <TableHead>DESTINATION</TableHead>
                <TableHead>STATUS</TableHead>
                <TableHead>DURATION</TableHead>
                <TableHead>ASR</TableHead>
                <TableHead>TIMESTAMP</TableHead>
                <TableHead className="text-right">ACTIONS</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredCalls.map(call => (
                <TableRow key={call.id}>
                  <TableCell className="font-mono text-xs text-brand-cyan">{call.id}</TableCell>
                  <TableCell className="font-mono text-sm">
                    {formatPhoneNumber(call.from)}
                  </TableCell>
                  <TableCell className="font-mono text-sm">{formatPhoneNumber(call.to)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <NeuralOrbMini state={call.status === 'completed' ? 'idle' : 'speaking'} />
                      <Badge
                        variant={call.status === 'completed' ? 'success' : 'warning'}
                        className="font-mono text-xs uppercase"
                      >
                        {call.status}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {formatDuration(call.duration)}
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    <span
                      className={call.asr > 0.6 ? 'text-status-success' : 'text-status-warning'}
                    >
                      {(call.asr * 100).toFixed(1)}%
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-text-secondary">
                    {formatDate(call.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link href={`/calls/${call.id}`}>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-text-secondary hover:text-brand-cyan hover:bg-brand-cyan/10"
                      >
                        <Play className="h-4 w-4" />
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CommandPanel>
    </div>
  );
}
