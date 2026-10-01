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
  ListFilter,
} from 'lucide-react';
import { useCallback, useEffect, useState, useRef } from 'react';

import { ReturnRequestedPanel } from '@/components/buyers/return-requested-panel';
import { RedispositionPanel } from '@/components/calls/redisposition-panel';
import {
  EmptyState,
  EntityBadge,
  Notice,
  Panel,
  PanelBody,
  StatusChip,
  Toolbar,
  ToolbarActions,
  ToolbarSearch,
  formatEnumLabel,
  toolbarTrigger,
} from '@/components/domain';
import { PageHeader } from '@/components/layout/page-header';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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
import { useWhiteLabelView } from '@/hooks/use-white-label-view';
import { apiClient, isNoActingTenant } from '@/lib/api';
import { resolveVisibleColumns } from '@/lib/call-column-visibility';
import { DISPOSITION_LABELS } from '@/lib/call-dispositions';
import { formatFullDateTime, formatTableDateTime } from '@/lib/format-time';
import { CLAWED_BACK, CLAWED_BACK_LABEL } from '@/lib/payout-status';
import { cn, formatDuration, formatPhoneNumber } from '@/lib/utils';

import {
  ALL_RETURNS,
  DISPUTE_FILTER_OPTIONS,
  answeredByOf,
  chargeStatusBadge,
  columnRoleOf,
  columnStorageKey,
  defaultVisibleColumns,
  disputeBadge,
  dispositionTone,
  exportFilename,
  localDayKey,
  payoutStatusBadge,
  recordingIdOf,
  returnChip,
  visibleColumnsFor,
  wentToOf,
  type CallColumn,
  type CallColumnId,
  type CallColumnRole,
  type CallsViewer,
  type StatusBadge,
} from './call-columns';

interface CallRecord {
  id: string;
  callSid?: string;
  direction?: string;
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
  /** Stopped by a gate (DNC, a cap) before anybody was offered it. */
  blocked?: boolean;
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
  /** The submitted, non-voided application on this call, if any. List rows only. */
  application?: { id: string; carrier: string } | null;
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
    payload?: unknown;
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

interface NamedOption {
  id: string;
  name: string;
}

// The filter-option routes answer either a bare array or an envelope.
type OptionListBody =
  | NamedOption[]
  | { data?: NamedOption[]; publishers?: NamedOption[]; buyers?: NamedOption[] };

/** The `outcome` filter's values, as `GET /api/v1/calls` reads them. */
/** "Went to": the same four parts as "Where your calls went" on Today. */
const CALL_OUTCOMES = [
  { value: 'AGENTS', label: 'Your agents' },
  { value: 'BUYERS', label: 'Buyers' },
  { value: 'UNANSWERED', label: 'Unanswered' },
  { value: 'BLOCKED', label: 'Blocked' },
] as const;

const PAGE_SIZES = [25, 50, 100] as const;

/** The filtered set's figures, from `meta.totals` (principals only). */
interface CallTotals {
  calls: number;
  billable: number;
  revenue: number;
  payout: number;
  profit: number;
}

/** Whole dollars, for the totals bar. */
function wholeDollars(value: number): string {
  return `${value < 0 ? '−' : ''}$${Math.round(Math.abs(value)).toLocaleString('en-US')}`;
}

export default function OperationsCallLogsPage() {
  const { user, isAdmin, isOwner, isPlatformAdmin, upgrades } = useAuth();
  // Lead lists are the Power Dialer upgrade's; without it the API refuses them.
  const hasPowerDialer = isPlatformAdmin || upgrades.includes('POWER_DIALER');
  // A white-label owner decides returns; the call detail offers it on the call.
  const whiteLabelView = useWhiteLabelView();

  const isAgent = user?.roles.includes('AGENT');
  const isFinance = user?.roles.includes('FINANCE');
  const isBuyer = user?.roles.includes('BUYER');
  const isPublisher = user?.roles.includes('PUBLISHER');

  const isAdminOrOwner = isAdmin || isOwner;
  const canSeeFinance = isAdminOrOwner || isFinance;
  /** An agent's own ledger: no returns, no money, no counterparties. */
  const agentView = !!isAgent && !isAdminOrOwner;

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
  const [pageSize, setPageSize] = useState<number>(50);
  const [total, setTotal] = useState(0);
  const [totals, setTotals] = useState<CallTotals | null>(null);

  // Filter parameters
  const [campaigns, setCampaigns] = useState<NamedOption[]>([]);
  const [publishers, setPublishers] = useState<NamedOption[]>([]);
  const [buyers, setBuyers] = useState<NamedOption[]>([]);
  const [leadLists, setLeadLists] = useState<NamedOption[]>([]);

  const [selectedCampaignId, setSelectedCampaignId] = useState<string>('all');
  const [selectedPublisherId, setSelectedPublisherId] = useState<string>('all');
  const [selectedBuyerId, setSelectedBuyerId] = useState<string>('all');
  const [selectedDisputeStatus, setSelectedDisputeStatus] = useState<string>('all');
  /*
   * Where the call went: to one of the agency's agents, sold to a buyer, or
   * nowhere. The same three parts as "Where your calls went" on Today and
   * Revenue, so a figure there can be opened as a list here with `?outcome=`.
   */
  const [selectedOutcome, setSelectedOutcome] = useState<string>(() => {
    if (typeof window === 'undefined') return 'all';
    const requested = new URLSearchParams(window.location.search).get('outcome');
    return requested && CALL_OUTCOMES.some(o => o.value === requested) ? requested : 'all';
  });
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
  const viewer: CallsViewer = {
    isAgent: !!isAgent,
    isAdminOrOwner: !!isAdminOrOwner,
    isBuyer: !!isBuyer,
    isPublisher: !!isPublisher,
  };
  const columnRole = columnRoleOf(viewer);

  /*
   * The defaults depend on who is looking, and who is looking is not known
   * until the session has loaded -- so the stored choice is read once the role
   * is, and re-read if it changes, rather than once in a state initialiser
   * that would always see a signed-out viewer.
   */
  const [columnState, setColumnState] = useState<{
    role: CallColumnRole;
    visible: Record<string, boolean>;
  } | null>(null);

  useEffect(() => {
    /*
     * MERGED under the defaults, never returned in place of them -- see
     * `lib/call-column-visibility.ts`, which holds the reasoning and the
     * tests. In short: this used to be `return JSON.parse(stored)`, which
     * hid every column added after a user's last visit, permanently, from
     * exactly the people who use this screen most.
     */
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(columnStorageKey(columnRole));
    } catch {
      // Reading localStorage throws outright in some privacy modes.
    }
    setColumnState({
      role: columnRole,
      visible: resolveVisibleColumns(stored, defaultVisibleColumns(columnRole)),
    });
  }, [columnRole]);

