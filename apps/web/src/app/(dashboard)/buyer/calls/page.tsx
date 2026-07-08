'use client';

import {
  Calendar,
  Download,
  Loader2,
  Play,
  Pause,
  Search,
  Volume2,
  AlertCircle,
  FileSpreadsheet,
} from 'lucide-react';
import { useCallback, useEffect, useState, useRef } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAuth } from '@/hooks/use-auth';
import { apiClient } from '@/lib/api';
import { formatDuration, formatPhoneNumber } from '@/lib/utils';
import { toast } from '@/components/ui/use-toast';
import { RoleGuard } from '@/components/auth/role-guard';

interface CallRecord {
  id: string;
  callerId?: string;
  toNumber?: string;
  targetNumber?: string;
  status: string;
  duration?: number;
  connectedDuration?: number;
  billable: boolean;
  buyerBillableAmount?: number;
  recordingUrl?: string | null;
  recordingStatus?: string | null;
  primaryRecordingId?: string | null;
  createdAt: string;
}

type DatePreset = 'last-7' | 'last-30' | 'last-90' | 'custom';

function BuyerCallsPage() {
  const { user, buyerId, canViewRecordings } = useAuth();

  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [search, setSearch] = useState('');
  const [billableFilter, setBillableFilter] = useState<'all' | 'billable' | 'non-billable'>('all');
  const [datePreset, setDatePreset] = useState<DatePreset>('last-30');
  
  // Custom Date range
  const today = new Date().toISOString().split('T')[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const [startDate, setStartDate] = useState(thirtyDaysAgo);
  const [endDate, setEndDate] = useState(today);

  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Audio Playback State
  const [playingCallId, setPlayingCallId] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const fetchCalls = useCallback(async () => {
    if (!buyerId) return;
    setLoading(true);
    try {
      let start = startDate;
      let end = endDate;

      if (datePreset === 'last-7') {
        start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        end = today;
      } else if (datePreset === 'last-30') {
        start = thirtyDaysAgo;
        end = today;
      } else if (datePreset === 'last-90') {
        start = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        end = today;
      }

      const queryParams = new URLSearchParams({
        page: String(page),
        limit: '20',
        startDate: `${start}T00:00:00.000Z`,
        endDate: `${end}T23:59:59.999Z`,
        buyerId,
      });

      if (search.trim()) {
        queryParams.append('search', search.trim());
      }

      const response = await apiClient.get<{ data: CallRecord[]; meta: { totalPages: number } }>(
        `/api/v1/calls?${queryParams.toString()}`
      );

      if (response.data) {
        let filteredData = response.data.data || [];
        if (billableFilter === 'billable') {
          filteredData = filteredData.filter(c => c.billable);
        } else if (billableFilter === 'non-billable') {
          filteredData = filteredData.filter(c => !c.billable);
        }
        setCalls(filteredData);
        setTotalPages(response.data.meta?.totalPages || 1);
      }
    } catch (err) {
      console.error('Failed to fetch buyer calls:', err);
      toast.error('Failed to load call logs');
    } finally {
      setLoading(false);
    }
  }, [buyerId, page, search, billableFilter, datePreset, startDate, endDate, today, thirtyDaysAgo]);

  useEffect(() => {
    void fetchCalls();
  }, [fetchCalls]);

  const handleExportCSV = async () => {
    if (!buyerId) return;
    setExporting(true);
    try {
      let start = startDate;
      let end = endDate;

      if (datePreset === 'last-7') {
        start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        end = today;
      } else if (datePreset === 'last-30') {
        start = thirtyDaysAgo;
        end = today;
      } else if (datePreset === 'last-90') {
        start = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        end = today;
      }

      const queryParams = new URLSearchParams({
        startDate: `${start}T00:00:00.000Z`,
        endDate: `${end}T23:59:59.999Z`,
        buyerId,
      });

      // Redirect browser or perform download using CSV export endpoint
      window.open(`/api/v1/reports/buyer-costs/export.csv?${queryParams.toString()}`);
      toast.success('Export initiated successfully');
    } catch (err) {
      console.error('Failed to export call logs:', err);
      toast.error('Failed to export call logs');
    } finally {
      setExporting(false);
    }
  };

  const handlePlayAudio = async (call: CallRecord) => {
    if (!canViewRecordings) return;

    if (playingCallId === call.id) {
      // Toggle play/pause
      if (audioRef.current) {
        if (audioRef.current.paused) {
          void audioRef.current.play();
        } else {
          audioRef.current.pause();
        }
      }
      return;
    }

    setPlayingCallId(call.id);
    setAudioLoading(true);

    try {
      const recId = call.primaryRecordingId;
      const url = recId 
        ? `/api/v1/recordings/${recId}/stream`
        : call.recordingUrl;

      if (!url) {
        throw new Error('No recording URL found');
      }

      setAudioUrl(url);
      
      if (audioRef.current) {
        audioRef.current.src = url;
        audioRef.current.load();
        void audioRef.current.play();
      }
    } catch (err) {
      console.error('Failed to play recording:', err);
      toast.error('Could not load recording stream');
      setPlayingCallId(null);
    } finally {
      setAudioLoading(false);
    }
  };

  // Listen to audio ref events to sync UI state
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onEnded = () => setPlayingCallId(null);
    const onPause = () => {};
    const onPlay = () => {};

    audio.addEventListener('ended', onEnded);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('play', onPlay);

    return () => {
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('play', onPlay);
    };
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Call Logs</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            View detailed reports of all calls routed to your targets.
          </p>
        </div>
        <Button onClick={handleExportCSV} disabled={exporting} variant="outline" size="sm" className="flex items-center gap-2">
          {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
          Export CSV
        </Button>
      </div>

      {/* Hidden audio element for stream playback */}
      <audio ref={audioRef} className="hidden" />

      {/* Filters Card */}
      <Card className="bg-card border-border">
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {/* Search */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Search</label>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search caller ID..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-9 h-9 border-border bg-background"
                />
              </div>
            </div>

            {/* Billable Status */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</label>
              <Select value={billableFilter} onValueChange={(val: any) => setBillableFilter(val)}>
                <SelectTrigger className="h-9 border-border bg-background">
                  <SelectValue placeholder="All calls" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All calls</SelectItem>
                  <SelectItem value="billable">Billable</SelectItem>
                  <SelectItem value="non-billable">Non-Billable</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Date Preset */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Date Period</label>
              <Select value={datePreset} onValueChange={(val: any) => setDatePreset(val)}>
                <SelectTrigger className="h-9 border-border bg-background">
                  <SelectValue placeholder="Select period" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="last-7">Last 7 Days</SelectItem>
                  <SelectItem value="last-30">Last 30 Days</SelectItem>
                  <SelectItem value="last-90">Last 90 Days</SelectItem>
                  <SelectItem value="custom">Custom Range</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Custom Dates */}
            {datePreset === 'custom' && (
              <>
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">From</label>
                  <Input
                    type="date"
                    value={startDate}
                    onChange={e => setStartDate(e.target.value)}
                    className="h-9 border-border bg-background"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">To</label>
                  <Input
                    type="date"
                    value={endDate}
                    onChange={e => setEndDate(e.target.value)}
                    className="h-9 border-border bg-background"
                  />
                </div>
              </>
            )}

            {/* Apply Button */}
            <div className="flex items-end">
              <Button onClick={() => { setPage(1); void fetchCalls(); }} className="w-full h-9" variant="secondary">
                Apply Filters
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results Table */}
      <Card className="bg-card border-border">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/15">
                  <th className="p-4 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground w-[180px]">Time</th>
                  <th className="p-4 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Caller ID</th>
                  <th className="p-4 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Destination/Target</th>
                  <th className="p-4 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Duration</th>
                  <th className="p-4 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
                  <th className="p-4 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">Cost</th>
                  {canViewRecordings && (
                    <th className="p-4 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground w-[120px]">Recording</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading ? (
                  <tr>
                    <td colSpan={canViewRecordings ? 7 : 6} className="py-12 text-center text-sm text-muted-foreground">
                      <div className="flex items-center justify-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        <span>Loading call history...</span>
                      </div>
                    </td>
                  </tr>
                ) : calls.length === 0 ? (
                  <tr>
                    <td colSpan={canViewRecordings ? 7 : 6} className="py-12 text-center text-sm text-muted-foreground">
                      No calls found matching the criteria.
                    </td>
                  </tr>
                ) : (
                  calls.map(call => {
                    const isPlaying = playingCallId === call.id;
                    return (
                      <tr key={call.id} className="hover:bg-muted/30 transition-colors duration-150">
                        <td className="p-4 font-mono text-xs text-muted-foreground">
                          {new Date(call.createdAt).toLocaleString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })}
                        </td>
                        <td className="p-4 font-mono text-xs text-foreground">
                          {formatPhoneNumber(call.callerId || '—')}
                        </td>
                        <td className="p-4 font-mono text-xs text-foreground">
                          {formatPhoneNumber(call.toNumber || call.targetNumber || '—')}
                        </td>
                        <td className="p-4 font-mono text-xs text-muted-foreground">
                          {formatDuration(call.connectedDuration || call.duration || 0)}
                        </td>
                        <td className="p-4">
                          <Badge variant={call.billable ? 'success' : 'outline'} className="text-xs">
                            {call.billable ? 'Billable' : 'Non-Billable'}
                          </Badge>
                        </td>
                        <td className="p-4 text-right font-mono text-xs text-emerald-400 font-semibold">
                          ${Number(call.buyerBillableAmount || 0).toFixed(2)}
                        </td>
                        {canViewRecordings && (
                          <td className="p-4 text-right">
                            {call.recordingStatus === 'READY' || call.primaryRecordingId || call.recordingUrl ? (
                              <Button
                                size="xs"
                                variant="outline"
                                onClick={() => void handlePlayAudio(call)}
                                className="inline-flex items-center gap-1 text-xs"
                              >
                                {isPlaying ? (
                                  <>
                                    <Pause className="h-3 w-3 text-cyan-400" /> Playing
                                  </>
                                ) : (
                                  <>
                                    <Play className="h-3 w-3" /> Listen
                                  </>
                                )}
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground/40">None</span>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {!loading && totalPages > 1 && (
            <div className="flex items-center justify-between border-t p-4 pr-24">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => Math.max(p - 1, 1))}
                disabled={page === 1}
              >
                Previous
              </Button>
              <span className="text-xs text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => Math.min(p + 1, totalPages))}
                disabled={page === totalPages}
              >
                Next
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function GuardedBuyerCallsPage() {
  return (
    <RoleGuard allowedRoles={['BUYER']}>
      <BuyerCallsPage />
    </RoleGuard>
  );
}
