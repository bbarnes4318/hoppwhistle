'use client';

import { ChevronLeft, ChevronRight, Pause, Play, Search, Settings } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
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
import { cn } from '@/lib/utils';

// All available Call model fields
const ALL_COLUMNS = [
  { key: 'createdAt', label: 'Call Date', default: true },
  { key: 'campaignName', label: 'Campaign', default: true },
  { key: 'buyerName', label: 'Buyer', default: true },
  { key: 'publisherName', label: 'Publisher', default: true },
  { key: 'targetName', label: 'Target', default: true },
  { key: 'callerId', label: 'CallerID', default: true },
  { key: 'connectedDuration', label: 'Connected Duration', default: true },
  { key: 'revenue', label: 'Revenue', default: true },
  { key: 'payout', label: 'Payout', default: true },
  { key: 'recordingUrl', label: 'Recording', default: true },
  // Additional fields available via column picker
  { key: 'id', label: 'Call ID', default: false },
  { key: 'callSid', label: 'Call SID', default: false },
  { key: 'status', label: 'Status', default: false },
  { key: 'direction', label: 'Direction', default: false },
  { key: 'duration', label: 'Total Duration', default: false },
  { key: 'toNumber', label: 'To Number', default: false },
  { key: 'did', label: 'DID', default: false },
  { key: 'targetNumber', label: 'Target Number', default: false },
  { key: 'callerIdAreaCode', label: 'Area Code', default: false },
  { key: 'callerIdState', label: 'Caller State', default: false },
  { key: 'cost', label: 'Cost', default: false },
  { key: 'profit', label: 'Profit', default: false },
  { key: 'converted', label: 'Converted', default: false },
  { key: 'missedCall', label: 'Missed', default: false },
  { key: 'isDuplicate', label: 'Duplicate', default: false },
  { key: 'blocked', label: 'Blocked', default: false },
  { key: 'paidOut', label: 'Paid Out', default: false },
  { key: 'targetGroupName', label: 'Target Group', default: false },
  { key: 'noPayoutReason', label: 'No Payout Reason', default: false },
  { key: 'noConversionReason', label: 'No Conversion Reason', default: false },
  { key: 'blockReason', label: 'Block Reason', default: false },
] as const;

type ColumnKey = (typeof ALL_COLUMNS)[number]['key'];

interface CallRecord {
  id: string;
  callSid?: string;
  createdAt: string;
  status: string;
  direction?: string;
  duration?: number;
  connectedDuration?: number;
  campaignName?: string;
  buyerName?: string;
  publisherName?: string;
  targetName?: string;
  targetGroupName?: string;
  callerId?: string;
  callerIdAreaCode?: number;
  callerIdState?: string;
  did?: string;
  toNumber?: string;
  targetNumber?: string;
  revenue?: number | string;
  payout?: number | string;
  cost?: number | string;
  profit?: number | string;
  recordingUrl?: string;
  converted?: boolean;
  missedCall?: boolean;
  isDuplicate?: boolean;
  blocked?: boolean;
  paidOut?: boolean;
  noPayoutReason?: string;
  noConversionReason?: string;
  blockReason?: string;
}

interface CallsApiResponse {
  data: CallRecord[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

interface CallIntelligenceProps {
  filters?: {
    billable?: boolean;
    sold?: boolean;
    campaign?: string;
  };
}

const STORAGE_KEY = 'callIntelligence_visibleColumns';

function getDefaultColumns(): ColumnKey[] {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        // Fall through to default
      }
    }
  }
  return ALL_COLUMNS.filter(c => c.default).map(c => c.key);
}

