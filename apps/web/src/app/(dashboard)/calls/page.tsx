'use client';

import {
  Download,
  Loader2,
  Play,
  Pause,
  Search,
  Volume2,
  AlertCircle,
  Clock,
  Activity,
  History,
  ArrowRightLeft,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState, useRef } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { apiClient } from '@/lib/api';
import { formatDuration, formatPhoneNumber } from '@/lib/utils';

interface CallRecord {
  id: string;
  callSid?: string;
  createdAt: string;
  startedAt?: string | null;
  answeredAt?: string | null;
  endedAt?: string | null;
  callerId?: string;
  did?: string;
  toNumber?: string;
  targetNumber?: string;
  publisherId?: string | null;
  publisherName?: string | null;
  buyerId?: string | null;
  buyerName?: string | null;
  campaignId?: string | null;
  campaignName?: string | null;
  targetId?: string | null;
  targetName?: string | null;
  pingRequestId?: string | null;
  buyerBidId?: string | null;
  rtbBidAmount?: number | null;
  duration?: number;
  connectedDuration?: number;
  billable: boolean;
  billableDurationThreshold?: number | null;
  billableReason?: string | null;
  noPayoutReason?: string | null;
  revenue?: number | null;
  buyerBillableAmount?: number | null;
  payout?: number | null;
  publisherPayoutAmount?: number | null;
  cost?: number | null;
  profit?: number | null;
  margin?: number | null;
  billingCalculatedAt?: string | null;
  buyerChargeStatus?: string | null;
  publisherPayoutStatus?: string | null;
  disputeStatus?: string | null;
  recordingStatus?: string | null;
  primaryRecordingId?: string | null;
  recordingUrl?: string | null;
  recordingError?: string | null;
  recordingStartedAt?: string | null;
  recordingCompletedAt?: string | null;
  disposition?: string | null;
  dispositionNotes?: string | null;
  callSource?: string | null;
}

interface CallDetail extends CallRecord {
  legs?: Array<{
    id: string;
    direction: string;
    status: string;
    startedAt?: string | null;
    answeredAt?: string | null;
    endedAt?: string | null;
    duration?: number;
  }>;
  cdrs?: Array<{
    id: string;
    startTime: string;
    endTime: string;
    duration: number;
    hangupCause: string;
  }>;
  accruals?: Array<{
    id: string;
    type: string;
    amount: string | number;
    description: string;
    periodDate: string;
    closed: boolean;
    billingAccount?: { name: string } | null;
  }>;
  buyerTransactions?: Array<{
    id: string;
    type: string;
    amount: string | number;
    description: string;
    createdAt: string;
  }>;
  pingRequest?: {
    id: string;
    vertical?: string;
    requestId?: string;
    payload?: any;
    status?: string;
    createdAt: string;
    bids?: Array<{
      id: string;
      amount: string | number;
      status: string;
      buyer?: { name: string } | null;
    }>;
  } | null;
  transcriptions?: Array<{
    id: string;
    text: string;
    createdAt: string;
  }>;
}

