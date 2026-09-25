'use client';

import {
  Download,
  Loader2,
  Play,
  Pause,
  Volume2,
  Clock,
  Activity,
  History,
  ArrowRightLeft,
  X,
  SlidersHorizontal,
} from 'lucide-react';
import { useCallback, useEffect, useState, useRef } from 'react';

import { RedispositionPanel } from '@/components/calls/redisposition-panel';
import {
  EmptyState,
  Notice,
  Panel,
  PanelBody,
  Toolbar,
  ToolbarActions,
  ToolbarClear,
  ToolbarSearch,
  toolbarTrigger,
} from '@/components/domain';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { Tooltip } from '@/components/ui/tooltip';
import { toast } from '@/components/ui/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { apiClient, isNoActingTenant } from '@/lib/api';
import { resolveVisibleColumns } from '@/lib/call-column-visibility';
import { DISPOSITION_LABELS } from '@/lib/call-dispositions';
import { formatFullDateTime, formatTableDateTime } from '@/lib/format-time';
import { cn, formatDuration, formatPhoneNumber } from '@/lib/utils';

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
  /**
   * The agent who ANSWERED the call, resolved server-side.
   *
   * Not `createdBy`, which is whoever caused the row to exist -- an importer,
   * a click-to-dial, a disposition save -- and is null on the inbound calls
   * that make up the floor's day. `agentName` null means unattributed, which
   * is a statement about what was recorded and is rendered as its own thing.
   */
  answeredByUserId?: string | null;
  agentName?: string | null;
}