export function CallIntelligence({ filters }: CallIntelligenceProps) {
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [visibleColumns, setVisibleColumns] = useState<ColumnKey[]>(getDefaultColumns);
  const [columnPickerOpen, setColumnPickerOpen] = useState(false);

  // Audio player state
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const fetchCalls = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '15',
      });

      if (filters?.campaign) {
        params.set('campaignId', filters.campaign);
      }

      const response = await apiClient.get<CallsApiResponse>(`/api/v1/calls?${params.toString()}`);

      if (response.error) {
        throw new Error(response.error.message);
      }

      let apiCalls = response.data?.data || [];
      const meta = response.data?.meta;

      // Apply local filters
      if (filters?.billable !== undefined) {
        apiCalls = apiCalls.filter(c => c.paidOut === filters.billable);
      }
      if (filters?.sold !== undefined) {
        apiCalls = apiCalls.filter(c => c.converted === filters.sold);
      }
      if (search) {
        const s = search.toLowerCase();
        apiCalls = apiCalls.filter(
          c =>
            c.id.toLowerCase().includes(s) ||
            c.campaignName?.toLowerCase().includes(s) ||
            c.callerId?.includes(s) ||
            c.buyerName?.toLowerCase().includes(s) ||
            c.publisherName?.toLowerCase().includes(s)
        );
      }

      setCalls(apiCalls);
      setTotalPages(meta?.totalPages || 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch calls');
      setCalls([]);
    } finally {
      setLoading(false);
    }
  }, [page, filters, search]);

  useEffect(() => {
    void fetchCalls();
  }, [fetchCalls]);

  // Save column preferences to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(visibleColumns));
  }, [visibleColumns]);

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '-';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatCurrency = (value?: number | string) => {
    if (value === undefined || value === null) return '-';
    const num = typeof value === 'string' ? parseFloat(value) : value;
    if (isNaN(num)) return '-';
    return `$${num.toFixed(2)}`;
  };

  const handlePlay = (call: CallRecord) => {
    if (!call.recordingUrl) return;

    if (playingId === call.id) {
      audioRef.current?.pause();
      setPlayingId(null);
    } else {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      audioRef.current = new Audio(call.recordingUrl);
      void audioRef.current.play();
      audioRef.current.onended = () => setPlayingId(null);
      setPlayingId(call.id);
    }
  };

  const toggleColumn = (key: ColumnKey) => {
    setVisibleColumns(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]));
  };

  const renderCellValue = (call: CallRecord, columnKey: ColumnKey) => {
    switch (columnKey) {
      case 'createdAt':
        return formatDate(call.createdAt);
      case 'connectedDuration':
        return formatDuration(call.connectedDuration);
      case 'duration':
        return formatDuration(call.duration);
      case 'revenue':
        return formatCurrency(call.revenue);
      case 'payout':
        return formatCurrency(call.payout);
      case 'cost':
        return formatCurrency(call.cost);
      case 'profit':
        return formatCurrency(call.profit);
      case 'recordingUrl':
        return call.recordingUrl ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => handlePlay(call)}
            title={playingId === call.id ? 'Pause' : 'Play'}
          >
            {playingId === call.id ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
        ) : (
          <span className="text-muted-foreground">-</span>
        );
      case 'converted':
      case 'missedCall':
      case 'isDuplicate':
      case 'blocked':
      case 'paidOut': {
        const boolVal = call[columnKey];
        return boolVal ? (
          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600">
            Yes
          </Badge>
        ) : (
          <span className="text-muted-foreground">No</span>
        );
      }
      case 'status':
        return (
          <Badge variant="outline" className="capitalize">
            {call.status?.toLowerCase()}
          </Badge>
        );
      case 'direction':
        return (
          <Badge variant="outline" className="capitalize">
            {call.direction?.toLowerCase() || '-'}
          </Badge>
        );
      default: {
        const value = call[columnKey as keyof CallRecord];
        return value ?? '-';
      }
    }
  };

  return (
    <Card className="col-span-full">
      <CardHeader className="flex flex-row items-center justify-between pb-4">
        <CardTitle className="text-base font-semibold">Call Intelligence</CardTitle>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search calls..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-9 w-[200px] pl-9"
            />
          </div>

          {/* Column Picker */}
          <Dialog open={columnPickerOpen} onOpenChange={setColumnPickerOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="h-9">
                <Settings className="mr-2 h-4 w-4" />
                Columns
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Select Columns</DialogTitle>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-3 py-4">
                {ALL_COLUMNS.map(column => (
                  <label
                    key={column.key}
                    className="flex items-center gap-2 cursor-pointer hover:bg-muted/50 p-2 rounded-md"
                  >
                    <Checkbox
                      checked={visibleColumns.includes(column.key)}
                      onCheckedChange={() => toggleColumn(column.key)}
                    />
                    <span className="text-sm">{column.label}</span>
                  </label>
                ))}
              </div>
              <div className="flex justify-between pt-4 border-t">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setVisibleColumns(ALL_COLUMNS.filter(c => c.default).map(c => c.key))
                  }
                >
                  Reset to Default
                </Button>
                <Button size="sm" onClick={() => setColumnPickerOpen(false)}>
                  Done
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {error && (
          <div className="mb-4 rounded-lg border border-amber-500/20 bg-amber-500/10 p-2 text-xs text-amber-600">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex h-[300px] items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : calls.length === 0 ? (
          <div className="flex h-[300px] items-center justify-center text-muted-foreground">
            No calls found
          </div>
        ) : (
          <>
            <div className="rounded-lg border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    {ALL_COLUMNS.filter(c => visibleColumns.includes(c.key)).map(column => (
                      <TableHead key={column.key} className="whitespace-nowrap">
                        {column.label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {calls.map(call => (
                    <TableRow
                      key={call.id}
                      className={cn(
                        'group',
                        call.missedCall && 'bg-red-100 dark:bg-red-950/30',
                        call.converted && !call.missedCall && 'bg-green-100 dark:bg-green-950/30'
                      )}
                    >
                      {ALL_COLUMNS.filter(c => visibleColumns.includes(c.key)).map(column => (
                        <TableCell key={column.key} className="whitespace-nowrap">
                          {renderCellValue(call, column.key)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between pt-4">
              <span className="text-sm text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