  const visibleColumns: Record<string, boolean> =
    columnState?.role === columnRole ? columnState.visible : defaultVisibleColumns(columnRole);

  const toggleColumn = (columnId: CallColumnId) => {
    const updated = { ...visibleColumns, [columnId]: !visibleColumns[columnId] };
    setColumnState({ role: columnRole, visible: updated });
    try {
      localStorage.setItem(columnStorageKey(columnRole), JSON.stringify(updated));
    } catch {
      // Not remembered across visits; still applied for this one.
    }
  };

  /** The columns this viewer may pick from, and the ones they have picked. */
  const columns = visibleColumnsFor(viewer);
  const shownColumns = columns.filter(col => visibleColumns[col.id]);

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
      // The local calendar day the preset names, not its UTC instant's.
      if (from) {
        setFromDate(localDayKey(from));
      }
      if (to) {
        setToDate(localDayKey(to));
      }
    }
    setPage(1);
  };

  /** The range the ledger is showing, as `YYYY-MM-DD` days; empty for an open end. */
  const appliedRange = (): { from: string; to: string } => {
    if (datePreset === 'All Time') return { from: '', to: '' };
    if (datePreset === 'Custom') return { from: fromDate, to: toDate };
    const { from, to } = calculatePresetDates(datePreset);
    return { from: from ? localDayKey(from) : '', to: to ? localDayKey(to) : '' };
  };

  // Load select option filters
  useEffect(() => {
    const loadFilters = async () => {
      try {
        const campRes = await apiClient.get<OptionListBody>('/api/v1/campaigns');
        if (campRes.data) {
          const list = Array.isArray(campRes.data) ? campRes.data : campRes.data.data || [];
          setCampaigns(list);
        }

        if (hasPowerDialer) {
          const listsRes = await apiClient.get<OptionListBody>('/api/v1/lead-lists');
          if (listsRes.data) {
            const list = Array.isArray(listsRes.data) ? listsRes.data : listsRes.data.data || [];
            setLeadLists(list);
          }
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

          const pubRes = await apiClient.get<OptionListBody>('/api/v1/publishers');
          if (pubRes.data) {
            const list = Array.isArray(pubRes.data)
              ? pubRes.data
              : pubRes.data.publishers || pubRes.data.data || [];
            setPublishers(list);
          }
          const buyRes = await apiClient.get<OptionListBody>('/api/v1/buyers');
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
  }, [isAdminOrOwner, hasPowerDialer]);

  const fetchCalls = useCallback(async () => {
    setLoading(true);
    try {
      const queryParams = new URLSearchParams({
        page: String(page),
        limit: String(pageSize),
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
      if (selectedOutcome !== 'all') {
        queryParams.append('outcome', selectedOutcome);
      }
      if (selectedListId !== 'all') {
        queryParams.append('listId', selectedListId);
      }

      const response = await apiClient.get<{
        data: CallRecord[];
        meta: { totalPages: number; total?: number; totals?: CallTotals };
      }>(`/api/v1/calls?${queryParams.toString()}`);

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
      setTotal(response.data?.meta?.total ?? response.data?.data?.length ?? 0);
      setTotals(response.data?.meta?.totals ?? null);
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
    pageSize,
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
    selectedOutcome,
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
      if (selectedOutcome !== 'all') queryParams.append('outcome', selectedOutcome);
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
      link.setAttribute('download', exportFilename(appliedRange()));
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
  /*
   * `refresh` re-reads the call already open -- after a return is decided --
   * without blanking the drawer to a spinner while it does.
   */
  const handleOpenDetailDrawer = async (callId: string, refresh = false) => {
    setDetailCallId(callId);
    if (!refresh) {
      setDetailLoading(true);
      setDetailCall(null);
    }
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

  /*
   * `?call=<id>` opens that call's detail, once, at mount: Payouts links a
   * deducted return straight to the call it came from.
   */
  const openedFromLink = useRef(false);
  useEffect(() => {
    if (openedFromLink.current) return;
    openedFromLink.current = true;
    const requested = new URLSearchParams(window.location.search).get('call');
    if (requested) void handleOpenDetailDrawer(requested);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, at mount
  }, []);

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

  const activeColumnsCount = Math.max(1, shownColumns.length);

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

  /** A billing or return status, as a chip in its status-tone. Nothing for none. */
  const statusChip = (badge: StatusBadge | null) =>
    badge ? (
      <StatusChip
        size="sm"
        value={badge.value}
        tone={badge.tone}
        label={badge.label}
        title={badge.value === CLAWED_BACK ? CLAWED_BACK_LABEL : undefined}
      />
    ) : null;

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
  /** How many of the filters behind the phone's "Filters" button are set. */
  const secondaryFilterCount = [
    selectedAgentId,
    selectedCampaignId,
    selectedListId,
    selectedPublisherId,
    selectedBuyerId,
    selectedDisputeStatus,
  ].filter(value => value !== 'all').length;
  const clearFilters = () => {
    setSearch('');
    setSelectedDisputeStatus('all');
    setSelectedOutcome('all');
    setSelectedAgentId('all');
    setSelectedDisposition('all');
    setSelectedCampaignId('all');
    setSelectedListId('all');
    setSelectedPublisherId('all');
    setSelectedBuyerId('all');
    handlePresetChange('All Time');
  };

  /** Each filter that is set, as a chip under the bar that clears it. */
  const nameOf = (list: { id: string; name: string }[], id: string) =>
    list.find(option => option.id === id)?.name ?? 'Selected';
  const activeChips: Array<{ key: string; label: string; value: string; clear: () => void }> = [];
  const chip = (key: string, label: string, value: string, clear: () => void) =>
    activeChips.push({
      key,
      label,
      value,
      clear: () => {
        clear();
        setPage(1);
      },
    });
  if (search !== '') chip('search', 'Search', search, () => setSearch(''));
  if (datePreset !== 'All Time') {
    chip(
      'date',
      'Date',
      datePreset === 'Custom' ? `${fromDate || 'start'} – ${toDate || 'today'}` : datePreset,
      () => handlePresetChange('All Time')
    );
  }
  if (selectedOutcome !== 'all') {
    chip(
      'wentTo',
      'Went to',
      CALL_OUTCOMES.find(o => o.value === selectedOutcome)?.label ?? selectedOutcome,
      () => setSelectedOutcome('all')
    );
  }
  if (selectedDisposition !== 'all') {
    chip(
      'disposition',
      'Disposition',
      selectedDisposition === 'NONE'
        ? 'Not written up'
        : (DISPOSITION_LABELS[selectedDisposition] ?? selectedDisposition),
      () => setSelectedDisposition('all')
    );
  }
  if (selectedAgentId !== 'all') {
    chip('agent', 'Agent', nameOf(agents, selectedAgentId), () => setSelectedAgentId('all'));
  }
  if (selectedCampaignId !== 'all') {
    chip('campaign', 'Campaign', nameOf(campaigns, selectedCampaignId), () =>
      setSelectedCampaignId('all')
    );
  }
  if (selectedListId !== 'all') {
    chip('list', 'Lead list', nameOf(leadLists, selectedListId), () => setSelectedListId('all'));
  }
  if (selectedPublisherId !== 'all') {
    chip('publisher', 'Publisher', nameOf(publishers, selectedPublisherId), () =>
      setSelectedPublisherId('all')
    );
  }
  if (selectedBuyerId !== 'all') {
    chip('buyer', 'Buyer', nameOf(buyers, selectedBuyerId), () => setSelectedBuyerId('all'));
  }
  if (selectedDisputeStatus !== ALL_RETURNS) {
    chip(
      'returns',
      'Returns',
      DISPUTE_FILTER_OPTIONS.find(o => o.value === selectedDisputeStatus)?.label ??
        selectedDisputeStatus,
      () => setSelectedDisputeStatus(ALL_RETURNS)
    );
  }

  /** The customer's number: who called in, or who was called out to. */
  const callerOf = (call: CallRecord): string | null => {
    const phone = call.direction?.toLowerCase() === 'outbound' ? call.toNumber : call.callerId;
    return phone ? formatPhoneNumber(phone) : null;
  };

  /** Cents in the table; an empty cell is an em dash in ink-3, never blue. */
  const money = (value?: number | null) =>
    value !== null && value !== undefined ? (
      <span className={Number(value) === 0 ? 'text-ink-3' : undefined}>
        {`${Number(value) < 0 ? '−' : ''}$${Math.abs(Number(value)).toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`}
      </span>
    ) : (
      <span className="text-ink-3">—</span>
    );

  /** Each column's cell classes, beside the one list of columns. */
  const cellClass: Record<CallColumnId, string> = {
    time: 't-data whitespace-nowrap text-ink',
    callerId: 't-data whitespace-nowrap text-ink',
    campaignName: 'max-w-[200px] truncate whitespace-nowrap text-ink-2',
    wentTo: 'max-w-[220px] whitespace-nowrap',
    answeredBy: '',
    publisherName: 'whitespace-nowrap text-ink-2',
    buyerName: 'whitespace-nowrap text-ink-2',
    did: 't-data whitespace-nowrap text-ink-2',
    toNumber: 't-data whitespace-nowrap text-ink-2',
    duration: 'text-right tabular-nums text-ink-2',
    connectedDuration: 'text-right tabular-nums text-ink-2',
    disposition: 'whitespace-nowrap',
    application: 'text-xs',
    dispositionNotes: 'text-ink-2 text-xs max-w-xs truncate',
    billable: '',
    revenue: 'text-right tabular-nums text-ink',
    payout: 'text-right tabular-nums text-ink',
    cost: 'text-right tabular-nums text-ink-2',
    profit: 'text-right tabular-nums font-medium text-ink',
    margin: 'text-right tabular-nums text-ink-2',
    status: 'text-center',
    recording: 'text-center',
  };

  const renderCell = (call: CallRecord, col: CallColumn) => {
    switch (col.id) {
      case 'time':
        return formatTableDateTime(call.createdAt);
      case 'callerId':
        return callerOf(call) ?? '—';
      case 'campaignName':
        return call.campaignName || <span className="text-ink-3">—</span>;
      case 'wentTo': {
        const wentTo = wentToOf(call);
        return <EntityBadge kind={wentTo.kind} name={wentTo.name} />;
      }
      case 'answeredBy': {
        const answeredBy = answeredByOf(call);
        if (answeredBy) {
          return (
            <span
              className="font-medium text-ink"
              title={answeredBy.kind === 'buyer' ? 'Sold to this buyer' : undefined}
            >
              {answeredBy.name}
            </span>
          );
        }
        /*
         * Its own reading, not an em dash beside every other missing value on
         * the row. "Nobody is recorded as having taken this" is a fact a floor
         * lead acts on -- it is the call that went to an empty chair, or the
         * one an agent never wrote up.
         */
        return (
          <span
            className="text-ink-3"
            title="No agent or buyer is recorded as having answered this call"
          >
            Unattributed
          </span>
        );
      }
      case 'publisherName':
        return call.publisherName || '—';
      case 'buyerName':
        return call.buyerName || '—';
      case 'did':
        return call.did ? formatPhoneNumber(call.did) : '—';
      case 'toNumber':
        return call.toNumber && call.toNumber !== 'Masked' ? (
          formatPhoneNumber(call.toNumber || call.targetNumber || '')
        ) : (
          <span className="text-ink-3 italic">Masked</span>
        );
      case 'duration':
        return call.duration ? formatDuration(call.duration) : '—';
      case 'connectedDuration':
        return call.connectedDuration ? formatDuration(call.connectedDuration) : '—';
      case 'disposition': {
        // The canonical outcome, always a chip; a return rides beside it.
        const returned = !isAgent ? returnChip(call.disputeStatus) : null;
        return (
          <div className="flex items-center gap-1" data-disposition={call.disposition ?? 'NONE'}>
            {call.disposition ? (
              <StatusChip
                size="sm"
                value={call.disposition}
                tone={dispositionTone(call.disposition)}
                label={DISPOSITION_LABELS[call.disposition] ?? formatEnumLabel(call.disposition)}
              />
            ) : (
              <span
                className="inline-flex h-5 items-center rounded-full border border-rule-strong px-2 text-[11px] font-medium text-ink-3"
                title="Not written up yet"
              >
                Not set
              </span>
            )}
            {returned ? (
              <StatusChip
                size="sm"
                dot={false}
                value={returned.value}
                tone={returned.tone}
                label={returned.label}
                data-return={returned.value}
              />
            ) : null}
          </div>
        );
      }
      case 'application':
        return call.application ? (
          <span className="font-medium text-ink">{call.application.carrier}</span>
        ) : (
          '—'
        );
      case 'dispositionNotes':
        return call.dispositionNotes || '—';
      case 'billable':
        return (
          <StatusChip
            size="sm"
            value={call.billable ? 'BILLABLE' : 'NOT_BILLABLE'}
            tone={call.billable ? 'live' : 'neutral'}
            label={call.billable ? 'Billable' : 'No'}
          />
        );
      case 'revenue':
        return money(call.buyerBillableAmount);
      case 'payout':
        return money(call.publisherPayoutAmount);
      case 'cost':
        return money(call.cost);
      case 'profit':
        return money(call.profit);
      case 'margin':
        return call.margin !== null && call.margin !== undefined
          ? `${Number(call.margin).toFixed(1)}%`
          : '—';
      case 'status':
        // What the buyer was charged and what the publisher is owed. Nothing
        // for a call with neither: a blank is not "Pending".
        return (
          <div className="flex items-center justify-center gap-1">
            {!isPublisher && statusChip(chargeStatusBadge(call.buyerChargeStatus))}
            {!isBuyer && statusChip(payoutStatusBadge(call.publisherPayoutStatus))}
          </div>
        );
      case 'recording': {
        const recordingId = recordingIdOf(call);
        if (!recordingId) {
          return (
            <div className="flex items-center justify-center">
              <Tooltip content="No recording for this call">
                <span tabIndex={0} className="inline-flex rounded-full" data-recording="none">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled
                    aria-label="No recording"
                    className="h-8 w-8 rounded-full p-0 text-ink-3"
                  >
                    <Play className="h-4 w-4" />
                  </Button>
                </span>
              </Tooltip>
            </div>
          );
        }
        return (
          <div className="flex items-center justify-center" data-recording="ready">
            <Tooltip content="Play or pause recording">
              <Button
                variant="ghost"
                size="sm"
                aria-label="Play or pause recording"
                onClick={() => void handlePlayRecording(recordingId)}
                disabled={audioLoading && playingId === recordingId}
                className="h-8 w-8 p-0 rounded-full hover:bg-sunken text-brand-ink hover:text-brand-ink"
              >
                {audioLoading && playingId === recordingId ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : playingId === recordingId ? (
                  <Pause className="h-4 w-4" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
              </Button>
            </Tooltip>
          </div>
        );
      }
      default:
        return null;
    }
  };

  /*
   * The filters past search, date and disposition. Rendered twice from one
   * definition: inline on the toolbar from 640px, and in the Filters sheet
   * below that, where eight selects on a phone would push the calls off the
   * first screen.
   */
  const renderSecondaryFilters = (cell: string) => (
    <>
      {/* Agent Filter — principals only; an agent's list is already their own */}
      {isAdminOrOwner && agents.length > 0 && (
        <div className={cell}>
          <Select
            value={selectedAgentId}
            onValueChange={val => {
              setSelectedAgentId(val);
              setPage(1);
            }}
          >
            <SelectTrigger aria-label="Agent" className={filterTrigger(selectedAgentId !== 'all')}>
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
      <div className={cell}>
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

      {/* Lead List Filter -- the Power Dialer upgrade's lists; without it there are none */}
      {hasPowerDialer && (
        <div className={cell}>
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
      )}

      {/* Publisher Filter (Admin only) */}
      {isAdminOrOwner && (
        <div className={cell}>
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
        <div className={cell}>
          <Select
            value={selectedBuyerId}
            onValueChange={val => {
              setSelectedBuyerId(val);
              setPage(1);
            }}
          >
            <SelectTrigger aria-label="Buyer" className={filterTrigger(selectedBuyerId !== 'all')}>
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

      {/* Returns: whether a buyer asked for the call back, and how it was
          decided. A buyer dispute is the agency's business with its buyer;
          an agent's ledger has no returns to filter by. */}
      {!agentView && (
        <div className={cell}>
          <Select
            value={selectedDisputeStatus}
            onValueChange={val => {
              setSelectedDisputeStatus(val);
              setPage(1);
            }}
          >
            <SelectTrigger
              aria-label="Returns"
              className={filterTrigger(selectedDisputeStatus !== ALL_RETURNS)}
            >
              <SelectValue>
                {selectedDisputeStatus === ALL_RETURNS ? 'Returns' : undefined}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_RETURNS}>All calls</SelectItem>
              {DISPUTE_FILTER_OPTIONS.map(option => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </>
  );

  return (
    <div className="page-canvas">
      <PageHeader
        description={
          // An agent's list is the calls they answered (server-side), and it
          // carries no money and no "went to": say what it is, not the owner's
          // line about where calls went and what they made.
          agentView
            ? 'Every call you handled, with disposition and recording.'
            : 'Every call, where it went, and what it made.'
        }
      />

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

        {/* Went to: the same four parts as "Where your calls went" */}
        {isAdminOrOwner && (
          <div className={filterCell}>
            <Select
              value={selectedOutcome}
              onValueChange={val => {
                setSelectedOutcome(val);
                setPage(1);
              }}
            >
              <SelectTrigger
                aria-label="Went to"
                className={filterTrigger(selectedOutcome !== 'all')}
              >
                <SelectValue>{selectedOutcome === 'all' ? 'Went to' : undefined}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Went anywhere</SelectItem>
                {CALL_OUTCOMES.map(outcome => (
                  <SelectItem key={outcome.value} value={outcome.value}>
                    {outcome.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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

        {/* Every other filter, behind one button at every width */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                'h-8 shrink-0 gap-1.5 px-2.5 text-xs',
                secondaryFilterCount > 0 && 'border-brand-ink bg-brand-tint text-brand-ink'
              )}
            >
              <ListFilter className="h-3.5 w-3.5" />
              More filters{secondaryFilterCount > 0 ? ` (${secondaryFilterCount})` : ''}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[280px] p-3">
            <div className="flex flex-col gap-2" data-more-filters>
              {renderSecondaryFilters('w-full [&_button]:w-full')}
            </div>
          </PopoverContent>
        </Popover>

        {/* Ledger actions, pinned to the right end of the row */}
        <ToolbarActions>
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
              <DropdownMenuLabel className="text-ink-3 text-xs">Columns</DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-rule" />
              {columns.map(col => (
                <DropdownMenuCheckboxItem
                  key={col.id}
                  checked={!!visibleColumns[col.id]}
                  onCheckedChange={() => toggleColumn(col.id)}
                  className="focus:bg-brand-tint focus:text-brand-ink text-xs"
                >
                  {col.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Tooltip content="Export CSV" align="end">
            <Button
              onClick={() => void handleExportCSV()}
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

      {/* What the ledger is scoped to, each removable */}
      {activeChips.length > 0 ? (
        <div className="-mt-3 flex flex-wrap items-center gap-2" aria-label="Active filters">
          {activeChips.map(chip => (
            <span
              key={chip.key}
              className="inline-flex h-7 items-center gap-1 rounded-full border border-rule bg-surface pl-2.5 pr-1 t-meta text-ink"
              data-filter-chip={chip.key}
            >
              <span className="text-ink-2">{chip.label}:</span>
              <span className="max-w-[200px] truncate font-medium">{chip.value}</span>
              <button
                type="button"
                onClick={chip.clear}
                aria-label={`Remove ${chip.label} filter`}
                className="ml-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full text-ink-3 hover:bg-sunken hover:text-ink"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={clearFilters}
            className="t-meta font-medium text-brand-ink hover:underline"
          >
            Clear all
          </button>
        </div>
      ) : null}

      {/* The filtered set, before the page of it */}
      {totals ? (
        <dl
          className="flex flex-wrap items-baseline gap-x-6 gap-y-2 rounded-card border border-rule bg-surface px-5 py-3"
          aria-label="Totals for these filters"
          data-call-totals
        >
          {[
            {
              label: 'Calls',
              value: totals.calls.toLocaleString('en-US'),
              zero: totals.calls === 0,
            },
            {
              label: 'Billable',
              value: totals.billable.toLocaleString('en-US'),
              zero: totals.billable === 0,
            },
            { label: 'Revenue', value: wholeDollars(totals.revenue), zero: totals.revenue === 0 },
            { label: 'Payout', value: wholeDollars(totals.payout), zero: totals.payout === 0 },
            { label: 'Profit', value: wholeDollars(totals.profit), zero: totals.profit === 0 },
          ].map(item => (
            <div key={item.label} className="flex items-baseline gap-2">
              <dt className="t-caption text-ink-2">{item.label}</dt>
              <dd
                className={cn(
                  't-body font-semibold tabular-nums',
                  item.zero ? 'text-ink-3' : 'text-ink'
                )}
                data-total={item.label}
              >
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {/* Main Operations Data Table */}
      <Panel className="min-w-0 overflow-hidden">
        <PanelBody flush>
          <Table>
            <TableHeader>
              <TableRow>
                {shownColumns.map((col, index) => (
                  <TableHead
                    key={col.id}
                    className={cn(
                      col.align === 'right' && 'text-right',
                      col.align === 'center' && 'text-center',
                      index === 0 && 'pl-5',
                      index === shownColumns.length - 1 && 'pr-5'
                    )}
                  >
                    {col.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={activeColumnsCount} className="h-64 text-center text-ink-3">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Loader2 className="h-6 w-6 animate-spin text-brand-ink" />
                      <span className="t-body">Loading calls...</span>
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
                      body={
                        agentView
                          ? 'Every call you take is recorded here with its duration, disposition and recording.'
                          : 'Every call your agents take is recorded here with its duration, disposition and recording.'
                      }
                    />
                  </TableCell>
                </TableRow>
              ) : (
                calls.map(call => (
                  /*
                   * The row is the way into the call: click it, or focus it
                   * and press Enter. Controls inside a cell (the recording
                   * buttons) stop their own clicks from opening it.
                   */
                  <TableRow
                    key={call.id}
                    tabIndex={0}
                    onClick={() => void handleOpenDetailDrawer(call.id)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && e.target === e.currentTarget) {
                        e.preventDefault();
                        void handleOpenDetailDrawer(call.id);
                      }
                    }}
                    className="cursor-pointer focus-visible:bg-sunken focus-visible:outline-none"
                  >
                    {shownColumns.map((col, index) => (
                      <TableCell
                        key={col.id}
                        className={cn(
                          cellClass[col.id],
                          index === 0 && 'pl-5',
                          index === shownColumns.length - 1 && 'pr-5'
                        )}
                        title={
                          col.id === 'dispositionNotes' ? call.dispositionNotes || '' : undefined
                        }
                        onClick={col.id === 'recording' ? e => e.stopPropagation() : undefined}
                      >
                        {renderCell(call, col)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </PanelBody>

        {/* Pagination: rows per page, and where this page sits in the set */}
        {total > 0 && !loadError ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-rule px-5 py-3 pr-24">
            <div className="flex items-center gap-3">
              <span className="t-meta tabular-nums text-ink-2" data-page-range>
                {`${((page - 1) * pageSize + 1).toLocaleString('en-US')}–${Math.min(
                  page * pageSize,
                  total
                ).toLocaleString('en-US')} of ${total.toLocaleString('en-US')}`}
              </span>
              <Select
                value={String(pageSize)}
                onValueChange={value => {
                  setPageSize(Number(value));
                  setPage(1);
                }}
              >
                <SelectTrigger
                  aria-label="Rows per page"
                  className="h-8 w-auto gap-1.5 px-2.5 text-xs"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZES.map(size => (
                    <SelectItem key={size} value={String(size)}>
                      {`${size} rows`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
                disabled={page >= totalPages}
                onClick={e => {
                  e.stopPropagation();
                  setPage(p => Math.min(totalPages, p + 1));
                }}
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </Panel>

      {/* Slide-out Call Detail Drawer Dialog */}
      <Dialog
        open={!!detailCallId}
        onOpenChange={open => {
          if (!open) setDetailCallId(null);
        }}
      >
        <DialogContent
          hideClose
          className="fixed inset-y-0 right-0 z-50 h-full w-full max-w-2xl border-l border-rule bg-surface p-0 shadow-pop text-ink translate-x-0 translate-y-0 left-auto top-0 bottom-0"
        >
          <div className="h-full flex flex-col overflow-hidden">
            {/* Header */}
            <div className="p-6 border-b border-rule flex items-center justify-between bg-sunken">
              <div>
                <span className="t-label flex items-center gap-1.5 text-brand-ink">
                  <Activity className="w-3.5 h-3.5" />
                  Call
                </span>
                <DialogHeader>
                  <h2 className="t-title mt-1 text-ink">
                    {/* Who called, which is how a person finds a call; the id is not. */}
                    {detailCall
                      ? detailCall.callerId
                        ? formatPhoneNumber(detailCall.callerId)
                        : 'Unknown caller'
                      : 'Loading call...'}
                  </h2>
                </DialogHeader>
                {detailCall && !isAgent ? (
                  <div className="mt-2" data-drawer-went-to>
                    <EntityBadge
                      variant="chip"
                      kind={wentToOf(detailCall).kind}
                      name={wentToOf(detailCall).name}
                    />
                  </div>
                ) : null}
              </div>
              <Tooltip content="Close" align="end">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDetailCallId(null)}
                  aria-label="Close"
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
                  <span className="t-body text-ink-3">Loading call...</span>
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
                    {/* Money, and who bought and sold the call, are the principals'. */}
                    {canSeeFinance ? <TabsTrigger value="billing">Money</TabsTrigger> : null}
                    {/* The auction record and the raw ledger are NetEnroll's. */}
                    {isPlatformAdmin ? (
                      <>
                        <TabsTrigger value="rtb">Ping/Post</TabsTrigger>
                        <TabsTrigger value="admin">Ledger</TabsTrigger>
                      </>
                    ) : null}
                  </TabsList>

                  {/* TAB 1: OVERVIEW */}
                  <TabsContent value="overview" className="space-y-6">
                    {whiteLabelView && detailCall.disputeStatus === 'DISPUTED' ? (
                      <ReturnRequestedPanel
                        callId={detailCall.id}
                        onDecided={() => {
                          // The drawer's own copy too, so it stops offering a
                          // decision that has just been made.
                          void handleOpenDetailDrawer(detailCall.id, true);
                          void fetchCalls();
                        }}
                      />
                    ) : null}
                    {/* Recording Player card */}
                    {/* Only a call with a recording of its own; never the call id in its place */}
                    {recordingIdOf(detailCall) && (
                      <Card className="rounded-card border-rule bg-surface shadow-none">
                        <CardHeader className="py-3 px-4">
                          <CardTitle className="t-label flex items-center gap-1.5 text-brand-ink">
                            <Volume2 className="h-4 w-4" />
                            Recording
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="p-4 pt-0 flex items-center gap-3">
                          <Tooltip content="Play or pause recording">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                void handlePlayRecording(recordingIdOf(detailCall) ?? '')
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
                          <Tooltip content="Download recording" align="end">
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label="Download recording"
                              onClick={() =>
                                void handleDownloadRecording(
                                  recordingIdOf(detailCall) ?? '',
                                  `call-${detailCall.id}-recording.wav`
                                )
                              }
                              className="h-9 w-9 flex-shrink-0 rounded-full p-0 text-ink-3 hover:bg-sunken hover:text-ink"
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                          </Tooltip>
                        </CardContent>
                      </Card>
                    )}

                    {/* Metadata grids */}
                    <div className={canSeeFinance ? 'grid grid-cols-2 gap-4' : 'grid gap-4'}>
                      <div className="rounded-card bg-sunken p-3 space-y-1">
                        <span className="t-label block text-ink-3">Caller Number</span>
                        <p className="t-data font-medium text-ink">
                          {detailCall.callerId ? formatPhoneNumber(detailCall.callerId) : '—'}
                        </p>
                      </div>
                      {canSeeFinance && (
                        <div className="rounded-card bg-sunken p-3 space-y-1">
                          <span className="t-label block text-ink-3">Destination Number</span>
                          <p className="t-data font-medium text-ink">
                            {detailCall.toNumber && detailCall.toNumber !== 'Masked'
                              ? formatPhoneNumber(detailCall.toNumber)
                              : 'Masked'}
                          </p>
                        </div>
                      )}
                    </div>

                    <div className={canSeeFinance ? 'grid grid-cols-3 gap-4' : 'grid gap-4'}>
                      <div className="rounded-card bg-sunken p-3 space-y-0.5">
                        <span className="t-label block text-ink-3">Campaign</span>
                        <p className="truncate text-sm font-medium text-ink">
                          {detailCall.campaignName || '—'}
                        </p>
                      </div>
                      {canSeeFinance && (
                        <>
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
                        </>
                      )}
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
                            <span className="t-meta block text-ink-3">Margin</span>
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

                      {/* The disposition and notes are the panel's own fields above. */}
                      <div>
                        <span className="t-meta block text-ink-3">Answered by</span>
                        <p className="mt-0.5 text-sm font-medium text-ink">
                          {detailCall.agentName ?? <span className="text-ink-3">Unattributed</span>}
                        </p>
                      </div>
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
                                {leg.duration != null && <p>Duration: {leg.duration}s</p>}
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

                  {/* TAB 3: BILLING. Principals and finance only. */}
                  {canSeeFinance ? (
                    <TabsContent value="billing" className="space-y-6">
                      {/*
                        Billing rules are the buyer's: a call nobody bought was
                        never billed, and its threshold and reason would describe
                        a charge that does not exist.
                      */}
                      {detailCall.buyerId ? (
                        <div className="space-y-4">
                          <h3 className="t-label text-brand-ink">Billing Snapshot Rules</h3>
                          <div className="rounded-card bg-sunken p-4 space-y-3 text-xs">
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <span className="text-ink-3 font-medium">Billable Threshold</span>
                                <p className="font-bold text-ink mt-0.5">
                                  {/* The threshold stored on the call, not an assumed default */}
                                  {detailCall.billableDurationThreshold != null
                                    ? `${detailCall.billableDurationThreshold} seconds`
                                    : 'Not recorded'}
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
                      ) : (
                        <p className="t-body text-ink-3">
                          This call was not sold to a buyer, so it was not billed.
                        </p>
                      )}

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
                  ) : null}

                  {/* TAB 4: PING/POST BIDS. Platform admins only. */}
                  {isPlatformAdmin ? (
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
                            {detailCall.pingRequest.bids &&
                            detailCall.pingRequest.bids.length > 0 ? (
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
                  ) : null}

                  {/* TAB 5: ADMIN / TRANSACTIONS. Platform admins only. */}
                  {isPlatformAdmin ? (
                    <TabsContent value="admin" className="space-y-6">
                      {/* Disputes note */}
                      <div className="space-y-3">
                        <h3 className="t-label text-brand-ink">Dispute Review</h3>
                        <div className="rounded-card bg-sunken p-4 space-y-2 text-xs">
                          <div className="flex items-center justify-between">
                            <span className="text-ink-3 font-medium">Dispute Status</span>
                            {detailCall.disputeStatus ? (
                              statusChip(disputeBadge(detailCall.disputeStatus))
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
                  ) : null}
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
