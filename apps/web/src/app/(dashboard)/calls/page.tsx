'use client';

import {
  CALL_SOURCE_LABELS,
  DISPOSITION_COLORS,
  DISPOSITION_LABELS,
} from '@hopwhistle/shared';
import { Download, Loader2, Play, Search } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { apiClient } from '@/lib/api';
import { formatDuration, formatPhoneNumber } from '@/lib/utils';

interface CallRecord {
  id: string;
  callSid?: string;
  callerId?: string;
  did?: string;
  toNumber?: string;
  targetNumber?: string;
  status: string;
  duration?: number;
  connectedDuration?: number;
  converted?: boolean;
  paidOut?: boolean;
  missedCall?: boolean;
  recordingUrl?: string | null;
  recordingStatus?: string | null;
  primaryRecordingId?: string | null;
  recordingError?: string | null;
  recordingStartedAt?: string | null;
  recordingCompletedAt?: string | null;
  disposition?: string | null;
  dispositionNotes?: string | null;
  callSource?: string | null;
  followUpAt?: string | null;
  followUpStatus?: string | null;
  createdAt: string;
  answeredAt?: string | null;
  endedAt?: string | null;
  campaign?: { name: string } | null;
  fromNumber?: { number: string } | null;
}

function getCallResult(call: CallRecord): string {
 if (call.disposition) {
 return DISPOSITION_LABELS[call.disposition] || call.disposition;
 }
 if (call.missedCall) return 'No Answer';
 if (call.status === 'COMPLETED') return 'Completed';
 if (call.status === 'NO_ANSWER') return 'No Answer';
 if (call.status === 'BUSY') return 'Busy';
 if (call.status === 'FAILED') return 'Failed';
 return call.status || 'Unknown';
}

function getResultBadgeClass(call: CallRecord): string {
 if (call.disposition && DISPOSITION_COLORS[call.disposition as keyof typeof DISPOSITION_COLORS]) {
 return DISPOSITION_COLORS[call.disposition as keyof typeof DISPOSITION_COLORS];
 }
 switch (call.status) {
 case 'COMPLETED':
 return 'bg-blue-500/10 text-blue-400 border-blue-500/30';
 case 'FAILED':
 case 'BUSY':
 return 'bg-red-500/10 text-red-400 border-red-500/30';
 default:
 return 'bg-secondary text-muted-foreground border-border';
 }
}