export default function OperationsCallLogsPage() {
  const { user, isAdmin, isOwner } = useAuth();

  const isAgent = user?.roles.includes('AGENT');
  const isFinance = user?.roles.includes('FINANCE');
  const isBuyer = user?.roles.includes('BUYER');
  const isPublisher = user?.roles.includes('PUBLISHER');

  const isAdminOrOwner = isAdmin || isOwner;
  const canSeeFinance = isAdminOrOwner || isFinance;

  // State Management
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Filter parameters
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [publishers, setPublishers] = useState<any[]>([]);
  const [buyers, setBuyers] = useState<any[]>([]);

  const [selectedCampaignId, setSelectedCampaignId] = useState<string>('all');
  const [selectedPublisherId, setSelectedPublisherId] = useState<string>('all');
  const [selectedBuyerId, setSelectedBuyerId] = useState<string>('all');
  const [selectedDisputeStatus, setSelectedDisputeStatus] = useState<string>('all');

  const [datePreset, setDatePreset] = useState<string>('All Time');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');

  // Selected Call Detail Drawer
  const [detailCallId, setDetailCallId] = useState<string | null>(null);
  const [detailCall, setDetailCall] = useState<CallDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Audio Playback
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Date Calculator Preset helper
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
      case 'Today':
        return { from: startOfDay(now), to: endOfDay(now) };
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
      default:
        return { from: null, to: null };
    }
  };

  const handlePresetChange = (val: string) => {
    setDatePreset(val);
    if (val === 'All Time') {
      setFromDate('');
      setToDate('');
    } else if (val !== 'Custom') {
      const { from, to } = calculatePresetDates(val);
      if (from) {
        setFromDate(from.toISOString().split('T')[0]);
      }
      if (to) {
        setToDate(to.toISOString().split('T')[0]);
      }
    }
    setPage(1);
  };

  // Load select option filters
  useEffect(() => {
    const loadFilters = async () => {
      try {
        const campRes = await apiClient.get<any>('/api/v1/campaigns');
        if (campRes.data) {
          const list = Array.isArray(campRes.data) ? campRes.data : campRes.data.data || [];
          setCampaigns(list);
        }

        if (isAdminOrOwner) {
          const pubRes = await apiClient.get<any>('/api/v1/publishers');
          if (pubRes.data) {
            const list = Array.isArray(pubRes.data)
              ? pubRes.data
              : pubRes.data.publishers || pubRes.data.data || [];
            setPublishers(list);
          }
          const buyRes = await apiClient.get<any>('/api/v1/buyers');
          if (buyRes.data) {
            const list = Array.isArray(buyRes.data)
              ? buyRes.data
              : buyRes.data.buyers || buyRes.data.data || [];
            setBuyers(list);
          }
        }
      } catch (err) {
        console.error('Failed to load selects', err);
      }
    };
    void loadFilters();
  }, [isAdminOrOwner]);

  const fetchCalls = useCallback(async () => {
    setLoading(true);
    try {
      const queryParams = new URLSearchParams({
        page: String(page),
        limit: '20',
      });

      if (search.trim()) {
        queryParams.append('search', search.trim());
      }

      // Add preset dates
      let startIso = '';
      let endIso = '';
      if (datePreset !== 'All Time' && datePreset !== 'Custom') {
        const { from, to } = calculatePresetDates(datePreset);
        if (from) startIso = from.toISOString();
        if (to) endIso = to.toISOString();
      } else if (datePreset === 'Custom') {
        if (fromDate) startIso = new Date(fromDate + 'T00:00:00').toISOString();
        if (toDate) endIso = new Date(toDate + 'T23:59:59.999').toISOString();
      }

      if (startIso) queryParams.append('startDate', startIso);
      if (endIso) queryParams.append('endDate', endIso);

      // Filters
      if (selectedCampaignId !== 'all') {
        queryParams.append('campaignId', selectedCampaignId);
      }
      if (selectedPublisherId !== 'all') {
        queryParams.append('publisherId', selectedPublisherId);
      }
      if (selectedBuyerId !== 'all') {
        queryParams.append('buyerId', selectedBuyerId);
      }
      if (selectedDisputeStatus !== 'all') {
        queryParams.append('disputeStatus', selectedDisputeStatus);
      }

      const response = await apiClient.get<{ data: CallRecord[]; meta: { totalPages: number } }>(
        `/api/v1/calls?${queryParams.toString()}`
      );
      if (response.data) {
        setCalls(response.data.data || []);
        setTotalPages(response.data.meta?.totalPages || 1);
      }
    } catch (err) {
      console.error('Failed to fetch call logs', err);
      toast.error('Failed to fetch call logs');
    } finally {
      setLoading(false);
    }
  }, [
    page,
    search,
    datePreset,
    fromDate,
    toDate,
    selectedCampaignId,
    selectedPublisherId,
    selectedBuyerId,
    selectedDisputeStatus,
  ]);

  useEffect(() => {
    void fetchCalls();
  }, [fetchCalls]);

  const handleExportCSV = async () => {
    setExporting(true);
    try {
      const queryParams = new URLSearchParams();
      if (search.trim()) {
        queryParams.append('search', search.trim());
      }

      let startIso = '';
      let endIso = '';
      if (datePreset !== 'All Time' && datePreset !== 'Custom') {
        const { from, to } = calculatePresetDates(datePreset);
        if (from) startIso = from.toISOString();
        if (to) endIso = to.toISOString();
      } else if (datePreset === 'Custom') {
        if (fromDate) startIso = new Date(fromDate + 'T00:00:00').toISOString();
        if (toDate) endIso = new Date(toDate + 'T23:59:59.999').toISOString();
      }

      if (startIso) queryParams.append('startDate', startIso);
      if (endIso) queryParams.append('endDate', endIso);

      if (selectedCampaignId !== 'all') queryParams.append('campaignId', selectedCampaignId);
      if (selectedPublisherId !== 'all') queryParams.append('publisherId', selectedPublisherId);
      if (selectedBuyerId !== 'all') queryParams.append('buyerId', selectedBuyerId);
      if (selectedDisputeStatus !== 'all')
        queryParams.append('disputeStatus', selectedDisputeStatus);

      const headers: HeadersInit = {};
      const storedToken = localStorage.getItem('token');
      if (storedToken) {
        headers['Authorization'] = `Bearer ${storedToken}`;
      }

      const apiBaseUrl =
        typeof window !== 'undefined'
          ? window.location.origin
          : process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const url = `${apiBaseUrl.replace(/\/$/, '')}/api/v1/calls/export.csv?${queryParams.toString()}`;

      const res = await fetch(url, { method: 'GET', headers });
      if (!res.ok) throw new Error('Export failed');

      const blob = await res.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.setAttribute(
        'download',
        `call-operations-export-${new Date().toISOString().slice(0, 10)}.csv`
      );
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success('CSV Export Ready');
    } catch (err) {
      console.error(err);
      toast.error('Failed to export CSV');
    } finally {
      setExporting(false);
    }
  };

  // Eager load details for drawer
  const handleOpenDetailDrawer = async (callId: string) => {
    setDetailCallId(callId);
    setDetailLoading(true);
    setDetailCall(null);
    try {
      const res = await apiClient.get<CallDetail>(`/api/v1/calls/${callId}`);
      if (res.data) {
        setDetailCall(res.data);
      }
    } catch (err) {
      console.error('Failed to fetch call details:', err);
      toast.error('Failed to retrieve call details');
    } finally {
      setDetailLoading(false);
    }
  };

  const handlePlayRecording = async (recordingId: string) => {
    setAudioLoading(true);
    try {
      const response = await apiClient.get<{ url: string }>(
        `/api/v1/recordings/${recordingId}/url`
      );
      if (response.data?.url) {
        let playableUrl = response.data.url;
        if (playableUrl.startsWith('/')) {
          const apiBaseUrl =
            typeof window !== 'undefined'
              ? window.location.origin
              : process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
          playableUrl = `${apiBaseUrl.replace(/\/$/, '')}${playableUrl}`;
        }
        setAudioUrl(playableUrl);
        setPlayingId(recordingId);
        setTimeout(() => {
          if (audioRef.current) {
            audioRef.current.load();
            void audioRef.current.play();
          }
        }, 50);
      }
    } catch (err) {
      console.error(err);
      toast.error('Playback failed');
    } finally {
      setAudioLoading(false);
    }
  };

  const getChargeStatusBadge = (status?: string | null) => {
    const s = status || 'PENDING';
    switch (s.toUpperCase()) {
      case 'CHARGED':
        return (
          <Badge
            variant="outline"
            className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
          >
            Charged
          </Badge>
        );
      case 'NOT_BILLABLE':
        return (
          <Badge variant="outline" className="bg-slate-500/15 text-gray-500 border-slate-500/30">
            Not Billable
          </Badge>
        );
      case 'PENDING':
      default:
        return (
          <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/30">
            Pending
          </Badge>
        );
    }
  };

  const getPayoutStatusBadge = (status?: string | null) => {
    const s = status || 'PENDING';
    switch (s.toUpperCase()) {
      case 'PAID':
        return (
          <Badge
            variant="outline"
            className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
          >
            Paid
          </Badge>
        );
      case 'PAYABLE':
        return (
          <Badge variant="outline" className="bg-cyan-500/10 text-cyan-400 border-cyan-500/30">
            Payable
          </Badge>
        );
      case 'NOT_PAYABLE':
        return (
          <Badge variant="outline" className="bg-slate-500/15 text-gray-500 border-slate-500/30">
            Not Payable
          </Badge>
        );
      case 'PENDING':
      default:
        return (
          <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/30">
            Pending
          </Badge>
        );
    }
  };

  const getDisputeBadge = (status?: string | null) => {
    if (!status) return null;
    switch (status.toUpperCase()) {
      case 'RESOLVED':
        return (
          <Badge
            variant="outline"
            className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
          >
            Disputed - Resolved
          </Badge>
        );
      case 'PENDING':
      case 'UNDER_REVIEW':
        return (
          <Badge
            variant="outline"
            className="bg-rose-500/10 text-rose-400 border-rose-500/30 animate-pulse"
          >
            Disputed - Review
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="bg-rose-500/10 text-rose-400 border-rose-500/30">
            {status}
          </Badge>
        );
    }
  };

  return (
    <div className="space-y-6 p-6 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white flex items-center gap-2">
            <Activity className="h-8 w-8 text-cyan-400" />
            Operations Console
          </h1>
          <p className="text-sm text-gray-400">
            Real-time pay-per-call transaction ledger, carrier thresholds, and disputes center.
          </p>
        </div>
        <Button
          onClick={handleExportCSV}
          disabled={exporting || calls.length === 0}
          className="bg-cyan-600 hover:bg-cyan-500 text-white font-medium gap-2 self-start md:self-auto shadow-lg"
        >
          {exporting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          Export CSV Ledger
        </Button>
      </div>

      {/* Filter Panel */}
      <Card className="bg-white/5 border-white/10 backdrop-blur-xl">
        <CardContent className="p-4 grid grid-cols-1 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {/* Search Box */}
          <div className="relative col-span-1 md:col-span-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search ID / Caller / Notes..."
              value={search}
              onChange={e => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="pl-9 bg-white/5 border-white/10 text-white placeholder-gray-500 focus:border-cyan-500"
            />
          </div>

          {/* Dispute filter */}
          <div>
            <Select
              value={selectedDisputeStatus}
              onValueChange={val => {
                setSelectedDisputeStatus(val);
                setPage(1);
              }}
            >
              <SelectTrigger className="bg-white/5 border-white/10 text-white">
                <SelectValue placeholder="Dispute Status" />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-white/10 text-white">
                <SelectItem value="all">All Disputes</SelectItem>
                <SelectItem value="NONE">No Disputes</SelectItem>
                <SelectItem value="DISPUTED">Disputed (All)</SelectItem>
                <SelectItem value="UNDER_REVIEW">Disputed - Under Review</SelectItem>
                <SelectItem value="RESOLVED">Disputed - Resolved</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Campaign Filter */}
          <div>
            <Select
              value={selectedCampaignId}
              onValueChange={val => {
                setSelectedCampaignId(val);
                setPage(1);
              }}
            >
              <SelectTrigger className="bg-white/5 border-white/10 text-white">
                <SelectValue placeholder="All Campaigns" />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-white/10 text-white">
                <SelectItem value="all">All Campaigns</SelectItem>
                {campaigns.map(c => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Publisher Filter (Admin only) */}
          {isAdminOrOwner && (
            <div>
              <Select
                value={selectedPublisherId}
                onValueChange={val => {
                  setSelectedPublisherId(val);
                  setPage(1);
                }}
              >
                <SelectTrigger className="bg-white/5 border-white/10 text-white">
                  <SelectValue placeholder="All Publishers" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-white/10 text-white">
                  <SelectItem value="all">All Publishers</SelectItem>
                  {publishers.map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Buyer Filter (Admin only) */}
          {isAdminOrOwner && (
            <div>
              <Select
                value={selectedBuyerId}
                onValueChange={val => {
                  setSelectedBuyerId(val);
                  setPage(1);
                }}
              >
                <SelectTrigger className="bg-white/5 border-white/10 text-white">
                  <SelectValue placeholder="All Buyers" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-white/10 text-white">
                  <SelectItem value="all">All Buyers</SelectItem>
                  {buyers.map(b => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Date Picker preset */}
          <div>
            <Select value={datePreset} onValueChange={handlePresetChange}>
              <SelectTrigger className="bg-white/5 border-white/10 text-white">
                <SelectValue placeholder="All Time" />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-white/10 text-white">
                <SelectItem value="All Time">All Time</SelectItem>
                <SelectItem value="Today">Today</SelectItem>
                <SelectItem value="Yesterday">Yesterday</SelectItem>
                <SelectItem value="This Week">This Week</SelectItem>
                <SelectItem value="This Month">This Month</SelectItem>
                <SelectItem value="Last Month">Last Month</SelectItem>
                <SelectItem value="Custom">Custom Range</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Custom Date Inputs */}
          {datePreset === 'Custom' && (
            <div className="flex gap-2 items-center col-span-1 md:col-span-2">
              <Input
                type="date"
                value={fromDate}
                onChange={e => {
                  setFromDate(e.target.value);
                  setPage(1);
                }}
                className="bg-white/5 border-white/10 text-white"
              />
              <span className="text-gray-500 text-xs">to</span>
              <Input
                type="date"
                value={toDate}
                onChange={e => {
                  setToDate(e.target.value);
                  setPage(1);
                }}
                className="bg-white/5 border-white/10 text-white"
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Main Operations Data Table */}
      <Card className="bg-white/5 border-white/10 backdrop-blur-xl">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-white/10 hover:bg-transparent">
                  <TableHead className="text-gray-400 font-medium pl-6">Time</TableHead>
                  {isAdminOrOwner && (
                    <TableHead className="text-gray-400 font-medium">Publisher</TableHead>
                  )}
                  {isAdminOrOwner && (
                    <TableHead className="text-gray-400 font-medium">Buyer</TableHead>
                  )}
                  <TableHead className="text-gray-400 font-medium">Campaign</TableHead>
                  <TableHead className="text-gray-400 font-medium">Caller ID</TableHead>
                  {!isBuyer && (
                    <TableHead className="text-gray-400 font-medium">DID (DNIS)</TableHead>
                  )}
                  {!isPublisher && (
                    <TableHead className="text-gray-400 font-medium">Destination</TableHead>
                  )}
                  <TableHead className="text-gray-400 font-medium">Duration</TableHead>
                  <TableHead className="text-gray-400 font-medium">Connected</TableHead>
                  <TableHead className="text-gray-400 font-medium">Billable</TableHead>
                  {/* Financial Fields */}
                  {!isPublisher && !isAgent && (
                    <TableHead className="text-gray-400 font-medium text-right">Charge</TableHead>
                  )}
                  {!isBuyer && !isAgent && (
                    <TableHead className="text-gray-400 font-medium text-right">Payout</TableHead>
                  )}
                  {isAdminOrOwner && (
                    <TableHead className="text-gray-400 font-medium text-right">Cost</TableHead>
                  )}
                  {isAdminOrOwner && (
                    <TableHead className="text-gray-400 font-medium text-right">Profit</TableHead>
                  )}
                  {isAdminOrOwner && (
                    <TableHead className="text-gray-400 font-medium text-right">Margin</TableHead>
                  )}
                  <TableHead className="text-gray-400 font-medium text-center">Status</TableHead>
                  <TableHead className="text-gray-400 font-medium text-right pr-6">
                    Action
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={17} className="h-64 text-center text-gray-500">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
                        <span>Loading pay-per-call ledger...</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : calls.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={17} className="h-64 text-center text-gray-500">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <AlertCircle className="h-8 w-8 text-gray-600" />
                        <span>No call events found</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  calls.map(call => {
                    const showToDetails = call.toNumber && call.toNumber !== 'Masked';

                    return (
                      <TableRow
                        key={call.id}
                        onClick={() => void handleOpenDetailDrawer(call.id)}
                        className="border-white/5 hover:bg-white/5 transition-colors cursor-pointer"
                      >
                        <TableCell className="pl-6 font-mono text-xs text-white">
                          {new Date(call.createdAt).toLocaleString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </TableCell>
                        {isAdminOrOwner && (
                          <TableCell className="text-gray-300 font-medium text-xs">
                            {call.publisherName || '—'}
                          </TableCell>
                        )}
                        {isAdminOrOwner && (
                          <TableCell className="text-gray-300 font-medium text-xs">
                            {call.buyerName || '—'}
                          </TableCell>
                        )}
                        <TableCell className="text-gray-300 font-semibold text-xs">
                          {call.campaignName || '—'}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-white font-semibold">
                          {call.callerId ? formatPhoneNumber(call.callerId) : '—'}
                        </TableCell>
                        {!isBuyer && (
                          <TableCell className="font-mono text-xs text-gray-400">
                            {call.did ? formatPhoneNumber(call.did) : '—'}
                          </TableCell>
                        )}
                        {!isPublisher && (
                          <TableCell className="font-mono text-xs text-gray-400">
                            {showToDetails ? (
                              formatPhoneNumber(call.toNumber || call.targetNumber || '')
                            ) : (
                              <span className="text-gray-600 italic">Masked</span>
                            )}
                          </TableCell>
                        )}
                        <TableCell className="font-mono text-xs text-gray-300">
                          {call.duration ? formatDuration(call.duration) : '—'}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-gray-300">
                          {call.connectedDuration ? formatDuration(call.connectedDuration) : '—'}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              call.billable
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                            }
                          >
                            {call.billable ? 'Billable' : 'No'}
                          </Badge>
                        </TableCell>
                        {/* Financial Ledger Columns */}
                        {!isPublisher && !isAgent && (
                          <TableCell className="text-right font-mono text-xs font-semibold text-white">
                            {call.buyerBillableAmount !== null &&
                            call.buyerBillableAmount !== undefined
                              ? `$${Number(call.buyerBillableAmount).toFixed(2)}`
                              : '—'}
                          </TableCell>
                        )}
                        {!isBuyer && !isAgent && (
                          <TableCell className="text-right font-mono text-xs font-semibold text-emerald-400">
                            {call.publisherPayoutAmount !== null &&
                            call.publisherPayoutAmount !== undefined
                              ? `$${Number(call.publisherPayoutAmount).toFixed(2)}`
                              : '—'}
                          </TableCell>
                        )}
                        {isAdminOrOwner && (
                          <TableCell className="text-right font-mono text-xs text-gray-400">
                            {call.cost !== null ? `$${Number(call.cost).toFixed(2)}` : '—'}
                          </TableCell>
                        )}
                        {isAdminOrOwner && (
                          <TableCell className="text-right font-mono text-xs font-bold text-cyan-400">
                            {call.profit !== null ? `$${Number(call.profit).toFixed(2)}` : '—'}
                          </TableCell>
                        )}
                        {isAdminOrOwner && (
                          <TableCell className="text-right font-mono text-xs text-gray-400">
                            {call.margin !== null ? `${Number(call.margin).toFixed(1)}%` : '—'}
                          </TableCell>
                        )}
                        {/* Billing and dispute statuses */}
                        <TableCell className="text-center">
                          <div className="flex flex-col gap-1 items-center justify-center">
                            {call.disputeStatus ? (
                              getDisputeBadge(call.disputeStatus)
                            ) : (
                              <div className="flex items-center gap-1">
                                {!isPublisher && getChargeStatusBadge(call.buyerChargeStatus)}
                                {!isBuyer && getPayoutStatusBadge(call.publisherPayoutStatus)}
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right pr-6 font-medium text-cyan-400 hover:text-cyan-300 text-xs">
                          Inspect →
                        </TableCell>
                      </TableRow>
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
                  onClick={e => {
                    e.stopPropagation();
                    setPage(p => Math.max(1, p - 1));
                  }}
                  className="bg-white/5 border-white/10 text-white"
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === totalPages}
                  onClick={e => {
                    e.stopPropagation();
                    setPage(p => Math.min(totalPages, p + 1));
                  }}
                  className="bg-white/5 border-white/10 text-white"
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Slide-out Call Detail Drawer Dialog */}
      <Dialog
        open={!!detailCallId}
        onOpenChange={open => {
          if (!open) setDetailCallId(null);
        }}
      >
        <DialogContent className="fixed inset-y-0 right-0 z-50 h-full w-full max-w-2xl border-l border-white/10 bg-slate-950 p-0 shadow-2xl transition-all duration-300 ease-in-out text-white">
          <div className="h-full flex flex-col overflow-hidden">
            {/* Header */}
            <div className="p-6 border-b border-white/5 flex items-center justify-between bg-slate-900/50">
              <div>
                <span className="text-[10px] text-cyan-400 uppercase tracking-widest font-extrabold flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5" />
                  Call Auditor
                </span>
                <DialogHeader>
                  <h2 className="text-xl font-bold text-white mt-1">
                    {detailCall
                      ? `Call Detail: ${detailCall.id.slice(0, 8)}...`
                      : 'Loading Call Details...'}
                  </h2>
                </DialogHeader>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDetailCallId(null)}
                className="h-8 w-8 p-0 rounded-full hover:bg-white/10 text-gray-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-6 min-h-0">
              {detailLoading ? (
                <div className="flex flex-col items-center justify-center h-64 gap-2">
                  <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
                  <span className="text-sm text-gray-500">Retrieving operations ledger...</span>
                </div>
              ) : !detailCall ? (
                <div className="text-center py-12 text-gray-500">
                  Failed to load call audit details.
                </div>
              ) : (
                <Tabs defaultValue="overview" className="w-full h-full flex flex-col">
                  <TabsList className="bg-white/5 border border-white/10 w-full grid grid-cols-5 p-1 mb-6 flex-shrink-0">
                    <TabsTrigger
                      value="overview"
                      className="text-xs data-[state=active]:bg-cyan-600 data-[state=active]:text-white"
                    >
                      Overview
                    </TabsTrigger>
                    <TabsTrigger
                      value="timeline"
                      className="text-xs data-[state=active]:bg-cyan-600 data-[state=active]:text-white"
                    >
                      Timeline
                    </TabsTrigger>
                    <TabsTrigger
                      value="billing"
                      className="text-xs data-[state=active]:bg-cyan-600 data-[state=active]:text-white"
                    >
                      Billing
                    </TabsTrigger>
                    <TabsTrigger
                      value="rtb"
                      className="text-xs data-[state=active]:bg-cyan-600 data-[state=active]:text-white"
                    >
                      Ping/Post
                    </TabsTrigger>
                    <TabsTrigger
                      value="admin"
                      className="text-xs data-[state=active]:bg-cyan-600 data-[state=active]:text-white"
                    >
                      Ledger
                    </TabsTrigger>
                  </TabsList>

                  {/* TAB 1: OVERVIEW */}
                  <TabsContent value="overview" className="space-y-6">
                    {/* Recording Player card */}
                    {detailCall.recordingUrl && (
                      <Card className="bg-cyan-950/20 border-cyan-500/30">
                        <CardHeader className="py-3 px-4">
                          <CardTitle className="text-xs font-bold text-cyan-400 flex items-center gap-1.5">
                            <Volume2 className="h-4 w-4" />
                            Stream Call Recording
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="p-4 pt-0 flex items-center gap-3">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              void handlePlayRecording(detailCall.primaryRecordingId || '')
                            }
                            disabled={audioLoading}
                            className="bg-cyan-600 hover:bg-cyan-500 text-white font-medium border-none flex-shrink-0 h-9 w-9 p-0 rounded-full"
                          >
                            {audioLoading && playingId === detailCall.primaryRecordingId ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : playingId === detailCall.primaryRecordingId ? (
                              <Pause className="h-4.5 w-4.5" />
                            ) : (
                              <Play className="h-4.5 w-4.5 pl-0.5" />
                            )}
                          </Button>
                          {playingId === detailCall.primaryRecordingId && audioUrl ? (
                            <audio
                              ref={audioRef}
                              src={audioUrl}
                              controls
                              className="h-8 flex-1 accent-cyan-400"
                              onEnded={() => setPlayingId(null)}
                            />
                          ) : (
                            <div className="h-2 bg-white/10 rounded-full flex-1" />
                          )}
                        </CardContent>
                      </Card>
                    )}

                    {/* Metadata grids */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-white/5 border border-white/10 rounded-lg p-3 space-y-1">
                        <span className="text-[10px] text-gray-400 uppercase tracking-widest font-bold">
                          Caller Number
                        </span>
                        <p className="font-mono text-sm font-semibold">
                          {detailCall.callerId ? formatPhoneNumber(detailCall.callerId) : '—'}
                        </p>
                      </div>
                      <div className="bg-white/5 border border-white/10 rounded-lg p-3 space-y-1">
                        <span className="text-[10px] text-gray-400 uppercase tracking-widest font-bold">
                          Destination Number
                        </span>
                        <p className="font-mono text-sm font-semibold">
                          {detailCall.toNumber && detailCall.toNumber !== 'Masked'
                            ? formatPhoneNumber(detailCall.toNumber)
                            : 'Masked'}
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                      <div className="bg-white/5 border border-white/10 rounded-lg p-3 space-y-0.5">
                        <span className="text-[10px] text-gray-400 uppercase tracking-widest font-bold">
                          Campaign
                        </span>
                        <p className="text-xs font-semibold text-white truncate">
                          {detailCall.campaignName || '—'}
                        </p>
                      </div>
                      <div className="bg-white/5 border border-white/10 rounded-lg p-3 space-y-0.5">
                        <span className="text-[10px] text-gray-400 uppercase tracking-widest font-bold">
                          Publisher
                        </span>
                        <p className="text-xs font-semibold text-white truncate">
                          {detailCall.publisherName || '—'}
                        </p>
                      </div>
                      <div className="bg-white/5 border border-white/10 rounded-lg p-3 space-y-0.5">
                        <span className="text-[10px] text-gray-400 uppercase tracking-widest font-bold">
                          Buyer
                        </span>
                        <p className="text-xs font-semibold text-white truncate">
                          {detailCall.buyerName || '—'}
                        </p>
                      </div>
                    </div>

                    {/* Financial Performance snapshot */}
                    {canSeeFinance && (
                      <div className="space-y-3">
                        <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-widest">
                          Financial Summary
                        </h3>
                        <div className="grid grid-cols-3 gap-4">
                          <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                            <span className="text-[10px] text-gray-400">Buyer Charge</span>
                            <p className="text-lg font-bold font-mono text-white mt-1">
                              {detailCall.buyerBillableAmount !== null
                                ? `$${Number(detailCall.buyerBillableAmount).toFixed(2)}`
                                : '$0.00'}
                            </p>
                          </div>
                          <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                            <span className="text-[10px] text-gray-400">Publisher Payout</span>
                            <p className="text-lg font-bold font-mono text-emerald-400 mt-1">
                              {detailCall.publisherPayoutAmount !== null
                                ? `$${Number(detailCall.publisherPayoutAmount).toFixed(2)}`
                                : '$0.00'}
                            </p>
                          </div>
                          <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                            <span className="text-[10px] text-gray-400">Platform Margin</span>
                            <p className="text-lg font-bold font-mono text-cyan-400 mt-1">
                              {detailCall.margin !== null
                                ? `${Number(detailCall.margin).toFixed(1)}%`
                                : '0.0%'}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Outcome notes */}
                    <div className="bg-white/5 border border-white/10 rounded-lg p-4 space-y-2">
                      <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                        Agent Notes / Outcome
                      </h4>
                      <p className="text-xs text-gray-300 leading-relaxed font-sans">
                        {detailCall.dispositionNotes || 'No notes were recorded for this call.'}
                      </p>
                    </div>
                  </TabsContent>

                  {/* TAB 2: TIMELINE */}
                  <TabsContent value="timeline" className="space-y-4">
                    <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-widest mb-4">
                      Call Event Timeline
                    </h3>
                    {detailCall.legs && detailCall.legs.length > 0 ? (
                      <div className="relative border-l border-white/10 pl-6 ml-2 space-y-6">
                        {detailCall.legs.map((leg, idx) => (
                          <div key={leg.id} className="relative">
                            {/* Point */}
                            <span className="absolute -left-[30px] top-1 h-3.5 w-3.5 rounded-full border border-cyan-400 bg-slate-950 flex items-center justify-center">
                              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
                            </span>
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-xs text-white">
                                  Leg {idx + 1}: {leg.direction}
                                </span>
                                <Badge
                                  variant="outline"
                                  className="bg-cyan-500/10 text-cyan-400 border-cyan-500/30 text-[10px] py-0"
                                >
                                  {leg.status}
                                </Badge>
                              </div>
                              <div className="text-[10px] text-gray-400 font-mono space-y-0.5">
                                {leg.startedAt && (
                                  <p>Initiated: {new Date(leg.startedAt).toLocaleString()}</p>
                                )}
                                {leg.answeredAt && (
                                  <p>Answered: {new Date(leg.answeredAt).toLocaleString()}</p>
                                )}
                                {leg.endedAt && (
                                  <p>Ended: {new Date(leg.endedAt).toLocaleString()}</p>
                                )}
                                {leg.duration && <p>Duration: {leg.duration}s</p>}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-12 text-center text-gray-600 gap-1">
                        <Clock className="w-8 h-8" />
                        <span className="text-xs">Timeline logs unavailable.</span>
                      </div>
                    )}
                  </TabsContent>

                  {/* TAB 3: BILLING */}
                  <TabsContent value="billing" className="space-y-6">
                    <div className="space-y-4">
                      <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-widest">
                        Billing Snapshot Rules
                      </h3>
                      <div className="bg-white/5 border border-white/10 rounded-lg p-4 space-y-3 text-xs">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <span className="text-gray-400 font-medium">Billable Threshold</span>
                            <p className="font-bold text-white mt-0.5">
                              {detailCall.billableDurationThreshold
                                ? `${detailCall.billableDurationThreshold} seconds`
                                : '60 seconds (Default)'}
                            </p>
                          </div>
                          <div>
                            <span className="text-gray-400 font-medium">Billable Result</span>
                            <p className="font-bold text-white mt-0.5">
                              {detailCall.billable ? 'Billable' : 'Non-Billable'}
                            </p>
                          </div>
                        </div>
                        <Separator className="bg-white/5" />
                        <div>
                          <span className="text-gray-400 font-medium">Billing Reason</span>
                          <p className="font-medium text-cyan-400 mt-1 font-sans leading-relaxed">
                            {detailCall.billableReason || '—'}
                          </p>
                        </div>
                        {detailCall.noPayoutReason && (
                          <>
                            <Separator className="bg-white/5" />
                            <div>
                              <span className="text-rose-400 font-medium">
                                Payout Denied Reason
                              </span>
                              <p className="font-medium text-rose-300 mt-0.5 font-mono">
                                {detailCall.noPayoutReason}
                              </p>
                            </div>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Accruals ledger lists (Admin only) */}
                    {isAdminOrOwner && (
                      <div className="space-y-3">
                        <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-widest">
                          Accruals Ledger Entries
                        </h3>
                        {detailCall.accruals && detailCall.accruals.length > 0 ? (
                          <div className="border border-white/10 rounded-lg overflow-hidden">
                            <Table>
                              <TableHeader className="bg-white/5">
                                <TableRow>
                                  <TableHead className="text-gray-400 text-[10px] font-bold">
                                    Type
                                  </TableHead>
                                  <TableHead className="text-gray-400 text-[10px] font-bold">
                                    Description
                                  </TableHead>
                                  <TableHead className="text-gray-400 text-[10px] font-bold text-right">
                                    Amount
                                  </TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {detailCall.accruals.map(acc => (
                                  <TableRow key={acc.id} className="border-white/5">
                                    <TableCell className="font-mono text-[10px] text-white uppercase">
                                      {acc.type.replace('_', ' ')}
                                    </TableCell>
                                    <TableCell className="text-[10px] text-gray-300">
                                      {acc.description}
                                    </TableCell>
                                    <TableCell
                                      className={`text-right font-mono text-[10px] font-bold ${acc.type.includes('PAYOUT') ? 'text-emerald-400' : 'text-white'}`}
                                    >
                                      ${Number(acc.amount).toFixed(2)}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        ) : (
                          <p className="text-xs text-gray-500 italic">No accrual records stored.</p>
                        )}
                      </div>
                    )}
                  </TabsContent>

                  {/* TAB 4: PING/POST BIDS */}
                  <TabsContent value="rtb" className="space-y-6">
                    <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-widest">
                      Lead Auction Details
                    </h3>
                    {detailCall.pingRequest ? (
                      <div className="space-y-4">
                        <div className="bg-white/5 border border-white/10 rounded-lg p-4 space-y-3 text-xs">
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <span className="text-gray-400 font-medium">Vertical</span>
                              <p className="font-bold text-white mt-0.5 uppercase">
                                {detailCall.pingRequest.vertical || '—'}
                              </p>
                            </div>
                            <div>
                              <span className="text-gray-400 font-medium">Auction Status</span>
                              <p className="font-bold text-white mt-0.5 uppercase">
                                {detailCall.pingRequest.status || '—'}
                              </p>
                            </div>
                          </div>
                          <div>
                            <span className="text-gray-400 font-medium">Demographics Payload</span>
                            <pre className="bg-slate-950 border border-white/5 p-2 rounded mt-1.5 font-mono text-[10px] text-cyan-300 overflow-x-auto">
                              {JSON.stringify(detailCall.pingRequest.payload, null, 2)}
                            </pre>
                          </div>
                        </div>

                        {/* Bids list */}
                        <div className="space-y-2">
                          <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                            Auction Bids
                          </h4>
                          {detailCall.pingRequest.bids && detailCall.pingRequest.bids.length > 0 ? (
                            <div className="border border-white/10 rounded-lg overflow-hidden">
                              <Table>
                                <TableHeader className="bg-white/5">
                                  <TableRow>
                                    <TableHead className="text-gray-400 text-[10px] font-bold">
                                      Buyer
                                    </TableHead>
                                    <TableHead className="text-gray-400 text-[10px] font-bold">
                                      Status
                                    </TableHead>
                                    <TableHead className="text-gray-400 text-[10px] font-bold text-right">
                                      Bid Amount
                                    </TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {detailCall.pingRequest.bids.map(bid => (
                                    <TableRow key={bid.id} className="border-white/5">
                                      <TableCell className="text-[10px] font-semibold text-white">
                                        {bid.buyer?.name || 'Unknown'}
                                      </TableCell>
                                      <TableCell>
                                        <Badge
                                          variant="outline"
                                          className={
                                            bid.status === 'WON'
                                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-[9px] py-0'
                                              : 'bg-slate-500/10 text-gray-400 border-slate-500/30 text-[9px] py-0'
                                          }
                                        >
                                          {bid.status}
                                        </Badge>
                                      </TableCell>
                                      <TableCell className="text-right font-mono text-[10px] font-bold text-white">
                                        ${Number(bid.amount).toFixed(2)}
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          ) : (
                            <p className="text-xs text-gray-500 italic">
                              No bids recorded in this auction.
                            </p>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-12 text-center text-gray-600 gap-1">
                        <ArrowRightLeft className="w-8 h-8" />
                        <span className="text-xs">
                          Call did not originate from a Ping/Post RTB auction.
                        </span>
                      </div>
                    )}
                  </TabsContent>

                  {/* TAB 5: ADMIN / TRANSACTIONS */}
                  <TabsContent value="admin" className="space-y-6">
                    {/* Disputes note */}
                    <div className="space-y-3">
                      <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-widest">
                        Dispute Review
                      </h3>
                      <div className="bg-white/5 border border-white/10 rounded-lg p-4 space-y-2 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="text-gray-400 font-medium">Dispute Status</span>
                          {detailCall.disputeStatus ? (
                            getDisputeBadge(detailCall.disputeStatus)
                          ) : (
                            <span className="text-gray-500 italic">No Active Disputes</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Manual Adjustments log */}
                    <div className="space-y-3">
                      <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-widest">
                        Manual adjustments history
                      </h3>
                      {detailCall.buyerTransactions && detailCall.buyerTransactions.length > 0 ? (
                        <div className="border border-white/10 rounded-lg overflow-hidden">
                          <Table>
                            <TableHeader className="bg-white/5">
                              <TableRow>
                                <TableHead className="text-gray-400 text-[10px] font-bold">
                                  Date
                                </TableHead>
                                <TableHead className="text-gray-400 text-[10px] font-bold">
                                  Type
                                </TableHead>
                                <TableHead className="text-gray-400 text-[10px] font-bold">
                                  Description
                                </TableHead>
                                <TableHead className="text-gray-400 text-[10px] font-bold text-right">
                                  Amount
                                </TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {detailCall.buyerTransactions.map(tx => (
                                <TableRow key={tx.id} className="border-white/5">
                                  <TableCell className="font-mono text-[9px] text-gray-400">
                                    {new Date(tx.createdAt).toLocaleDateString()}
                                  </TableCell>
                                  <TableCell className="text-[10px] font-semibold uppercase text-white">
                                    {tx.type}
                                  </TableCell>
                                  <TableCell className="text-[10px] text-gray-300">
                                    {tx.description}
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-[10px] font-bold text-rose-400">
                                    -${Number(tx.amount).toFixed(2)}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center py-6 text-center text-gray-600 gap-1">
                          <History className="w-6 h-6" />
                          <span className="text-xs">No manual billing adjustments recorded.</span>
                        </div>
                      )}
                    </div>
                  </TabsContent>
                </Tabs>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Separator helper
function Separator({ className }: { className?: string }) {
  return <div className={`h-px w-full my-2 ${className}`} />;
}
