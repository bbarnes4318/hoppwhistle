/* eslint-disable */
'use client';

import {
  Phone,
  Play,
  Search,
  Plus,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useState } from 'react';
import { RoleGuard } from '@/components/auth/role-guard';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { apiClient } from '@/lib/api';
import { formatDuration, formatPhoneNumber, cn } from '@/lib/utils';
import {
  DISPOSITION_LABELS,
  DISPOSITION_COLORS,
  getDispositionLabel,
} from '@hopwhistle/shared';
import { CompactPageShell, CompactPageHeader } from '@/components/layout/compact-layout';

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
function ContactsPage() {
  const [search, setSearch] = useState('');
  const [profile, setProfile] = useState<ProspectProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lookupProspect = useCallback(async (phone: string) => {
    if (!phone || phone.length < 7) return;
    setLoading(true);
    setError(null);
    try {
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
        const sorted = calls.sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
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
    <CompactPageShell>
      <CompactPageHeader
        title="Prospect Lookup"
        subtitle="Search and view prospect call histories and follow-ups"
      >
        <Button
          asChild
          size="sm"
          className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white h-8 text-xs"
        >
          <Link href="/intake">
            <Plus className="h-4 w-4" />
            Add Customer
          </Link>
        </Button>
      </CompactPageHeader>

      {/* Search */}
      <div className="flex gap-2 mt-2 flex-shrink-0">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="prospect-search"
            name="prospect-search"
            placeholder="Enter phone number..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            className="pl-9 h-8 text-xs bg-background border-border/50 text-foreground"
          />
        </div>
        <Button onClick={handleSearch} disabled={loading || search.length < 7} size="sm" className="h-8 text-xs">
          {loading ? 'Searching...' : 'Lookup'}
        </Button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded p-2.5 text-xs text-red-400 flex-shrink-0">
          {error}
        </div>
      )}

      {/* Profile Summary */}
      {profile && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 flex-shrink-0">
          <Card className="bg-card border-border/40 shadow-sm">
            <CardContent className="p-3">
              <p className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">
                Phone
              </p>
              <p className="text-sm font-semibold text-white mt-1">
                {formatPhoneNumber(profile.phoneNumber)}
              </p>
            </CardContent>
          </Card>
          <Card className="bg-card border-border/40 shadow-sm">
            <CardContent className="p-3">
              <p className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">
                Total Calls
              </p>
              <p className="text-sm font-semibold text-white mt-1">{profile.totalCalls}</p>
            </CardContent>
          </Card>
          <Card className="bg-card border-border/40 shadow-sm">
            <CardContent className="p-3">
              <p className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">
                Last Disposition
              </p>
              <p className="text-sm font-semibold text-white mt-1">
                {profile.lastDisposition ? getDispositionLabel(profile.lastDisposition) : '—'}
              </p>
            </CardContent>
          </Card>
          <Card className="bg-card border-border/40 shadow-sm">
            <CardContent className="p-3">
              <p className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">
                Next Follow-Up
              </p>
              <p className="text-sm font-semibold text-white mt-1">
                {profile.nextFollowUp
                  ? new Date(profile.nextFollowUp).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : '—'}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Call History Table */}
      {profile && (
        <Card className="flex-1 flex flex-col overflow-hidden min-h-0 bg-card border-border/40 shadow-sm">
          <CardHeader className="flex-shrink-0 py-2.5 px-3 border-b border-border/10">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Call Ledger</CardTitle>
            <CardDescription className="text-[10px]">Recent communications log with this contact</CardDescription>
          </CardHeader>
          <CardContent className="flex-grow min-h-0 overflow-auto p-0">
            <Table className="table-dense">
              <TableHeader className="sticky top-0 bg-background z-10">
                <TableRow className="border-b border-border/10">
                  <TableHead className="py-2 px-3">Date</TableHead>
                  <TableHead className="py-2 px-3">Direction</TableHead>
                  <TableHead className="py-2 px-3">Agent</TableHead>
                  <TableHead className="py-2 px-3 text-right">Duration</TableHead>
                  <TableHead className="py-2 px-3">Disposition</TableHead>
                  <TableHead className="py-2 px-3">Notes</TableHead>
                  <TableHead className="py-2 px-3 text-right">Recording</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {profile.calls.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground text-xs">
                      No calls found for this profile
                    </TableCell>
                  </TableRow>
                ) : (
                  profile.calls.map(call => (
                    <TableRow key={call.id} className="hover:bg-muted/30 border-b border-border/10 text-white">
                      <TableCell className="py-2 px-3 font-mono text-[10px] text-muted-foreground">
                        {new Date(call.createdAt).toLocaleString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: false,
                        })}
                      </TableCell>
                      <TableCell className="py-2 px-3">
                        {call.direction === 'OUTBOUND' ? (
                          <span className="flex items-center gap-1 text-[10px] text-amber-400">
                            Outbound
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-[10px] text-emerald-400">
                            Inbound
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="py-2 px-3 text-xs">
                        {call.createdBy
                          ? `${call.createdBy.firstName || ''} ${call.createdBy.lastName || ''}`.trim()
                          : 'System'}
                      </TableCell>
                      <TableCell className="py-2 px-3 text-right font-mono text-[10px]">
                        {call.duration ? formatDuration(call.duration) : '—'}
                      </TableCell>
                      <TableCell className="py-2 px-3">
                        {call.disposition ? (
                          <Badge
                            variant="outline"
                            className={cn(
                              'text-[8px] px-1 py-0 border-none',
                              DISPOSITION_COLORS[call.disposition] || 'bg-slate-500/10 text-slate-400'
                            )}
                          >
                            {DISPOSITION_LABELS[call.disposition] || call.disposition}
                          </Badge>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="py-2 px-3 max-w-[200px] truncate text-[10px] text-muted-foreground" title={call.dispositionNotes || ''}>
                        {call.dispositionNotes || '—'}
                      </TableCell>
                      <TableCell className="py-2 px-3 text-right">
                        {call.recordingUrl ? (
                          <a
                            href={call.recordingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <Button size="icon" variant="ghost" className="h-6 w-6">
                              <Play className="h-3.5 w-3.5" />
                            </Button>
                          </a>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">—</span>
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
    </CompactPageShell>
  );
}

export default function GuardedContactsPage() {
  return (
    <RoleGuard allowedRoles={['AGENT', 'ADMIN', 'OWNER']}>
      <ContactsPage />
    </RoleGuard>
  );
}