export default function CallLogsPage() {
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [datePreset, setDatePreset] = useState<string>('All Time');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');

  const calculatePresetDates = (preset: string): { from: Date | null; to: Date | null } => {
    const now = new Date();
    const startOfDay = (d: Date) => {
      const res = new Date(d);
      res.setHours(0, 0, 0, 0);
      return res;
    };
    const endOfDay = (d: Date) => {
      const res = new Date(d);
      res.setHours(23, 59, 59, 999);
      return res;
    };

    switch (preset) {
      case 'Today': {
        return { from: startOfDay(now), to: endOfDay(now) };
      }
      case 'Yesterday': {
        const yesterday = new Date();
        yesterday.setDate(now.getDate() - 1);
        return { from: startOfDay(yesterday), to: endOfDay(yesterday) };
      }
      case 'This Week': {
        const monday = new Date();
        const currentDay = now.getDay();
        const distance = currentDay === 0 ? -6 : 1 - currentDay;
        monday.setDate(now.getDate() + distance);
        
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        return { from: startOfDay(monday), to: endOfDay(sunday) };
      }
      case 'Last Week': {
        const prevMonday = new Date();
        const currentDay = now.getDay();
        const distance = currentDay === 0 ? -13 : -6 - currentDay;
        prevMonday.setDate(now.getDate() + distance);

        const prevSunday = new Date(prevMonday);
        prevSunday.setDate(prevMonday.getDate() + 6);
        return { from: startOfDay(prevMonday), to: endOfDay(prevSunday) };
      }
      case 'This Month': {
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        return { from: startOfDay(start), to: endOfDay(end) };
      }
      case 'Last Month': {
        const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const end = new Date(now.getFullYear(), now.getMonth(), 0);
        return { from: startOfDay(start), to: endOfDay(end) };
      }
      case 'This Quarter': {
        const quarter = Math.floor(now.getMonth() / 3);
        const start = new Date(now.getFullYear(), quarter * 3, 1);
        const end = new Date(now.getFullYear(), (quarter + 1) * 3, 0);
        return { from: startOfDay(start), to: endOfDay(end) };
      }
      case 'Last Quarter': {
        const quarter = Math.floor(now.getMonth() / 3) - 1;
        const start = new Date(now.getFullYear(), quarter * 3, 1);
        const end = new Date(now.getFullYear(), (quarter + 1) * 3, 0);
        return { from: startOfDay(start), to: endOfDay(end) };
      }
      case 'This Year': {
        const start = new Date(now.getFullYear(), 0, 1);
        const end = new Date(now.getFullYear(), 12, 0);
        return { from: startOfDay(start), to: endOfDay(end) };
      }
      case 'Last Year': {
        const start = new Date(now.getFullYear() - 1, 0, 1);
        const end = new Date(now.getFullYear() - 1, 12, 0);
        return { from: startOfDay(start), to: endOfDay(end) };
      }
      case 'Custom':
      default:
        return { from: null, to: null };
    }
  };

  const formatDateToLocalInput = (date: Date | null): string => {
    if (!date) return '';
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  const handlePresetChange = (val: string) => {
    setDatePreset(val);
    if (val === 'All Time') {
      setFromDate('');
      setToDate('');
    } else if (val !== 'Custom') {
      const { from, to } = calculatePresetDates(val);
      setFromDate(from ? formatDateToLocalInput(from) : '');
      setToDate(to ? formatDateToLocalInput(to) : '');
    }
    setPage(1);
  };

  const handlePlayRecording = async (recordingId: string) => {
    try {
      const response = await apiClient.get<{ url: string }>(`/api/v1/recordings/${recordingId}/url`);
      if (response.data?.url) {
        let playableUrl = response.data.url;
        if (playableUrl.startsWith('/')) {
          const apiBaseUrl = typeof window !== 'undefined' ? window.location.origin : (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001');
          playableUrl = `${apiBaseUrl.replace(/\/$/, '')}${playableUrl}`;
        }
        window.open(playableUrl, '_blank');
      } else {
        alert('Could not retrieve playback URL');
      }
    } catch (err) {
      console.error('Failed to get playback URL:', err);
      alert('Failed to load recording playback URL');
    }
  };

  const handlePlayCallRecording = async (call: CallRecord) => {
    if (call.primaryRecordingId) {
      await handlePlayRecording(call.primaryRecordingId);
    } else if (call.recordingUrl) {
      // Try to extract recording ID from /api/v1/recordings/:recordingId/stream
      const match = call.recordingUrl.match(/\/api\/v1\/recordings\/([a-zA-Z0-9_-]+)\/stream/);
      if (match && match[1]) {
        await handlePlayRecording(match[1]);
      } else {
        let url = call.recordingUrl;
        if (url.startsWith('/')) {
          const apiBaseUrl = typeof window !== 'undefined' ? window.location.origin : (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001');
          url = `${apiBaseUrl.replace(/\/$/, '')}${url}`;
        }
        window.open(url, '_blank');
      }
    }
  };

  const fetchCalls = useCallback(async () => {
    setLoading(true);
    try {
      let startIso = '';
      let endIso = '';
      
      if (datePreset && datePreset !== 'Custom' && datePreset !== 'All Time') {
        const { from, to } = calculatePresetDates(datePreset);
        if (from) startIso = from.toISOString();
        if (to) endIso = to.toISOString();
      } else if (datePreset === 'Custom') {
        if (fromDate) {
          startIso = new Date(fromDate + 'T00:00:00').toISOString();
        }
        if (toDate) {
          endIso = new Date(toDate + 'T23:59:59.999').toISOString();
        }
      }

      const queryParams = new URLSearchParams({
        page: String(page),
        limit: '50',
      });
      if (search.trim()) {
        queryParams.append('search', search.trim());
      }
      if (startIso) {
        queryParams.append('startDate', startIso);
      }
      if (endIso) {
        queryParams.append('endDate', endIso);
      }

      const response = await apiClient.get<{ data: CallRecord[]; meta: { totalPages: number } }>(
        `/api/v1/calls?${queryParams.toString()}`
      );
      if (response.data) {
        setCalls(response.data.data || []);
        setTotalPages(response.data.meta?.totalPages || 1);
      }
    } catch (error) {
      console.error('Failed to fetch calls:', error);
    } finally {
      setLoading(false);
    }
  }, [page, search, datePreset, fromDate, toDate]);

  useEffect(() => {
    void fetchCalls();
  }, [fetchCalls]);

  const handleExportCSV = async () => {
    setExporting(true);
    try {
      let startIso = '';
      let endIso = '';
      
      if (datePreset && datePreset !== 'Custom' && datePreset !== 'All Time') {
        const { from, to } = calculatePresetDates(datePreset);
        if (from) startIso = from.toISOString();
        if (to) endIso = to.toISOString();
      } else if (datePreset === 'Custom') {
        if (fromDate) {
          startIso = new Date(fromDate + 'T00:00:00').toISOString();
        }
        if (toDate) {
          endIso = new Date(toDate + 'T23:59:59.999').toISOString();
        }
      }

      const queryParams = new URLSearchParams();
      if (search.trim()) {
        queryParams.append('search', search.trim());
      }
      if (startIso) {
        queryParams.append('startDate', startIso);
      }
      if (endIso) {
        queryParams.append('endDate', endIso);
      }

      const headers: HeadersInit = {};
      const storedToken = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
      if (storedToken) {
        headers['Authorization'] = `Bearer ${storedToken}`;
      }
      const apiKey = process.env.NEXT_PUBLIC_API_KEY;
      if (apiKey) {
        headers['x-api-key'] = apiKey;
      }
      const demoMode = typeof window !== 'undefined' ? localStorage.getItem('demoMode') === 'true' : false;
      const demoTenantId = typeof window !== 'undefined' ? localStorage.getItem('demoTenantId') : null;
      if (demoMode && demoTenantId) {
        headers['X-Demo-Tenant-Id'] = demoTenantId;
      }

      const apiBaseUrl = typeof window !== 'undefined' ? window.location.origin : (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001');
      const url = `${apiBaseUrl.replace(/\/$/, '')}/api/v1/calls/export.csv?${queryParams.toString()}`;

      const res = await fetch(url, {
        method: 'GET',
        headers,
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || 'Export failed');
      }

      const blob = await res.blob();
      const contentDisposition = res.headers.get('Content-Disposition');
      let filename = `call-logs-${new Date().toISOString().slice(0, 10)}.csv`;
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="?([^"]+)"?/);
        if (match && match[1]) {
          filename = match[1];
        }
      }

      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      console.error('Failed to export CSV:', err);
      alert('Failed to export CSV. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between flex-shrink-0 mb-4">
        <div>
          <h1 className="text-2xl font-semibold">Call Logs</h1>
          <p className="text-sm text-muted-foreground">
            View call history and disposition outcomes
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-48">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="call-logs-search"
              name="call-logs-search"
              placeholder="Search calls..."
              value={search}
              onChange={e => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="pl-10"
            />
          </div>
          <div className="w-40">
            <Select
              value={datePreset}
              onValueChange={handlePresetChange}
            >
              <SelectTrigger id="call-logs-date-preset">
                <SelectValue placeholder="All Time" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="All Time">All Time</SelectItem>
                <SelectItem value="Today">Today</SelectItem>
                <SelectItem value="Yesterday">Yesterday</SelectItem>
                <SelectItem value="This Week">This Week</SelectItem>
                <SelectItem value="Last Week">Last Week</SelectItem>
                <SelectItem value="This Month">This Month</SelectItem>
                <SelectItem value="Last Month">Last Month</SelectItem>
                <SelectItem value="This Quarter">This Quarter</SelectItem>
                <SelectItem value="Last Quarter">Last Quarter</SelectItem>
                <SelectItem value="This Year">This Year</SelectItem>
                <SelectItem value="Last Year">Last Year</SelectItem>
                <SelectItem value="Custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="w-36">
            <Input
              id="call-logs-from-date"
              type="date"
              value={fromDate}
              onChange={e => {
                setFromDate(e.target.value);
                setDatePreset('Custom');
                setPage(1);
              }}
              className="w-full text-sm"
            />
          </div>
          <div className="w-36">
            <Input
              id="call-logs-to-date"
              type="date"
              value={toDate}
              onChange={e => {
                setToDate(e.target.value);
                setDatePreset('Custom');
                setPage(1);
              }}
              className="w-full text-sm"
            />
          </div>
          <Button
            id="call-logs-export-csv"
            variant="outline"
            onClick={handleExportCSV}
            disabled={exporting}
            className="gap-2"
          >
            {exporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Export CSV
          </Button>
        </div>
      </div>

  <Card className="flex-1 flex flex-col overflow-hidden min-h-0">
  <CardContent className="flex-1 overflow-y-auto min-h-0 p-0">
  <Table>
  <TableHeader className="bg-muted/10">
  <TableRow>
  <TableHead className="pl-6">Time</TableHead>
  <TableHead>From</TableHead>
  <TableHead>To</TableHead>
  <TableHead>Duration</TableHead>
  <TableHead>Disposition</TableHead>
  <TableHead>Source</TableHead>
  <TableHead>Notes</TableHead>
  <TableHead className="pr-6 text-right">Recording</TableHead>
  </TableRow>
  </TableHeader>
  <TableBody>
  {loading ? (
  <TableRow>
  <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
  Loading calls...
  </TableCell>
  </TableRow>
  ) : calls.length === 0 ? (
  <TableRow>
  <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
  No calls found
  </TableCell>
  </TableRow>
  ) : (
  calls.map(call => {
  const result = getCallResult(call);
  return (
  <TableRow key={call.id}>
  <TableCell className="pl-6 font-mono text-xs">
  {new Date(call.createdAt).toLocaleString('en-US', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  })}
  </TableCell>
  <TableCell>
  {formatPhoneNumber(call.callerId || call.fromNumber?.number || '—')}
  </TableCell>
  <TableCell>
  {formatPhoneNumber(call.toNumber || call.targetNumber || call.did || '—')}
  </TableCell>
  <TableCell className="font-mono text-xs">
  {(() => {
  const dur = call.connectedDuration || call.duration;
  if (dur) return formatDuration(dur);
  if (call.answeredAt && call.endedAt) {
  const secs = Math.floor((new Date(call.endedAt).getTime() - new Date(call.answeredAt).getTime()) / 1000);
  return secs > 0 ? formatDuration(secs) : '—';
  }
  return '—';
  })()}
  </TableCell>
  <TableCell>
  <Badge variant="outline" className={getResultBadgeClass(call)}>
  {result}
  </Badge>
  </TableCell>
  <TableCell>
  {call.callSource ? (
  <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest">
  {CALL_SOURCE_LABELS[call.callSource] || call.callSource}
  </span>
  ) : (
  <span className="text-xs text-muted-foreground/50">—</span>
  )}
  </TableCell>
  <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground font-sans" title={call.dispositionNotes || ''}>
  {call.dispositionNotes || '—'}
  </TableCell>
   <TableCell className="pr-6 text-right">
   {(() => {
   const recUrl =
     call.recordingUrl ||
     (call.primaryRecordingId
       ? `/api/v1/recordings/${call.primaryRecordingId}/stream`
       : null);

   if (recUrl || call.primaryRecordingId || call.recordingUrl) {
     return (
       <Button
         variant="ghost"
         size="sm"
         onClick={() => handlePlayCallRecording(call)}
         title={
           call.recordingStatus && call.recordingStatus !== 'READY'
             ? `Play Recording (${call.recordingStatus})`
             : 'Play Recording'
         }
       >
         <Play className="h-4 w-4" />
       </Button>
     );
   }

   if (call.recordingStatus === 'FAILED') {
     return (
       <span
         className="inline-flex items-center gap-1 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-400 cursor-help"
         title={call.recordingError || 'Recording failed'}
       >
         ✕ Failed
       </span>
     );
   }

   if (
     call.recordingStatus === 'PENDING' ||
     call.recordingStatus === 'RECORDING' ||
     call.recordingStatus === 'PROCESSING'
   ) {
     return (
       <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-400">
         <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
           <circle
             className="opacity-25"
             cx="12"
             cy="12"
             r="10"
             stroke="currentColor"
             strokeWidth="4"
           />
           <path
             className="opacity-75"
             fill="currentColor"
             d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
           />
         </svg>
         {call.recordingStatus === 'PENDING'
           ? 'Pending'
           : call.recordingStatus === 'RECORDING'
             ? 'Recording'
             : 'Processing'}
       </span>
     );
   }

   return <span className="text-xs text-muted-foreground">—</span>;
   })()}
   </TableCell>
  </TableRow>
  );
  })
  )}
  </TableBody>
  </Table>
  
  {/* Pagination */}
 {totalPages > 1 && (
 <div className="flex items-center justify-center gap-2 py-3 border-t">
 <Button
 variant="outline"
 size="sm"
 onClick={() => setPage(p => Math.max(1, p - 1))}
 disabled={page === 1}
 >
 Previous
 </Button>
 <span className="text-sm text-muted-foreground">
 Page {page} of {totalPages}
 </span>
 <Button
 variant="outline"
 size="sm"
 onClick={() => setPage(p => Math.min(totalPages, p + 1))}
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

