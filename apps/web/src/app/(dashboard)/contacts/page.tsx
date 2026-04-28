'use client';

import { Phone, Play, Search, Clock, CalendarCheck, ArrowUpRight, ArrowDownLeft } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { apiClient } from '@/lib/api';
import { formatDuration, formatPhoneNumber } from '@/lib/utils';
import {
  DISPOSITION_LABELS,
  DISPOSITION_COLORS,
  CALL_SOURCE_LABELS,
  getDispositionLabel,
} from '@hopwhistle/shared';

/* ─── Types ────────────────────────────────────────────────────── */
interface ProspectCallRecord {
  id: string;
  callSid?: string;
  callerId?: string;
  toNumber?: string;
  status: string;
  direction?: string;
  duration?: number;
  recordingUrl?: string | null;
  recordingStatus?: string | null;
  disposition?: string | null;
  dispositionNotes?: string | null;
  callSource?: string | null;
  followUpAt?: string | null;
  followUpStatus?: string | null;
  createdAt: string;
  createdBy?: { firstName?: string; lastName?: string } | null;
}

interface ProspectProfile {
  phoneNumber: string;
  calls: ProspectCallRecord[];
  totalCalls: number;
  lastCallDate?: string;
  lastDisposition?: string | null;
  nextFollowUp?: string | null;
}

/* ─── Component ────────────────────────────────────────────────── */
export default function ContactsPage() {
  const [search, setSearch] = useState('');
  const [profile, setProfile] = useState<ProspectProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lookupProspect = useCallback(async (phone: string) => {
    if (!phone || phone.length < 7) return;
    setLoading(true);
    setError(null);
    try {
      // Normalize phone: strip non-digits, add +1 if needed
      let normalized = phone.replace(/[^\d+]/g, '');
      if (!normalized.startsWith('+') && normalized.length === 10) {
        normalized = '+1' + normalized;
      }
      if (!normalized.startsWith('+') && normalized.length === 11 && normalized.startsWith('1')) {
        normalized = '+' + normalized;
      }

      const response = await apiClient.get<{ data: ProspectCallRecord[]; meta: { total: number } }>(
        `/api/v1/calls?phone=${encodeURIComponent(normalized)}&limit=50`
      );

      if (response.data) {
        const calls = response.data.data || [];
        const sorted = calls.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        const pendingFollowUp = sorted.find(c => c.followUpStatus === 'PENDING' && c.followUpAt);

        setProfile({
          phoneNumber: normalized,
          calls: sorted,
          totalCalls: sorted.length,
          lastCallDate: sorted[0]?.createdAt,
          lastDisposition: sorted[0]?.disposition,
          nextFollowUp: pendingFollowUp?.followUpAt,
        });
      }
    } catch (err) {
      console.error('Prospect lookup failed:', err);
      setError('Failed to load call history for this number.');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSearch = useCallback(() => {
    void lookupProspect(search);
  }, [search, lookupProspect]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center justify-between flex-shrink-0 mb-4">
        <div>
          <h1 className="text-2xl font-semibold">Prospect Lookup</h1>
          <p className="text-sm text-muted-foreground">
            View call history and disposition records for a prospect by phone number
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="flex gap-2 mb-4 flex-shrink-0">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="prospect-search"
            name="prospect-search"
            placeholder="Enter phone number..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            className="pl-10"
          />
        </div>
        <Button onClick={handleSearch} disabled={loading || search.length < 7}>
          {loading ? 'Searching...' : 'Lookup'}
        </Button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded p-3 text-xs text-red-400 mb-4">
          {error}
        </div>
      )}

      {/* Profile Summary */}
      {profile && (
        <div className="grid grid-cols-4 gap-4 flex-shrink-0 mb-4">
          <Card>
            <CardContent className="p-4">
              <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Phone</p>
              <p className="text-lg font-semibold text-foreground mt-1">{formatPhoneNumber(profile.phoneNumber)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Total Calls</p>
              <p className="text-lg font-semibold text-foreground mt-1">{profile.totalCalls}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Last Disposition</p>
              <p className="text-lg font-semibold text-foreground mt-1">
                {profile.lastDisposition ? getDispositionLabel(profile.lastDisposition) : '—'}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Next Follow-Up</p>
              <p className="text-lg font-semibold text-foreground mt-1">
                {profile.nextFollowUp
                  ? new Date(profile.nextFollowUp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                  : '—'}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Call History Table */}
      {profile && (
        <Card className="flex-1 flex flex-col overflow-hidden min-h-0">
          <CardHeader className="flex-shrink-0">
            <CardTitle>Call History</CardTitle>
            <CardDescription>
              All calls linked to {formatPhoneNumber(profile.phoneNumber)}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto min-h-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date/Time</TableHead>
                  <TableHead>Direction</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Disposition</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead>Follow-Up</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead className="text-right">Recording</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {profile.calls.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-12 text-muted-foreground">
                      No calls found for this number
                    </TableCell>
                  </TableRow>
                ) : (
                  profile.calls.map(call => (
                    <TableRow key={call.id}>
                      <TableCell className="font-mono text-xs">
                        {new Date(call.createdAt).toLocaleString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </TableCell>
                      <TableCell>
                        {call.direction === 'INBOUND' ? (
                          <span className="inline-flex items-center gap-1 text-xs text-blue-400">
                            <ArrowDownLeft className="h-3 w-3" /> IN
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                            <ArrowUpRight className="h-3 w-3" /> OUT
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {call.callSource ? (
                          <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest">
                            {CALL_SOURCE_LABELS[call.callSource as keyof typeof CALL_SOURCE_LABELS] || call.callSource}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground/50">—</span>
                        )}
                      </TableCell>
                      <TableCell>{call.duration ? formatDuration(call.duration) : '—'}</TableCell>
                      <TableCell>
                        {call.disposition ? (
                          <Badge
                            variant="outline"
                            className={DISPOSITION_COLORS[call.disposition as keyof typeof DISPOSITION_COLORS] || 'bg-secondary text-muted-foreground border-border'}
                          >
                            {getDispositionLabel(call.disposition)}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground/50">—</span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[200px]">
                        {call.dispositionNotes ? (
                          <span className="text-xs text-muted-foreground truncate block" title={call.dispositionNotes}>
                            {call.dispositionNotes}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground/50">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {call.followUpAt ? (
                          <div className="text-xs">
                            <span className="font-mono">
                              {new Date(call.followUpAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </span>
                            {call.followUpStatus === 'PENDING' && (
                              <Badge variant="outline" className="ml-1 bg-amber-500/10 text-amber-400 border-amber-500/30 text-[10px]">
                                Pending
                              </Badge>
                            )}
                            {call.followUpStatus === 'COMPLETED' && (
                              <Badge variant="outline" className="ml-1 bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-[10px]">
                                Done
                              </Badge>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground/50">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {call.createdBy
                          ? `${call.createdBy.firstName || ''} ${call.createdBy.lastName || ''}`.trim() || '—'
                          : '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        {call.recordingStatus === 'READY' && call.recordingUrl ? (
                          <a href={call.recordingUrl} target="_blank" rel="noopener noreferrer">
                            <Button variant="ghost" size="sm">
                              <Play className="h-4 w-4" />
                            </Button>
                          </a>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
