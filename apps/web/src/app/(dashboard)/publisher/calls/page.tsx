'use client';

import {
  CALL_SOURCE_LABELS,
} from '@hopwhistle/shared';
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

interface CallRecord {
  id: string;
  callerId?: string;
  did?: string;
  toNumber?: string;
  targetNumber?: string;
  status: string;
  duration?: number;
  connectedDuration?: number;
  billable: boolean;
  payout?: number;
  nonBillableReason?: string;
  buyerName?: string | null;
  recordingUrl?: string | null;
  recordingStatus?: string | null;
  primaryRecordingId?: string | null;
  recordingError?: string | null;
  createdAt: string;
  campaign?: { name: string } | null;
  callSource?: string | null;
}

type DatePreset = 'last-7' | 'last-30' | 'last-90' | 'custom';

export default function PublisherCallsPage() {
  const { user } = useAuth();
  const publisherId = user?.publisherId;

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
    if (!publisherId) return;
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
      console.error('Failed to fetch publisher calls:', err);
      toast.error('Failed to load call logs');
    } finally {
      setLoading(false);
    }
  }, [publisherId, page, search, billableFilter, datePreset, startDate, endDate, today, thirtyDaysAgo]);

  useEffect(() => {
    void fetchCalls();
  }, [fetchCalls]);

  const handleExportCSV = async () => {
    if (!publisherId) return;
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

      const token = localStorage.getItem('token');
      const url = `/api/v1/calls/export.csv?startDate=${start}&endDate=${end}&token=${token || ''}`;
      
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to generate export.');
      
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.setAttribute('download', `publisher_calls_${start}_to_${end}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success('Export completed successfully');
    } catch (err) {
      console.error('Export failed:', err);
      toast.error('CSV Export Failed');
    } finally {
      setExporting(false);
    }
  };

  const handlePlayRecording = async (call: CallRecord) => {
    if (playingCallId === call.id) {
      // Pause
      if (audioRef.current) {
        audioRef.current.pause();
      }
      setPlayingCallId(null);
      return;
    }

    const recordingId = call.primaryRecordingId;
    if (!recordingId) {
      toast.error('No recording available for playback');
      return;
    }

    setAudioLoading(true);
    try {
      const response = await apiClient.get<{ url: string }>(`/api/v1/recordings/${recordingId}/url`);
      if (response.data?.url) {
        let playableUrl = response.data.url;
        if (playableUrl.startsWith('/')) {
          const apiBaseUrl = typeof window !== 'undefined' ? window.location.origin : (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001');
          playableUrl = `${apiBaseUrl.replace(/\/$/, '')}${playableUrl}`;
        }
        setAudioUrl(playableUrl);
        setPlayingCallId(call.id);
        
        // Wait for next tick so audioRef is bound
        setTimeout(() => {
          if (audioRef.current) {
            audioRef.current.load();
            audioRef.current.play().catch(e => {
              console.error('Playback failed', e);
              toast.error('Audio playback failed');
            });
          }
        }, 50);
      } else {
        toast.error('Failed to resolve recording URL');
      }
    } catch (err) {
      console.error('Playback error:', err);
      toast.error('Failed to play recording');
    } finally {
      setAudioLoading(false);
    }
  };

  return (
    <div className="space-y-6 p-6 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white">Call Logs</h1>
          <p className="text-sm text-gray-400">
            Monitor incoming calls, track conversion details, and listen to recordings.
          </p>
        </div>
        <Button
          onClick={handleExportCSV}
          disabled={exporting || calls.length === 0}
          className="bg-cyan-600 hover:bg-cyan-500 text-white font-medium gap-2 self-start md:self-auto shadow-lg shadow-cyan-900/20"
        >
          {exporting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          Export CSV
        </Button>
      </div>

      {/* Filter Bar */}
      <Card className="bg-white/5 border-white/10 backdrop-blur-xl">
        <CardContent className="p-4 flex flex-col lg:flex-row items-end lg:items-center gap-4 justify-between">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 w-full lg:w-auto flex-1">
            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search Caller/Campaign..."
                value={search}
                onChange={e => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="pl-9 bg-white/5 border-white/10 text-white focus:border-cyan-500 placeholder-gray-500"
              />
            </div>

            {/* Billable Status */}
            <div>
              <Select
                value={billableFilter}
                onValueChange={val => {
                  setBillableFilter(val as any);
                  setPage(1);
                }}
              >
                <SelectTrigger className="bg-white/5 border-white/10 text-white focus:border-cyan-500">
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-white/10 text-white">
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="billable">Billable</SelectItem>
                  <SelectItem value="non-billable">Non-Billable</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Date Preset */}
            <div>
              <Select
                value={datePreset}
                onValueChange={val => {
                  setDatePreset(val as DatePreset);
                  setPage(1);
                }}
              >
                <SelectTrigger className="bg-white/5 border-white/10 text-white focus:border-cyan-500">
                  <SelectValue placeholder="Date Range" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-white/10 text-white">
                  <SelectItem value="last-7">Last 7 Days</SelectItem>
                  <SelectItem value="last-30">Last 30 Days</SelectItem>
                  <SelectItem value="last-90">Last 90 Days</SelectItem>
                  <SelectItem value="custom">Custom Range</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Custom Range Picker */}
            {datePreset === 'custom' && (
              <div className="flex gap-2 items-center col-span-1 md:col-span-2">
                <Input
                  type="date"
                  value={startDate}
                  onChange={e => {
                    setStartDate(e.target.value);
                    setPage(1);
                  }}
                  className="bg-white/5 border-white/10 text-white focus:border-cyan-500"
                />
                <span className="text-gray-500 text-xs">to</span>
                <Input
                  type="date"
                  value={endDate}
                  onChange={e => {
                    setEndDate(e.target.value);
                    setPage(1);
                  }}
                  className="bg-white/5 border-white/10 text-white focus:border-cyan-500"
                />
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Calls Log Table */}
      <Card className="bg-white/5 border-white/10 backdrop-blur-xl">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-white/10 hover:bg-transparent">
                  <TableHead className="text-gray-400 font-medium pl-6">Time</TableHead>
                  <TableHead className="text-gray-400 font-medium">Caller ID</TableHead>
                  <TableHead className="text-gray-400 font-medium">Campaign</TableHead>
                  <TableHead className="text-gray-400 font-medium">Source/SubID</TableHead>
                  <TableHead className="text-gray-400 font-medium">Buyer/Dest</TableHead>
                  <TableHead className="text-gray-400 font-medium">Duration</TableHead>
                  <TableHead className="text-gray-400 font-medium">Connected</TableHead>
                  <TableHead className="text-gray-400 font-medium">Status</TableHead>
                  <TableHead className="text-gray-400 font-medium text-right pr-6">Payout</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={9} className="h-48 text-center text-gray-500">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
                        <span>Loading call records...</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : calls.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={9} className="h-48 text-center text-gray-500">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <AlertCircle className="h-8 w-8 text-gray-600" />
                        <span>No call records found matching criteria</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  calls.map(call => {
                    const isPlaying = playingCallId === call.id;
                    const showBuyer = call.buyerName && call.buyerName !== 'Masked';
                    const showDest = call.toNumber && call.toNumber !== 'Masked';

                    return (
                      <>
                        <TableRow key={call.id} className="border-white/5 hover:bg-white/5 transition-colors">
                          <TableCell className="pl-6 font-mono text-xs text-white">
                            {new Date(call.createdAt).toLocaleString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit',
                            })}
                          </TableCell>
                          <TableCell className="font-semibold text-white">
                            {call.callerId ? formatPhoneNumber(call.callerId) : '—'}
                          </TableCell>
                          <TableCell className="text-gray-300 font-medium">
                            {call.campaign?.name || '—'}
                          </TableCell>
                          <TableCell className="text-gray-400 font-mono text-xs uppercase tracking-wider">
                            {call.callSource || '—'}
                          </TableCell>
                          <TableCell className="text-xs text-gray-300">
                            {showBuyer || showDest ? (
                              <div className="flex flex-col">
                                {showBuyer && <span className="font-medium text-white">{call.buyerName}</span>}
                                {showDest && <span className="text-gray-400 font-mono">{formatPhoneNumber(call.toNumber || '')}</span>}
                              </div>
                            ) : (
                              <span className="text-gray-600 italic">Masked</span>
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-gray-300">
                            {call.duration ? formatDuration(call.duration) : '—'}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-gray-300">
                            {call.connectedDuration ? formatDuration(call.connectedDuration) : '—'}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1 items-start">
                              <Badge
                                variant="outline"
                                className={
                                  call.billable
                                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                    : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                                }
                              >
                                {call.billable ? 'Billable' : 'Non-Billable'}
                              </Badge>
                              {!call.billable && call.nonBillableReason && (
                                <span className="text-[10px] text-gray-500 max-w-[120px] truncate" title={call.nonBillableReason}>
                                  {call.nonBillableReason}
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right pr-6 font-mono font-bold text-emerald-400">
                            {call.payout !== undefined && call.payout !== null ? (
                              `$${Number(call.payout).toFixed(2)}`
                            ) : (
                              '—'
                            )}
                          </TableCell>
                        </TableRow>

                        {/* Inline Audio Player if recording available */}
                        {call.recordingUrl && (
                          <TableRow key={`${call.id}-player`} className="bg-cyan-950/10 border-white/5 hover:bg-transparent">
                            <TableCell colSpan={9} className="py-2 px-6">
                              <div className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-lg p-2.5 max-w-2xl">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => void handlePlayRecording(call)}
                                  disabled={audioLoading && isPlaying}
                                  className="h-8 w-8 p-0 rounded-full text-cyan-400 hover:text-cyan-300 hover:bg-white/10 flex-shrink-0"
                                >
                                  {audioLoading && isPlaying ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : isPlaying ? (
                                    <Pause className="h-4 w-4" />
                                  ) : (
                                    <Play className="h-4 w-4" />
                                  )}
                                </Button>
                                <Volume2 className="h-4 w-4 text-cyan-400 flex-shrink-0" />
                                <span className="text-xs text-gray-300 font-medium">
                                  Call Recording
                                </span>
                                {isPlaying && audioUrl && (
                                  <audio
                                    ref={audioRef}
                                    src={audioUrl}
                                    controls
                                    className="h-7 flex-1 accent-cyan-400"
                                    onEnded={() => setPlayingCallId(null)}
                                  />
                                )}
                                {!isPlaying && (
                                  <div className="h-1 bg-white/10 rounded-full flex-1" />
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between p-4 border-t border-white/10">
              <span className="text-xs text-gray-400">
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 1}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  className="bg-white/5 border-white/10 text-white hover:bg-white/10"
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === totalPages}
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  className="bg-white/5 border-white/10 text-white hover:bg-white/10"
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
