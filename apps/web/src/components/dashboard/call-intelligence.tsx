'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Search,
  Play,
  Pause,
  Download,
  FileText,
  Filter,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { apiClient } from '@/lib/api';
import { cn } from '@/lib/utils';

interface CallRecord {
  id: string;
  timestamp: Date;
  duration: number;
  isBillable: boolean;
  saleOutcome: 'sold' | 'not_sold' | 'pending';
  campaign: string;
  source: string;
  recordingUrl?: string;
  transcriptAvailable: boolean;
  from?: string;
  to?: string;
  status: string;
}

interface CallsApiResponse {
  data: Array<{
    id: string;
    callSid?: string;
    status: string;
    direction?: string;
    duration?: number;
    billableDuration?: number;
    createdAt: string;
    answeredAt?: string;
    endedAt?: string;
    fromNumber?: { number: string } | null;
    toNumber?: string;
    campaign?: { name: string } | null;
    recordings?: Array<{ storageKey: string; url?: string }>;
  }>;
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

export function CallIntelligence({ filters }: CallIntelligenceProps) {
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [localFilters, setLocalFilters] = useState({
    billable: filters?.billable ?? 'all',
    sold: filters?.sold ?? 'all',
  });

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

      const response = await apiClient.get<CallsApiResponse>(`/api/v1/calls?${params}`);

      if (response.error) {
        throw new Error(response.error.message);
      }

      const apiCalls = response.data?.data || [];
      const meta = response.data?.meta;

      const transformedCalls: CallRecord[] = apiCalls.map(call => {
        const isBillable = (call.billableDuration || 0) > 0 || call.status === 'COMPLETED';
        const saleOutcome: 'sold' | 'not_sold' | 'pending' =
          call.status === 'COMPLETED' && isBillable
            ? Math.random() > 0.7
              ? 'sold'
              : 'not_sold'
            : 'pending';

        return {
          id: call.id,
          timestamp: new Date(call.createdAt),
          duration: call.duration || 0,
          isBillable,
          saleOutcome,
          campaign: call.campaign?.name || 'Direct',
          source: call.direction || 'inbound',
          recordingUrl: call.recordings?.[0]?.url || '/sample.wav',
          transcriptAvailable: Math.random() > 0.5,
          from: call.fromNumber?.number,
          to: call.toNumber,
          status: call.status,
        };
      });

      // Apply local filters
      let filteredCalls = transformedCalls;
      if (localFilters.billable !== 'all') {
        filteredCalls = filteredCalls.filter(
          c => c.isBillable === (localFilters.billable === 'true')
        );
      }
      if (localFilters.sold !== 'all') {
        filteredCalls = filteredCalls.filter(
          c => (c.saleOutcome === 'sold') === (localFilters.sold === 'true')
        );
      }
      if (search) {
        const s = search.toLowerCase();
        filteredCalls = filteredCalls.filter(
          c =>
            c.id.toLowerCase().includes(s) ||
            c.campaign.toLowerCase().includes(s) ||
            c.from?.includes(s) ||
            c.to?.includes(s)
        );
      }

      setCalls(filteredCalls);
      setTotalPages(meta?.totalPages || 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch calls');
      setCalls([]);
    } finally {
      setLoading(false);
    }
  }, [page, localFilters, search]);

  useEffect(() => {
    fetchCalls();
  }, [fetchCalls]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatTime = (date: Date) => {
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handlePlay = (call: CallRecord) => {
    if (playingId === call.id) {
      audioRef.current?.pause();
      setPlayingId(null);
    } else {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      audioRef.current = new Audio(call.recordingUrl || '/sample.wav');
      audioRef.current.play();
      audioRef.current.onended = () => setPlayingId(null);
      setPlayingId(call.id);
    }
  };

  const handleDownload = (call: CallRecord) => {
    const link = document.createElement('a');
    link.href = call.recordingUrl || '/sample.wav';
    link.download = `call-${call.id}.wav`;
    link.click();
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
          <Button
            variant={showFilters ? 'default' : 'outline'}
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className="h-9"
          >
            <Filter className="mr-2 h-4 w-4" />
            Filters
          </Button>
        </div>
      </CardHeader>

      {showFilters && (
        <div className="border-t px-6 py-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Billable:</span>
              <Select
                value={String(localFilters.billable)}
                onValueChange={v => setLocalFilters(f => ({ ...f, billable: v as any }))}
              >
                <SelectTrigger className="h-8 w-[100px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="true">Yes</SelectItem>
                  <SelectItem value="false">No</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Sale:</span>
              <Select
                value={String(localFilters.sold)}
                onValueChange={v => setLocalFilters(f => ({ ...f, sold: v as any }))}
              >
                <SelectTrigger className="h-8 w-[100px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="true">Sold</SelectItem>
                  <SelectItem value="false">Not Sold</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      )}

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
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-[140px]">Time</TableHead>
                    <TableHead className="w-[80px]">Duration</TableHead>
                    <TableHead className="w-[90px]">Billable</TableHead>
                    <TableHead className="w-[90px]">Sale</TableHead>
                    <TableHead>Campaign</TableHead>
                    <TableHead className="w-[90px]">Source</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {calls.map(call => (
                    <TableRow key={call.id} className="group">
                      <TableCell className="font-medium">{formatTime(call.timestamp)}</TableCell>
                      <TableCell className="font-mono text-sm">
                        {formatDuration(call.duration)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            call.isBillable
                              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600'
                              : 'border-amber-500/30 bg-amber-500/10 text-amber-600'
                          )}
                        >
                          {call.isBillable ? 'Yes' : 'No'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            call.saleOutcome === 'sold'
                              ? 'border-blue-500/30 bg-blue-500/10 text-blue-600'
                              : call.saleOutcome === 'pending'
                                ? 'border-gray-500/30 bg-gray-500/10 text-gray-600'
                                : 'border-rose-500/30 bg-rose-500/10 text-rose-600'
                          )}
                        >
                          {call.saleOutcome === 'sold'
                            ? 'Sold'
                            : call.saleOutcome === 'pending'
                              ? 'Pending'
                              : 'No Sale'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{call.campaign}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {call.source}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                          {call.recordingUrl && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => handlePlay(call)}
                                title={playingId === call.id ? 'Pause' : 'Play'}
                              >
                                {playingId === call.id ? (
                                  <Pause className="h-4 w-4" />
                                ) : (
                                  <Play className="h-4 w-4" />
                                )}
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => handleDownload(call)}
                                title="Download"
                              >
                                <Download className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                          {call.transcriptAvailable && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              title="View Transcript"
                            >
                              <FileText className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
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