interface CallDetail extends CallRecord {
  /** Whether a submitted, non-voided application is already on this call. */
  hasSubmittedApplication?: boolean;
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
  /*
   * Why an empty ledger is not allowed to be the default answer.
   *
   * `apiClient.get()` NEVER THROWS. It returns `{ data }` or `{ error }` -- see
   * lib/api.ts. This page was written as
   *
   *     try { const r = await apiClient.get(...); if (r.data) setCalls(...) }
   *     catch { toast.error('Failed to fetch call logs') }
   *
   * and that catch has therefore never once fired. Every failure of
   * /api/v1/calls -- 409 NO_ACTING_TENANT from the cross-agency view, a 500, a
   * gateway timeout while the route reconciles stale recordings, a dropped
   * connection -- fell through the `if (r.data)` and left `calls` at its
   * initial []. The table then rendered "No call events found": a confident,
   * silent, WRONG statement that an agency with months of traffic has no calls,
   * with no error, no toast and nothing in the UI to distinguish it from an
   * empty ledger.
   *
   * So the response envelope is kept. Nothing here may claim there are no calls
   * unless the server actually said so.
   */
  const [loadError, setLoadError] = useState<{ code: string; message: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Filter parameters
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [publishers, setPublishers] = useState<any[]>([]);
  const [buyers, setBuyers] = useState<any[]>([]);
  const [leadLists, setLeadLists] = useState<any[]>([]);

  const [selectedCampaignId, setSelectedCampaignId] = useState<string>('all');
  const [selectedPublisherId, setSelectedPublisherId] = useState<string>('all');
  const [selectedBuyerId, setSelectedBuyerId] = useState<string>('all');
  const [selectedDisputeStatus, setSelectedDisputeStatus] = useState<string>('all');
  const [selectedListId, setSelectedListId] = useState<string>('all');
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  /*
   * Seeded from the URL so the team report can link straight to one agent's
   * calls, which is the drill-down that screen never had: it showed a closing
   * percentage with no way to read the calls behind it.
   *
   * Read once, at mount, rather than kept in sync with the address bar. The
   * filter is a control the user then drives; re-reading the query on every
   * render would fight them for it, snapping the dropdown back to whatever the
   * link said every time they changed it.
   */
  const [selectedAgentId, setSelectedAgentId] = useState<string>(() => {
    if (typeof window === 'undefined') return 'all';
    return new URLSearchParams(window.location.search).get('agentId') ?? 'all';
  });
  const [selectedDisposition, setSelectedDisposition] = useState<string>(() => {
    if (typeof window === 'undefined') return 'all';
    return new URLSearchParams(window.location.search).get('disposition') ?? 'all';
  });

  /*
   * `?from=` and `?to=` arrive with an agent link so the drill-down lands on
   * the SAME window the report was showing. Without them a principal clicking
   * an agent's seven-day closing percentage would get that agent's calls for
   * all time, and the two screens would disagree about the number the click
   * started from.
   */
  const [datePreset, setDatePreset] = useState<string>(() => {
    if (typeof window === 'undefined') return 'All Time';
    const query = new URLSearchParams(window.location.search);
    return query.get('from') || query.get('to') ? 'Custom' : 'All Time';
  });
  const [fromDate, setFromDate] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('from') ?? '';
  });
  const [toDate, setToDate] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('to') ?? '';
  });

  // Selected Call Detail Drawer
  const [detailCallId, setDetailCallId] = useState<string | null>(null);
  const [detailCall, setDetailCall] = useState<CallDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Audio Playback
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Column Selection and Visibility
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>(() => {
    const defaults: Record<string, boolean> = {
      time: true,
      agentName: true,
      campaignName: true,
      callerId: true,
      duration: true,
      disposition: true,
      status: false,
      recording: true,
      dispositionNotes: true,
      publisherName: false,
      buyerName: false,
      did: false,
      toNumber: false,
      connectedDuration: false,
      billable: false,
      buyerBillableAmount: false,
      publisherPayoutAmount: false,
      cost: false,
      profit: false,
      margin: false,
    };

    if (typeof window === 'undefined') return defaults;

    /*
     * MERGED under the defaults, never returned in place of them -- see
     * `lib/call-column-visibility.ts`, which holds the reasoning and the
     * tests. In short: this used to be `return JSON.parse(stored)`, which
     * hid every column added after a user's last visit, permanently, from
     * exactly the people who use this screen most.
     */
    try {
      return resolveVisibleColumns(localStorage.getItem('hopwhistle_calls_columns'), defaults);
    } catch {
      // Reading localStorage throws outright in some privacy modes.
      return defaults;
    }
  });

  const toggleColumn = (columnId: string) => {
    setVisibleColumns(prev => {
      const updated = { ...prev, [columnId]: !prev[columnId] };
      if (typeof window !== 'undefined') {
        localStorage.setItem('hopwhistle_calls_columns', JSON.stringify(updated));
      }
      return updated;
    });
  };

  const columns = [
    { id: 'time', label: 'Time', canSee: true },
    // Second, beside the time. The two questions asked of any row on this
    // screen are "when" and "who", in that order.
    { id: 'agentName', label: 'Agent', canSee: true },
    { id: 'publisherName', label: 'Publisher', canSee: !!isAdminOrOwner },
    { id: 'buyerName', label: 'Buyer', canSee: !!isAdminOrOwner },
    { id: 'campaignName', label: 'Campaign', canSee: true },
    { id: 'callerId', label: 'Customer Phone', canSee: true },
    { id: 'did', label: 'DID (DNIS)', canSee: !isBuyer },
    { id: 'toNumber', label: 'Destination', canSee: !isPublisher },
    { id: 'duration', label: 'Duration', canSee: true },
    { id: 'connectedDuration', label: 'Connected', canSee: true },
    { id: 'billable', label: 'Billable', canSee: true },
    { id: 'buyerBillableAmount', label: 'Charge', canSee: !isPublisher && !isAgent },
    { id: 'publisherPayoutAmount', label: 'Payout', canSee: !isBuyer && !isAgent },
    { id: 'cost', label: 'Cost', canSee: !!isAdminOrOwner },
    { id: 'profit', label: 'Profit', canSee: !!isAdminOrOwner },
    { id: 'margin', label: 'Margin', canSee: !!isAdminOrOwner },
    { id: 'status', label: 'Status', canSee: true },
    // The canonical outcome, beside the free text about it. The screen showed
    // the notes and not the disposition, which is the one that is countable.
    { id: 'disposition', label: 'Disposition', canSee: true },
    { id: 'dispositionNotes', label: 'Call Notes', canSee: true },
    { id: 'recording', label: 'Recording', canSee: true },
  ];

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

        const listsRes = await apiClient.get<any>('/api/v1/lead-lists');
        if (listsRes.data) {
          const list = Array.isArray(listsRes.data) ? listsRes.data : listsRes.data.data || [];
          setLeadLists(list);
        }

        if (isAdminOrOwner) {
          /*
           * The agent filter's options, from the roster the agency already
           * manages. Principals only: an agent's list is their own calls, so
           * there is nobody for them to pick, and asking would hand them a
           * directory of their colleagues.
           *
           * A roster that will not load leaves the filter out rather than
           * failing the page. The ledger's job is to list calls.
           */
          const rosterRes = await apiClient.get<{
            data: { agents: { id: string; name: string }[] };
          }>('/api/v1/agent-roster');
          if (rosterRes.data?.data?.agents) {
            setAgents(
              rosterRes.data.data.agents.map(agent => ({ id: agent.id, name: agent.name }))
            );
          }

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
      if (selectedAgentId !== 'all') {
        queryParams.append('agentId', selectedAgentId);
      }
      if (selectedDisposition !== 'all') {
        queryParams.append('disposition', selectedDisposition);
      }
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
      if (selectedListId !== 'all') {
        queryParams.append('listId', selectedListId);
      }

      const response = await apiClient.get<{ data: CallRecord[]; meta: { totalPages: number } }>(
        `/api/v1/calls?${queryParams.toString()}`
      );

      if (response.error) {
        // The request was refused or failed. Say so, and keep whatever rows are
        // on screen rather than replacing them with an empty table that reads
        // as "these calls do not exist".
        setLoadError(response.error);
        return;
      }

      setLoadError(null);
      setCalls(response.data?.data || []);
      setTotalPages(response.data?.meta?.totalPages || 1);
    } catch (err) {
      console.error('Failed to fetch call logs', err);
      setLoadError({
        code: 'CLIENT_ERROR',
        message: err instanceof Error ? err.message : 'Failed to fetch call logs',
      });
    } finally {
      setLoading(false);
    }
  }, [
    page,
    search,
    datePreset,
    fromDate,
    toDate,
    selectedAgentId,
    selectedDisposition,
    selectedCampaignId,
    selectedPublisherId,
    selectedBuyerId,
    selectedDisputeStatus,
    selectedListId,
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

      if (selectedAgentId !== 'all') queryParams.append('agentId', selectedAgentId);
      if (selectedDisposition !== 'all') queryParams.append('disposition', selectedDisposition);
      if (selectedCampaignId !== 'all') queryParams.append('campaignId', selectedCampaignId);
      if (selectedPublisherId !== 'all') queryParams.append('publisherId', selectedPublisherId);
      if (selectedBuyerId !== 'all') queryParams.append('buyerId', selectedBuyerId);
      if (selectedDisputeStatus !== 'all')
        queryParams.append('disputeStatus', selectedDisputeStatus);
      if (selectedListId !== 'all') queryParams.append('listId', selectedListId);

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
      // Same envelope, same rule as fetchCalls: apiClient never throws, so a
      // refusal has to be read off the response or the drawer sits on a
      // spinner-turned-blank with nothing said.
      if (res.error) {
        toast.error(res.error.message || 'Failed to retrieve call details');
        return;
      }
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
    if (playingId === recordingId) {
      if (audioRef.current) {
        if (!audioRef.current.paused) {
          audioRef.current.pause();
          setPlayingId(null);
          return;
        } else {
          void audioRef.current.play();
          return;
        }
      }
    }
    setAudioLoading(true);
    try {
      const response = await apiClient.get<{ url: string }>(
        `/api/v1/recordings/${recordingId}/url`
      );
      if (response.error || !response.data?.url) {
        toast.error(response.error?.message || 'Playback failed');
        return;
      }
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
    } catch (err) {
      console.error(err);
      toast.error('Playback failed');
    } finally {
      setAudioLoading(false);
    }
  };

  const handleDownloadRecording = async (recordingId: string, filename?: string) => {
    try {
      const response = await apiClient.get<{ url: string }>(
        `/api/v1/recordings/${recordingId}/url`
      );
      if (response.error || !response.data?.url) {
        toast.error(response.error?.message || 'Download failed');
        return;
      }
      let downloadUrl = response.data.url;
      if (downloadUrl.startsWith('/')) {
        const apiBaseUrl =
          typeof window !== 'undefined'
            ? window.location.origin
            : process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
        downloadUrl = `${apiBaseUrl.replace(/\/$/, '')}${downloadUrl}`;
      }
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.setAttribute('download', filename || `recording-${recordingId}.wav`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success('Download started');
    } catch (err) {
      console.error(err);
      toast.error('Download failed');
    }
  };

  const activeColumnsCount = columns.filter(col => col.canSee && visibleColumns[col.id]).length + 1;

  const isAudioPlayerInDrawer =
    !!detailCallId && playingId === detailCall?.primaryRecordingId && !!audioUrl;

  const audioPlayer = (
    <audio
      ref={audioRef}
      src={audioUrl || undefined}
      className={
        isAudioPlayerInDrawer
          ? 'h-8 flex-1 accent-brand'
          : 'absolute w-0 h-0 opacity-0 pointer-events-none'
      }
      controls={isAudioPlayerInDrawer}
      onEnded={() => setPlayingId(null)}
    />
  );

  const getChargeStatusBadge = (status?: string | null) => {
    const s = status || 'PENDING';
    switch (s.toUpperCase()) {
      case 'CHARGED':
        return (
          <Badge variant="outline" className="bg-live-tint text-live-ink border-live/40">
            Charged
          </Badge>
        );
      case 'NOT_BILLABLE':
        return (
          <Badge variant="outline" className="bg-sunken text-ink-2 border-rule">
            Not Billable
          </Badge>
        );
      case 'PENDING':
      default:
        return (
          <Badge variant="outline" className="bg-ringing-tint text-ringing-ink border-ringing/40">
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
          <Badge variant="outline" className="bg-live-tint text-live-ink border-live/40">
            Paid
          </Badge>
        );
      case 'PAYABLE':
        return (
          <Badge variant="outline" className="bg-money-tint text-money-ink border-money/40">
            Payable
          </Badge>
        );
      case 'NOT_PAYABLE':
        return (
          <Badge variant="outline" className="bg-sunken text-ink-2 border-rule">
            Not Payable
          </Badge>
        );
      case 'PENDING':
      default:
        return (
          <Badge variant="outline" className="bg-ringing-tint text-ringing-ink border-ringing/40">
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
          <Badge variant="outline" className="bg-live-tint text-live-ink border-live/40">
            Disputed - Resolved
          </Badge>
        );
      case 'PENDING':
      case 'UNDER_REVIEW':
        return (
          <Badge variant="outline" className="bg-dropped-tint text-dropped-ink border-dropped/40">
            Disputed - Review
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="bg-dropped-tint text-dropped-ink border-dropped/40">
            {status}
          </Badge>
        );
    }
  };

  /*
   * Search, every filter, then the ledger actions. A set filter is tinted so
   * it is obvious at a glance what the ledger is scoped to.
   *
   * The row wraps rather than squeezing: with eight filters on one line the
   * shared cell rule cut the category names to "Disposi…" and "Campa…". Each
   * trigger is sized to its full label instead, and only a long CHOSEN value
   * (a campaign name) truncates, at 240px.
   */
  const filterTrigger = (active: boolean) =>
    cn(toolbarTrigger(active), 'w-auto max-w-full whitespace-nowrap');
  const filterCell = 'shrink-0 max-w-[240px]';
  const hasActiveFilters =
    search !== '' ||
    selectedDisputeStatus !== 'all' ||
    selectedAgentId !== 'all' ||
    selectedDisposition !== 'all' ||
    selectedCampaignId !== 'all' ||
    selectedListId !== 'all' ||
    selectedPublisherId !== 'all' ||
    selectedBuyerId !== 'all' ||
    datePreset !== 'All Time';
  const clearFilters = () => {
    setSearch('');
    setSelectedDisputeStatus('all');
    setSelectedAgentId('all');
    setSelectedDisposition('all');
    setSelectedCampaignId('all');
    setSelectedListId('all');
    setSelectedPublisherId('all');
    setSelectedBuyerId('all');
    handlePresetChange('All Time');
  };

  return (
    <div className="page-canvas">
      {/* Filter toolbar */}
      <Toolbar className="flex-wrap gap-2 xl:flex-wrap">
        <ToolbarSearch
          value={search}
          onChange={value => {
            setSearch(value);
            setPage(1);
          }}
          placeholder="Search ID, caller, notes…"
        />

        {/* Date preset */}
        <div className={filterCell}>
          <Select value={datePreset} onValueChange={handlePresetChange}>
            <SelectTrigger
              aria-label="Date range"
              className={filterTrigger(datePreset !== 'All Time')}
            >
              <SelectValue>{datePreset === 'All Time' ? 'All time' : undefined}</SelectValue>
            </SelectTrigger>
            <SelectContent>
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
          <div className="flex min-w-full shrink-0 items-center gap-1 sm:min-w-0">
            <Input
              type="date"
              aria-label="From date"
              value={fromDate}
              onChange={e => {
                setFromDate(e.target.value);
                setPage(1);
              }}
              className="h-8 w-full px-2 text-xs sm:w-[128px]"
            />
            <span className="t-meta text-ink-3">–</span>
            <Input
              type="date"
              aria-label="To date"
              value={toDate}
              onChange={e => {
                setToDate(e.target.value);
                setPage(1);
              }}
              className="h-8 w-full px-2 text-xs sm:w-[128px]"
            />
          </div>
        )}

        {/* Disposition Filter */}
        <div className={filterCell}>
          <Select
            value={selectedDisposition}
            onValueChange={val => {
              setSelectedDisposition(val);
              setPage(1);
            }}
          >
            <SelectTrigger
              aria-label="Disposition"
              className={filterTrigger(selectedDisposition !== 'all')}
            >
              <SelectValue>{selectedDisposition === 'all' ? 'Disposition' : undefined}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Dispositions</SelectItem>
              {/*
               * "Not written up" is a filter of its own, not the absence of
               * one: leaving this on "All" means every call. It is the
               * end-of-shift question -- which calls has nobody dispositioned.
               */}
              <SelectItem value="NONE">Not written up</SelectItem>
              {Object.entries(DISPOSITION_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Agent Filter — principals only; an agent's list is already their own */}
        {isAdminOrOwner && agents.length > 0 && (
          <div className={filterCell}>
            <Select
              value={selectedAgentId}
              onValueChange={val => {
                setSelectedAgentId(val);
                setPage(1);
              }}
            >
              <SelectTrigger
                aria-label="Agent"
                className={filterTrigger(selectedAgentId !== 'all')}
              >
                <SelectValue>{selectedAgentId === 'all' ? 'Agent' : undefined}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Agents</SelectItem>
                {agents.map(agent => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agent.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Campaign Filter */}
        <div className={filterCell}>
          <Select
            value={selectedCampaignId}
            onValueChange={val => {
              setSelectedCampaignId(val);
              setPage(1);
            }}
          >
            <SelectTrigger
              aria-label="Campaign"
              className={filterTrigger(selectedCampaignId !== 'all')}
            >
              <SelectValue>{selectedCampaignId === 'all' ? 'Campaign' : undefined}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Campaigns</SelectItem>
              {campaigns.map(c => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Lead List Filter */}
        <div className={filterCell}>
          <Select
            value={selectedListId}
            onValueChange={val => {
              setSelectedListId(val);
              setPage(1);
            }}
          >
            <SelectTrigger
              aria-label="Lead list"
              className={filterTrigger(selectedListId !== 'all')}
            >
              <SelectValue>{selectedListId === 'all' ? 'Lead list' : undefined}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Lead Lists</SelectItem>
              {leadLists.map(l => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Publisher Filter (Admin only) */}
        {isAdminOrOwner && (
          <div className={filterCell}>
            <Select
              value={selectedPublisherId}
              onValueChange={val => {
                setSelectedPublisherId(val);
                setPage(1);
              }}
            >
              <SelectTrigger
                aria-label="Publisher"
                className={filterTrigger(selectedPublisherId !== 'all')}
              >
                <SelectValue>{selectedPublisherId === 'all' ? 'Publisher' : undefined}</SelectValue>
              </SelectTrigger>
              <SelectContent>
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
          <div className={filterCell}>
            <Select
              value={selectedBuyerId}
              onValueChange={val => {
                setSelectedBuyerId(val);
                setPage(1);
              }}
            >
              <SelectTrigger
                aria-label="Buyer"
                className={filterTrigger(selectedBuyerId !== 'all')}
              >
                <SelectValue>{selectedBuyerId === 'all' ? 'Buyer' : undefined}</SelectValue>
              </SelectTrigger>
              <SelectContent>
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

        {/* Dispute filter */}
        <div className={filterCell}>
          <Select
            value={selectedDisputeStatus}
            onValueChange={val => {
              setSelectedDisputeStatus(val);
              setPage(1);
            }}
          >
            <SelectTrigger
              aria-label="Dispute status"
              className={filterTrigger(selectedDisputeStatus !== 'all')}
            >
              <SelectValue>{selectedDisputeStatus === 'all' ? 'Disputes' : undefined}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Disputes</SelectItem>
              <SelectItem value="NONE">No Disputes</SelectItem>
              <SelectItem value="DISPUTED">Disputed (All)</SelectItem>
              <SelectItem value="UNDER_REVIEW">Disputed - Under Review</SelectItem>
              <SelectItem value="RESOLVED">Disputed - Resolved</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Ledger actions, pinned to the right end of the row */}
        <ToolbarActions>
          {hasActiveFilters && <ToolbarClear onClick={clearFilters} />}

          <DropdownMenu>
            <Tooltip content="Columns" align="end">
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label="Configure columns"
                  className="h-8 w-8 p-0"
                >
                  <SlidersHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
            </Tooltip>
            <DropdownMenuContent
              className="bg-surface border-rule text-ink min-w-[200px]"
              align="end"
            >
              <DropdownMenuLabel className="text-ink-3 text-xs">
                Configure Ledger Columns
              </DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-rule" />
              {columns.map(col => {
                if (!col.canSee) return null;
                return (
                  <DropdownMenuCheckboxItem
                    key={col.id}
                    checked={visibleColumns[col.id]}
                    onCheckedChange={() => toggleColumn(col.id)}
                    className="focus:bg-brand-tint focus:text-brand-ink text-xs"
                  >
                    {col.label}
                  </DropdownMenuCheckboxItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          <Tooltip content="Export CSV" align="end">
            <Button
              onClick={handleExportCSV}
              disabled={exporting || calls.length === 0}
              size="sm"
              aria-label="Export CSV"
              className="h-8 gap-1.5 px-2 text-xs 2xl:px-3"
            >
              {exporting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              <span className="hidden 2xl:inline">Export</span>
            </Button>
          </Tooltip>
        </ToolbarActions>
      </Toolbar>

      {/* Main Operations Data Table */}
      <Panel className="min-w-0 overflow-hidden">
        <PanelBody flush>
          <Table>
            <TableHeader>
              <TableRow>
                {visibleColumns.time && <TableHead className="pl-5">Time</TableHead>}
                {visibleColumns.agentName && <TableHead>Agent</TableHead>}
                {visibleColumns.publisherName && isAdminOrOwner && <TableHead>Publisher</TableHead>}
                {visibleColumns.buyerName && isAdminOrOwner && <TableHead>Buyer</TableHead>}
                {visibleColumns.campaignName && <TableHead>Campaign</TableHead>}
                {visibleColumns.callerId && <TableHead>Customer Phone</TableHead>}
                {visibleColumns.did && !isBuyer && <TableHead>DID (DNIS)</TableHead>}
                {visibleColumns.toNumber && !isPublisher && <TableHead>Destination</TableHead>}
                {visibleColumns.duration && <TableHead>Duration</TableHead>}
                {visibleColumns.connectedDuration && <TableHead>Connected</TableHead>}
                {visibleColumns.billable && <TableHead>Billable</TableHead>}
                {/* Financial Fields */}
                {visibleColumns.buyerBillableAmount && !isPublisher && !isAgent && (
                  <TableHead className="text-right">Charge</TableHead>
                )}
                {visibleColumns.publisherPayoutAmount && !isBuyer && !isAgent && (
                  <TableHead className="text-right">Payout</TableHead>
                )}
                {visibleColumns.cost && isAdminOrOwner && (
                  <TableHead className="text-right">Cost</TableHead>
                )}
                {visibleColumns.profit && isAdminOrOwner && (
                  <TableHead className="text-right">Profit</TableHead>
                )}
                {visibleColumns.margin && isAdminOrOwner && (
                  <TableHead className="text-right">Margin</TableHead>
                )}
                {visibleColumns.status && <TableHead className="text-center">Status</TableHead>}{' '}
                {visibleColumns.disposition && <TableHead>Disposition</TableHead>}
                {visibleColumns.dispositionNotes && <TableHead>Call Notes</TableHead>}
                {visibleColumns.recording && (
                  <TableHead className="text-center">Recording</TableHead>
                )}
                <TableHead className="pr-5 text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={activeColumnsCount} className="h-64 text-center text-ink-3">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Loader2 className="h-6 w-6 animate-spin text-brand-ink" />
                      <span className="t-body">Loading pay-per-call ledger...</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : loadError ? (
                /*
                 * The ledger could not be read. This is NOT "no calls" and must
                 * never be shown as if it were: the rows are in the database and
                 * something between this table and them said no.
                 */
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={activeColumnsCount} className="p-5">
                    <Notice
                      tone={isNoActingTenant({ error: loadError }) ? 'info' : 'error'}
                      className="mx-auto max-w-2xl text-left"
                      title={
                        isNoActingTenant({ error: loadError })
                          ? 'Choose an agency to see its calls'
                          : 'Could not load the call ledger'
                      }
                      action={
                        <Button variant="outline" size="sm" onClick={() => void fetchCalls()}>
                          Try again
                        </Button>
                      }
                    >
                      {isNoActingTenant({ error: loadError }) ? (
                        <span className="block">
                          You are in the cross-agency view, which is not scoped to one
                          agency&rsquo;s ledger. Your calls are not lost &mdash; pick an agency in
                          the topbar switcher and they are here. You are still signed in.
                        </span>
                      ) : (
                        <>
                          <span className="block">
                            {loadError.message}
                            {loadError.code ? ` (${loadError.code})` : ''}
                          </span>
                          <span className="t-meta mt-1 block text-ink-3">
                            This does not mean the calls are gone &mdash; the request for them
                            failed.
                          </span>
                        </>
                      )}
                    </Notice>
                  </TableCell>
                </TableRow>
              ) : calls.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={activeColumnsCount} className="p-0">
                    <EmptyState
                      headline="No call events found"
                      body="Every call your agents take is recorded here with its duration, disposition and recording."
                    />
                  </TableCell>
                </TableRow>
              ) : (
                calls.map(call => {
                  const showToDetails = call.toNumber && call.toNumber !== 'Masked';

                  return (
                    <TableRow
                      key={call.id}
                      onClick={() => void handleOpenDetailDrawer(call.id)}
                      className="cursor-pointer"
                    >
                      {visibleColumns.time && (
                        <TableCell className="t-data whitespace-nowrap pl-5 text-ink">
                          {formatTableDateTime(call.createdAt)}
                        </TableCell>
                      )}
                      {visibleColumns.agentName && (
                        <TableCell className="text-xs">
                          {call.agentName ? (
                            <span className="font-medium text-ink">{call.agentName}</span>
                          ) : (
                            /*
                             * Its own reading, not an em dash beside every
                             * other missing value on the row. "Nobody is
                             * recorded as having taken this" is a fact a floor
                             * lead acts on -- it is the call that went to an
                             * empty chair, or the one an agent never wrote up.
                             */
                            <span
                              className="text-ink-3"
                              title="No agent is recorded as having answered this call"
                            >
                              Unattributed
                            </span>
                          )}
                        </TableCell>
                      )}
                      {visibleColumns.publisherName && isAdminOrOwner && (
                        <TableCell className="text-ink-2 font-medium text-xs">
                          {call.publisherName || '—'}
                        </TableCell>
                      )}
                      {visibleColumns.buyerName && isAdminOrOwner && (
                        <TableCell className="text-ink-2 font-medium text-xs">
                          {call.buyerName || '—'}
                        </TableCell>
                      )}
                      {visibleColumns.campaignName && (
                        <TableCell className="text-ink-2 font-semibold text-xs">
                          {call.campaignName || '—'}
                        </TableCell>
                      )}
                      {visibleColumns.callerId && (
                        <TableCell className="t-data whitespace-nowrap text-ink">
                          {(() => {
                            const phone =
                              call.direction?.toLowerCase() === 'outbound'
                                ? call.toNumber
                                : call.callerId;
                            return phone ? formatPhoneNumber(phone) : '—';
                          })()}
                        </TableCell>
                      )}
                      {visibleColumns.did && !isBuyer && (
                        <TableCell className="t-data whitespace-nowrap text-ink-2">
                          {call.did ? formatPhoneNumber(call.did) : '—'}
                        </TableCell>
                      )}
                      {visibleColumns.toNumber && !isPublisher && (
                        <TableCell className="t-data whitespace-nowrap text-ink-2">
                          {showToDetails ? (
                            formatPhoneNumber(call.toNumber || call.targetNumber || '')
                          ) : (
                            <span className="text-ink-3 italic">Masked</span>
                          )}
                        </TableCell>
                      )}
                      {visibleColumns.duration && (
                        <TableCell className="t-num text-ink-2">
                          {call.duration ? formatDuration(call.duration) : '—'}
                        </TableCell>
                      )}
                      {visibleColumns.connectedDuration && (
                        <TableCell className="t-num text-ink-2">
                          {call.connectedDuration ? formatDuration(call.connectedDuration) : '—'}
                        </TableCell>
                      )}
                      {visibleColumns.billable && (
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              call.billable
                                ? 'bg-live-tint text-live-ink border-live/40'
                                : 'bg-dropped-tint text-dropped-ink border-dropped/40'
                            }
                          >
                            {call.billable ? 'Billable' : 'No'}
                          </Badge>
                        </TableCell>
                      )}
                      {/* Financial Ledger Columns */}
                      {visibleColumns.buyerBillableAmount && !isPublisher && !isAgent && (
                        <TableCell className="t-num text-right font-medium text-ink">
                          {call.buyerBillableAmount !== null &&
                          call.buyerBillableAmount !== undefined
                            ? `$${Number(call.buyerBillableAmount).toFixed(2)}`
                            : '—'}
                        </TableCell>
                      )}
                      {visibleColumns.publisherPayoutAmount && !isBuyer && !isAgent && (
                        <TableCell className="t-num text-right font-medium text-money-ink">
                          {call.publisherPayoutAmount !== null &&
                          call.publisherPayoutAmount !== undefined
                            ? `$${Number(call.publisherPayoutAmount).toFixed(2)}`
                            : '—'}
                        </TableCell>
                      )}
                      {visibleColumns.cost && isAdminOrOwner && (
                        <TableCell className="t-num text-right text-ink-2">
                          {call.cost !== null ? `$${Number(call.cost).toFixed(2)}` : '—'}
                        </TableCell>
                      )}
                      {visibleColumns.profit && isAdminOrOwner && (
                        <TableCell className="t-num text-right font-semibold text-brand-ink">
                          {call.profit !== null ? `$${Number(call.profit).toFixed(2)}` : '—'}
                        </TableCell>
                      )}
                      {visibleColumns.margin && isAdminOrOwner && (
                        <TableCell className="t-num text-right text-ink-2">
                          {call.margin !== null ? `${Number(call.margin).toFixed(1)}%` : '—'}
                        </TableCell>
                      )}
                      {/* Billing and dispute statuses */}
                      {visibleColumns.status && (
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
                      )}
                      {visibleColumns.disposition && (
                        <TableCell className="text-xs">
                          {call.disposition ? (
                            <span className="rounded-control border border-rule bg-sunken px-1.5 py-0.5 font-medium text-ink-2">
                              {DISPOSITION_LABELS[call.disposition] ?? call.disposition}
                            </span>
                          ) : (
                            <span className="text-ink-3" title="Not written up yet">
                              Not set
                            </span>
                          )}
                        </TableCell>
                      )}
                      {visibleColumns.dispositionNotes && (
                        <TableCell
                          className="text-ink-2 text-xs max-w-xs truncate"
                          title={call.dispositionNotes || ''}
                        >
                          {call.dispositionNotes || '—'}
                        </TableCell>
                      )}
                      {/* Recording inline player and download */}
                      {visibleColumns.recording && (
                        <TableCell className="text-center" onClick={e => e.stopPropagation()}>
                          {call.recordingUrl || call.primaryRecordingId ? (
                            <div className="flex items-center justify-center gap-2">
                              <Tooltip content="Play or pause recording">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    void handlePlayRecording(call.primaryRecordingId || call.id)
                                  }
                                  disabled={
                                    audioLoading &&
                                    playingId === (call.primaryRecordingId || call.id)
                                  }
                                  className="h-8 w-8 p-0 rounded-full hover:bg-sunken text-brand-ink hover:text-brand-ink"
                                >
                                  {audioLoading &&
                                  playingId === (call.primaryRecordingId || call.id) ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : playingId === (call.primaryRecordingId || call.id) ? (
                                    <Pause className="h-4 w-4" />
                                  ) : (
                                    <Play className="h-4 w-4" />
                                  )}
                                </Button>
                              </Tooltip>
                              <Tooltip content="Download recording">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    void handleDownloadRecording(
                                      call.primaryRecordingId || call.id,
                                      `call-${call.id}-recording.wav`
                                    )
                                  }
                                  className="h-8 w-8 p-0 rounded-full hover:bg-sunken text-ink-3 hover:text-ink"
                                >
                                  <Download className="h-4 w-4" />
                                </Button>
                              </Tooltip>
                            </div>
                          ) : (
                            <span className="text-ink-3 text-xs italic">—</span>
                          )}
                        </TableCell>
                      )}
                      <TableCell className="whitespace-nowrap pr-5 text-right text-xs font-medium text-brand-ink">
                        Inspect →
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </PanelBody>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-rule px-5 py-3 pr-24">
            <span className="t-meta tabular-nums text-ink-3">
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
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Panel>

      {/* Slide-out Call Detail Drawer Dialog */}
      <Dialog
        open={!!detailCallId}
        onOpenChange={open => {
          if (!open) setDetailCallId(null);
        }}
      >
        <DialogContent className="fixed inset-y-0 right-0 z-50 h-full w-full max-w-2xl border-l border-rule bg-surface p-0 shadow-pop text-ink translate-x-0 translate-y-0 left-auto top-0 bottom-0">
          <div className="h-full flex flex-col overflow-hidden">
            {/* Header */}
            <div className="p-6 border-b border-rule flex items-center justify-between bg-sunken">
              <div>
                <span className="t-label flex items-center gap-1.5 text-brand-ink">
                  <Activity className="w-3.5 h-3.5" />
                  Call Auditor
                </span>
                <DialogHeader>
                  <h2 className="t-title mt-1 text-ink">
                    {detailCall
                      ? `Call Detail: ${detailCall.id.slice(0, 8)}...`
                      : 'Loading Call Details...'}
                  </h2>
                </DialogHeader>
              </div>
              <Tooltip content="Close" align="end">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDetailCallId(null)}
                  className="h-8 w-8 p-0 rounded-full hover:bg-sunken text-ink-3 hover:text-ink"
                >
                  <X className="h-4 w-4" />
                </Button>
              </Tooltip>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-6 min-h-0">
              {detailLoading ? (
                <div className="flex flex-col items-center justify-center h-64 gap-2">
                  <Loader2 className="h-8 w-8 animate-spin text-brand-ink" />
                  <span className="t-body text-ink-3">Retrieving operations ledger...</span>
                </div>
              ) : !detailCall ? (
                <div className="text-center py-12 text-ink-3">
                  Failed to load call audit details.
                </div>
              ) : (
                <Tabs defaultValue="overview" className="w-full h-full flex flex-col">
                  <TabsList className="mb-6 flex-shrink-0">
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="timeline">Timeline</TabsTrigger>
                    <TabsTrigger value="billing">Billing</TabsTrigger>
                    <TabsTrigger value="rtb">Ping/Post</TabsTrigger>
                    <TabsTrigger value="admin">Ledger</TabsTrigger>
                  </TabsList>

                  {/* TAB 1: OVERVIEW */}
                  <TabsContent value="overview" className="space-y-6">
                    {/* Recording Player card */}
                    {detailCall.recordingUrl && (
                      <Card className="rounded-card border-rule bg-surface shadow-none">
                        <CardHeader className="py-3 px-4">
                          <CardTitle className="t-label flex items-center gap-1.5 text-brand-ink">
                            <Volume2 className="h-4 w-4" />
                            Stream Call Recording
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="p-4 pt-0 flex items-center gap-3">
                          <Tooltip content="Play or pause recording">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                void handlePlayRecording(detailCall.primaryRecordingId || '')
                              }
                              disabled={audioLoading}
                              className="h-9 w-9 flex-shrink-0 rounded-full border-none bg-brand-strong p-0 text-white hover:bg-brand-strong-hover hover:text-white"
                            >
                              {audioLoading && playingId === detailCall.primaryRecordingId ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : playingId === detailCall.primaryRecordingId ? (
                                <Pause className="h-4.5 w-4.5" />
                              ) : (
                                <Play className="h-4.5 w-4.5 pl-0.5" />
                              )}
                            </Button>
                          </Tooltip>
                          {isAudioPlayerInDrawer ? (
                            audioPlayer
                          ) : (
                            <div className="h-2 bg-sunken rounded-full flex-1" />
                          )}
                        </CardContent>
                      </Card>
                    )}

                    {/* Metadata grids */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="rounded-card bg-sunken p-3 space-y-1">
                        <span className="t-label block text-ink-3">Caller Number</span>
                        <p className="t-data font-medium text-ink">
                          {detailCall.callerId ? formatPhoneNumber(detailCall.callerId) : '—'}
                        </p>
                      </div>
                      <div className="rounded-card bg-sunken p-3 space-y-1">
                        <span className="t-label block text-ink-3">Destination Number</span>
                        <p className="t-data font-medium text-ink">
                          {detailCall.toNumber && detailCall.toNumber !== 'Masked'
                            ? formatPhoneNumber(detailCall.toNumber)
                            : 'Masked'}
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                      <div className="rounded-card bg-sunken p-3 space-y-0.5">
                        <span className="t-label block text-ink-3">Campaign</span>
                        <p className="truncate text-sm font-medium text-ink">
                          {detailCall.campaignName || '—'}
                        </p>
                      </div>
                      <div className="rounded-card bg-sunken p-3 space-y-0.5">
                        <span className="t-label block text-ink-3">Publisher</span>
                        <p className="truncate text-sm font-medium text-ink">
                          {detailCall.publisherName || '—'}
                        </p>
                      </div>
                      <div className="rounded-card bg-sunken p-3 space-y-0.5">
                        <span className="t-label block text-ink-3">Buyer</span>
                        <p className="truncate text-sm font-medium text-ink">
                          {detailCall.buyerName || '—'}
                        </p>
                      </div>
                    </div>

                    {/* Financial Performance snapshot */}
                    {canSeeFinance && (
                      <div className="space-y-3">
                        <h3 className="t-label text-brand-ink">Financial Summary</h3>
                        <div className="grid grid-cols-3 gap-4">
                          <div className="rounded-card bg-sunken p-3">
                            <span className="t-meta block text-ink-3">Buyer Charge</span>
                            <p className="mt-1 text-lg font-semibold tabular-nums text-ink">
                              {detailCall.buyerBillableAmount !== null
                                ? `$${Number(detailCall.buyerBillableAmount).toFixed(2)}`
                                : '$0.00'}
                            </p>
                          </div>
                          <div className="rounded-card bg-sunken p-3">
                            <span className="t-meta block text-ink-3">Publisher Payout</span>
                            <p className="mt-1 text-lg font-semibold tabular-nums text-money-ink">
                              {detailCall.publisherPayoutAmount !== null
                                ? `$${Number(detailCall.publisherPayoutAmount).toFixed(2)}`
                                : '$0.00'}
                            </p>
                          </div>
                          <div className="rounded-card bg-sunken p-3">
                            <span className="t-meta block text-ink-3">Platform Margin</span>
                            <p className="mt-1 text-lg font-semibold tabular-nums text-brand-ink">
                              {detailCall.margin !== null
                                ? `${Number(detailCall.margin).toFixed(1)}%`
                                : '0.0%'}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Who took it, and how they wrote it up */}
                    <div className="rounded-card bg-sunken p-4 space-y-3">
                      <h4 className="t-label text-ink-3">Agent Notes / Outcome</h4>
                      {/*
                        Writing the call up, from here.

                        Most business closes on a follow-up rather than on the
                        call that produced it, and until this control the ledger
                        rendered the disposition as text with no way to change
                        it -- so a sale made on the second call was never
                        recorded, and business that is never recorded raises
                        what the agency pays per application.
                      */}
                      <RedispositionPanel
                        callId={detailCall.id}
                        currentDisposition={detailCall.disposition ?? null}
                        currentNotes={detailCall.dispositionNotes ?? null}
                        hasSubmittedApplication={detailCall.hasSubmittedApplication === true}
                        onSaved={() => {
                          void handleOpenDetailDrawer(detailCall.id);
                          void fetchCalls();
                        }}
                      />

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <span className="t-meta block text-ink-3">Answered by</span>
                          <p className="mt-0.5 text-sm font-medium text-ink">
                            {detailCall.agentName ?? (
                              <span className="text-ink-3">Unattributed</span>
                            )}
                          </p>
                        </div>
                        <div>
                          <span className="t-meta block text-ink-3">Disposition</span>
                          <p className="mt-0.5 text-sm font-medium text-ink">
                            {detailCall.disposition ? (
                              (DISPOSITION_LABELS[detailCall.disposition] ?? detailCall.disposition)
                            ) : (
                              <span className="text-ink-3">Not written up</span>
                            )}
                          </p>
                        </div>
                      </div>
                      <p className="t-body text-ink-2">
                        {detailCall.dispositionNotes || 'No notes were recorded for this call.'}
                      </p>
                    </div>
                  </TabsContent>

                  {/* TAB 2: TIMELINE */}
                  <TabsContent value="timeline" className="space-y-4">
                    <h3 className="t-label mb-4 text-brand-ink">Call Event Timeline</h3>
                    {detailCall.legs && detailCall.legs.length > 0 ? (
                      <div className="relative border-l border-rule pl-6 ml-2 space-y-6">
                        {detailCall.legs.map((leg, idx) => (
                          <div key={leg.id} className="relative">
                            {/* Point */}
                            <span className="absolute -left-[30px] top-1 h-3.5 w-3.5 rounded-full border border-brand-ink bg-surface flex items-center justify-center">
                              <span className="h-1.5 w-1.5 rounded-full bg-brand-ink" />
                            </span>
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold text-ink">
                                  Leg {idx + 1}: {leg.direction}
                                </span>
                                <Badge
                                  variant="outline"
                                  className="bg-money-tint text-money-ink border-money/40"
                                >
                                  {leg.status}
                                </Badge>
                              </div>
                              <div className="t-meta space-y-0.5 font-mono text-ink-3">
                                {leg.startedAt && (
                                  <p>Initiated: {formatFullDateTime(leg.startedAt)}</p>
                                )}
                                {leg.answeredAt && (
                                  <p>Answered: {formatFullDateTime(leg.answeredAt)}</p>
                                )}
                                {leg.endedAt && <p>Ended: {formatFullDateTime(leg.endedAt)}</p>}
                                {leg.duration && <p>Duration: {leg.duration}s</p>}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-12 text-center text-ink-3 gap-1">
                        <Clock className="w-8 h-8" />
                        <span className="t-meta">Timeline logs unavailable.</span>
                      </div>
                    )}
                  </TabsContent>

                  {/* TAB 3: BILLING */}
                  <TabsContent value="billing" className="space-y-6">
                    <div className="space-y-4">
                      <h3 className="t-label text-brand-ink">Billing Snapshot Rules</h3>
                      <div className="rounded-card bg-sunken p-4 space-y-3 text-xs">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <span className="text-ink-3 font-medium">Billable Threshold</span>
                            <p className="font-bold text-ink mt-0.5">
                              {detailCall.billableDurationThreshold
                                ? `${detailCall.billableDurationThreshold} seconds`
                                : '60 seconds (Default)'}
                            </p>
                          </div>
                          <div>
                            <span className="text-ink-3 font-medium">Billable Result</span>
                            <p className="font-bold text-ink mt-0.5">
                              {detailCall.billable ? 'Billable' : 'Non-Billable'}
                            </p>
                          </div>
                        </div>
                        <Separator className="bg-rule" />
                        <div>
                          <span className="text-ink-3 font-medium">Billing Reason</span>
                          <p className="font-medium text-brand-ink mt-1 font-sans leading-relaxed">
                            {detailCall.billableReason || '—'}
                          </p>
                        </div>
                        {detailCall.noPayoutReason && (
                          <>
                            <Separator className="bg-rule" />
                            <div>
                              <span className="text-dropped-ink font-medium">
                                Payout Denied Reason
                              </span>
                              <p className="mt-0.5 font-medium text-dropped-ink">
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
                        <h3 className="t-label text-brand-ink">Accruals Ledger Entries</h3>
                        {detailCall.accruals && detailCall.accruals.length > 0 ? (
                          <div className="overflow-hidden rounded-card border border-rule">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Type</TableHead>
                                  <TableHead>Description</TableHead>
                                  <TableHead className="text-right">Amount</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {detailCall.accruals.map(acc => (
                                  <TableRow key={acc.id} className="border-rule">
                                    <TableCell className="t-meta font-medium uppercase text-ink">
                                      {acc.type.replace('_', ' ')}
                                    </TableCell>
                                    <TableCell className="t-meta text-ink-2">
                                      {acc.description}
                                    </TableCell>
                                    <TableCell
                                      className={`t-num text-right font-semibold ${acc.type.includes('PAYOUT') ? 'text-money-ink' : 'text-ink'}`}
                                    >
                                      ${Number(acc.amount).toFixed(2)}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        ) : (
                          <p className="text-xs text-ink-3 italic">No accrual records stored.</p>
                        )}
                      </div>
                    )}
                  </TabsContent>

                  {/* TAB 4: PING/POST BIDS */}
                  <TabsContent value="rtb" className="space-y-6">
                    <h3 className="t-label text-brand-ink">Lead Auction Details</h3>
                    {detailCall.pingRequest ? (
                      <div className="space-y-4">
                        <div className="rounded-card bg-sunken p-4 space-y-3 text-xs">
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <span className="text-ink-3 font-medium">Vertical</span>
                              <p className="font-bold text-ink mt-0.5 uppercase">
                                {detailCall.pingRequest.vertical || '—'}
                              </p>
                            </div>
                            <div>
                              <span className="text-ink-3 font-medium">Auction Status</span>
                              <p className="font-bold text-ink mt-0.5 uppercase">
                                {detailCall.pingRequest.status || '—'}
                              </p>
                            </div>
                          </div>
                          <div>
                            <span className="text-ink-3 font-medium">Demographics Payload</span>
                            <pre className="mt-1.5 overflow-x-auto rounded-control border border-rule bg-surface p-2 font-mono text-xs text-ink">
                              {JSON.stringify(detailCall.pingRequest.payload, null, 2)}
                            </pre>
                          </div>
                        </div>

                        {/* Bids list */}
                        <div className="space-y-2">
                          <h4 className="t-label text-ink-3">Auction Bids</h4>
                          {detailCall.pingRequest.bids && detailCall.pingRequest.bids.length > 0 ? (
                            <div className="overflow-hidden rounded-card border border-rule">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Buyer</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead className="text-right">Bid Amount</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {detailCall.pingRequest.bids.map(bid => (
                                    <TableRow key={bid.id} className="border-rule">
                                      <TableCell className="t-meta font-medium text-ink">
                                        {bid.buyer?.name || 'Unknown'}
                                      </TableCell>
                                      <TableCell>
                                        <Badge
                                          variant="outline"
                                          className={
                                            bid.status === 'WON'
                                              ? 'bg-live-tint text-live-ink border-live/40'
                                              : 'bg-sunken text-ink-2 border-rule'
                                          }
                                        >
                                          {bid.status}
                                        </Badge>
                                      </TableCell>
                                      <TableCell className="t-num text-right font-semibold text-ink">
                                        ${Number(bid.amount).toFixed(2)}
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          ) : (
                            <p className="text-xs text-ink-3 italic">
                              No bids recorded in this auction.
                            </p>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-12 text-center text-ink-3 gap-1">
                        <ArrowRightLeft className="w-8 h-8" />
                        <span className="t-meta">
                          Call did not originate from a Ping/Post RTB auction.
                        </span>
                      </div>
                    )}
                  </TabsContent>

                  {/* TAB 5: ADMIN / TRANSACTIONS */}
                  <TabsContent value="admin" className="space-y-6">
                    {/* Disputes note */}
                    <div className="space-y-3">
                      <h3 className="t-label text-brand-ink">Dispute Review</h3>
                      <div className="rounded-card bg-sunken p-4 space-y-2 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="text-ink-3 font-medium">Dispute Status</span>
                          {detailCall.disputeStatus ? (
                            getDisputeBadge(detailCall.disputeStatus)
                          ) : (
                            <span className="text-ink-3 italic">No Active Disputes</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Manual Adjustments log */}
                    <div className="space-y-3">
                      <h3 className="t-label text-brand-ink">Manual adjustments history</h3>
                      {detailCall.buyerTransactions && detailCall.buyerTransactions.length > 0 ? (
                        <div className="overflow-hidden rounded-card border border-rule">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Date</TableHead>
                                <TableHead>Type</TableHead>
                                <TableHead>Description</TableHead>
                                <TableHead className="text-right">Amount</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {detailCall.buyerTransactions.map(tx => (
                                <TableRow key={tx.id} className="border-rule">
                                  <TableCell className="t-data whitespace-nowrap text-ink-2">
                                    {formatTableDateTime(tx.createdAt)}
                                  </TableCell>
                                  <TableCell className="t-meta font-medium uppercase text-ink">
                                    {tx.type}
                                  </TableCell>
                                  <TableCell className="t-meta text-ink-2">
                                    {tx.description}
                                  </TableCell>
                                  <TableCell className="t-num text-right font-semibold text-dropped-ink">
                                    -${Number(tx.amount).toFixed(2)}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center py-6 text-center text-ink-3 gap-1">
                          <History className="w-6 h-6" />
                          <span className="t-meta">No manual billing adjustments recorded.</span>
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
      {!isAudioPlayerInDrawer && audioPlayer}
    </div>
  );
}

// Separator helper
function Separator({ className }: { className?: string }) {
  return <div className={`h-px w-full my-2 ${className}`} />;
}
