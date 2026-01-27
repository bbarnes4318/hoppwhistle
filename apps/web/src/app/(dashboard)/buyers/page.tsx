'use client';

import {
  ChevronDown,
  ChevronRight,
  Edit,
  Globe,
  Pause,
  Phone,
  Play,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Users,
  Wallet,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
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

// =============================================================================
// TYPES
// =============================================================================

interface Publisher {
  id: string;
  name: string;
}

interface Buyer {
  id: string;
  name: string;
  code: string;
  subId: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'PAUSED';
  billingType: 'TERMS' | 'UPFRONT';
  leadsRemaining: number;
  billableDuration: number;
  canPauseTargets: boolean;
  canSetCaps: boolean;
  canDisputeConversions: boolean;
  publisher: { id: string; name: string };
  callCount: number;
  transactionCount: number;
  createdAt: string;
  updatedAt: string;
}

interface BuyerStats {
  buyerId: string;
  revenueHour: number;
  revenueDay: number;
  revenueMonth: number;
  revenueTotal: number;
  callsHour: number;
  callsDay: number;
  callsMonth: number;
  callsTotal: number;
}

interface Target {
  id: string;
  buyerId: string;
  name: string;
  type: 'SIP' | 'PSTN' | 'WEBRTC';
  destination: string;
  priority: number;
  status: 'ACTIVE' | 'INACTIVE' | 'FAILED';
  maxCap: number;
  capPeriod: 'HOUR' | 'DAY' | 'MONTH';
  maxConcurrency: number;
}

interface TargetLiveStatus {
  targetId: string;
  liveCalls: number;
  maxConcurrency: number;
  isFull: boolean;
}

interface BuyerLiveStatus {
  buyerId: string;
  totalLiveCalls: number;
  targets: TargetLiveStatus[];
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function BuyersPage() {
  // -------------------------------------------------------------------------
  // STATE: Primary data (instant render)
  // -------------------------------------------------------------------------
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [publishers, setPublishers] = useState<Publisher[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // -------------------------------------------------------------------------
  // STATE: Async stats (non-blocking)
  // -------------------------------------------------------------------------
  const [statsMap, setStatsMap] = useState<Map<string, BuyerStats>>(new Map());
  const [statsLoading, setStatsLoading] = useState(true);

  // -------------------------------------------------------------------------
  // STATE: Row expansion (nested targets)
  // -------------------------------------------------------------------------
  const [expandedBuyerId, setExpandedBuyerId] = useState<string | null>(null);
  const [targets, setTargets] = useState<Target[]>([]);
  const [targetsLoading, setTargetsLoading] = useState(false);
  const [liveStatus, setLiveStatus] = useState<BuyerLiveStatus | null>(null);
  const [liveStatusLoading, setLiveStatusLoading] = useState(false);

  // -------------------------------------------------------------------------
  // STATE: Dialogs
  // -------------------------------------------------------------------------
  const [createBuyerOpen, setCreateBuyerOpen] = useState(false);
  const [editBuyerOpen, setEditBuyerOpen] = useState(false);
  const [creditsDialogOpen, setCreditsDialogOpen] = useState(false);
  const [createTargetOpen, setCreateTargetOpen] = useState(false);
  const [editTargetOpen, setEditTargetOpen] = useState(false);
  const [selectedBuyer, setSelectedBuyer] = useState<Buyer | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<Target | null>(null);

  // -------------------------------------------------------------------------
  // STATE: Form data
  // -------------------------------------------------------------------------
  const [buyerForm, setBuyerForm] = useState({
    name: '',
    code: '',
    subId: '',
    publisherId: '',
    billingType: 'TERMS' as 'TERMS' | 'UPFRONT',
    billableDuration: 60,
    canPauseTargets: false,
    canSetCaps: false,
    canDisputeConversions: false,
    status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE' | 'PAUSED',
  });
  const [targetForm, setTargetForm] = useState({
    name: '',
    type: 'PSTN' as 'SIP' | 'PSTN' | 'WEBRTC',
    destination: '',
    priority: 0,
    maxCap: 0,
    capPeriod: 'DAY' as 'HOUR' | 'DAY' | 'MONTH',
    maxConcurrency: 10,
    status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE' | 'FAILED',
  });
  const [creditsAmount, setCreditsAmount] = useState(100);
  const [saving, setSaving] = useState(false);

  // -------------------------------------------------------------------------
  // FETCHING: Primary data (instant)
  // -------------------------------------------------------------------------
  const fetchBuyers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: page.toString(), limit: '20' });
      const response = await apiClient.get<{
        data: Buyer[];
        meta: { totalPages: number };
      }>(`/api/v1/buyers?${params.toString()}`);
      if (response.data) {
        setBuyers(response.data.data);
        setTotalPages(response.data.meta.totalPages);
      }
    } catch (error) {
      console.error('Failed to fetch buyers:', error);
    } finally {
      setLoading(false);
    }
  }, [page]);

  const fetchPublishers = useCallback(async () => {
    try {
      const response = await apiClient.get<{ data: Publisher[] }>('/api/v1/publishers');
      if (response.data) {
        setPublishers(response.data.data);
      }
    } catch (error) {
      console.error('Failed to fetch publishers:', error);
    }
  }, []);

  // -------------------------------------------------------------------------
  // FETCHING: Stats (async, non-blocking)
  // -------------------------------------------------------------------------
  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const response = await apiClient.get<{ data: BuyerStats[] }>('/api/v1/buyers/stats');
      if (response.data) {
        const map = new Map<string, BuyerStats>();
        response.data.data.forEach(s => map.set(s.buyerId, s));
        setStatsMap(map);
      }
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  // -------------------------------------------------------------------------
  // FETCHING: Targets (on expand)
  // -------------------------------------------------------------------------
  const fetchTargets = useCallback(async (buyerId: string) => {
    setTargetsLoading(true);
    try {
      const response = await apiClient.get<{ data: Target[] }>(`/api/v1/buyers/${buyerId}/targets`);
      if (response.data) {
        setTargets(response.data.data);
      }
    } catch (error) {
      console.error('Failed to fetch targets:', error);
    } finally {
      setTargetsLoading(false);
    }
  }, []);

  const fetchLiveStatus = useCallback(async (buyerId: string) => {
    setLiveStatusLoading(true);
    try {
      const response = await apiClient.get<{ data: BuyerLiveStatus }>(
        `/api/v1/buyers/${buyerId}/live-status`
      );
      if (response.data) {
        setLiveStatus(response.data.data);
      }
    } catch (error) {
      console.error('Failed to fetch live status:', error);
    } finally {
      setLiveStatusLoading(false);
    }
  }, []);

  // -------------------------------------------------------------------------
  // EFFECTS
  // -------------------------------------------------------------------------
  useEffect(() => {
    void fetchBuyers();
    void fetchPublishers();
  }, [fetchBuyers, fetchPublishers]);

  // Fetch stats in parallel (non-blocking)
  useEffect(() => {
    void fetchStats();
  }, [fetchStats]);

  // Fetch targets when row expands
  useEffect(() => {
    if (expandedBuyerId) {
      void fetchTargets(expandedBuyerId);
      void fetchLiveStatus(expandedBuyerId);
      // Real-time polling for live status
      const interval = setInterval(() => {
        void fetchLiveStatus(expandedBuyerId);
      }, 5000);
      return () => clearInterval(interval);
    } else {
      setTargets([]);
      setLiveStatus(null);
    }
  }, [expandedBuyerId, fetchTargets, fetchLiveStatus]);

  // -------------------------------------------------------------------------
  // HANDLERS: Buyer CRUD
  // -------------------------------------------------------------------------
  const handleCreateBuyer = async () => {
    setSaving(true);
    try {
      const response = await apiClient.post('/api/v1/buyers', buyerForm);
      if (response.data) {
        setCreateBuyerOpen(false);
        resetBuyerForm();
        void fetchBuyers();
      }
    } catch (error) {
      console.error('Failed to create buyer:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleEditBuyer = async () => {
    if (!selectedBuyer) return;
    setSaving(true);
    try {
      const response = await apiClient.patch(`/api/v1/buyers/${selectedBuyer.id}`, buyerForm);
      if (response.data) {
        setEditBuyerOpen(false);
        resetBuyerForm();
        void fetchBuyers();
      }
    } catch (error) {
      console.error('Failed to update buyer:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleBuyerStatus = async (buyer: Buyer) => {
    const newStatus = buyer.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    try {
      await apiClient.patch(`/api/v1/buyers/${buyer.id}`, { status: newStatus });
      void fetchBuyers();
    } catch (error) {
      console.error('Failed to toggle buyer status:', error);
    }
  };

  const handleTogglePermission = async (
    buyer: Buyer,
    field: 'canPauseTargets' | 'canSetCaps' | 'canDisputeConversions'
  ) => {
    try {
      await apiClient.patch(`/api/v1/buyers/${buyer.id}`, { [field]: !buyer[field] });
      void fetchBuyers();
    } catch (error) {
      console.error('Failed to toggle permission:', error);
    }
  };

  const handleAddCredits = async () => {
    if (!selectedBuyer) return;
    setSaving(true);
    try {
      const response = await apiClient.post(`/api/v1/buyers/${selectedBuyer.id}/credits`, {
        amount: creditsAmount,
      });
      if (response.data) {
        setCreditsDialogOpen(false);
        setCreditsAmount(100);
        void fetchBuyers();
      }
    } catch (error) {
      console.error('Failed to add credits:', error);
    } finally {
      setSaving(false);
    }
  };

  // -------------------------------------------------------------------------
  // HANDLERS: Target CRUD
  // -------------------------------------------------------------------------
  const handleCreateTarget = async () => {
    if (!expandedBuyerId) return;
    setSaving(true);
    try {
      const response = await apiClient.post(
        `/api/v1/buyers/${expandedBuyerId}/targets`,
        targetForm
      );
      if (response.data) {
        setCreateTargetOpen(false);
        resetTargetForm();
        void fetchTargets(expandedBuyerId);
      }
    } catch (error) {
      console.error('Failed to create target:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleEditTarget = async () => {
    if (!expandedBuyerId || !selectedTarget) return;
    setSaving(true);
    try {
      const response = await apiClient.patch(
        `/api/v1/buyers/${expandedBuyerId}/targets/${selectedTarget.id}`,
        targetForm
      );
      if (response.data) {
        setEditTargetOpen(false);
        resetTargetForm();
        void fetchTargets(expandedBuyerId);
      }
    } catch (error) {
      console.error('Failed to update target:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleTargetStatus = async (target: Target) => {
    if (!expandedBuyerId) return;
    const newStatus = target.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    try {
      await apiClient.patch(`/api/v1/buyers/${expandedBuyerId}/targets/${target.id}`, {
        status: newStatus,
      });
      void fetchTargets(expandedBuyerId);
    } catch (error) {
      console.error('Failed to toggle target status:', error);
    }
  };

  const handleDeleteTarget = async (target: Target) => {
    if (!expandedBuyerId) return;
    if (!confirm(`Delete target "${target.name}"?`)) return;
    try {
      await apiClient.delete(`/api/v1/buyers/${expandedBuyerId}/targets/${target.id}`);
      void fetchTargets(expandedBuyerId);
    } catch (error) {
      console.error('Failed to delete target:', error);
    }
  };

  // -------------------------------------------------------------------------
  // HELPERS
  // -------------------------------------------------------------------------
  const resetBuyerForm = () => {
    setBuyerForm({
      name: '',
      code: '',
      subId: '',
      publisherId: '',
      billingType: 'TERMS',
      billableDuration: 60,
      canPauseTargets: false,
      canSetCaps: false,
      canDisputeConversions: false,
      status: 'ACTIVE',
    });
    setSelectedBuyer(null);
  };

  const resetTargetForm = () => {
    setTargetForm({
      name: '',
      type: 'PSTN',
      destination: '',
      priority: 0,
      maxCap: 0,
      capPeriod: 'DAY',
      maxConcurrency: 10,
      status: 'ACTIVE',
    });
    setSelectedTarget(null);
  };

  const openEditBuyerDialog = (buyer: Buyer) => {
    setSelectedBuyer(buyer);
    setBuyerForm({
      name: buyer.name,
      code: buyer.code,
      subId: buyer.subId || '',
      publisherId: buyer.publisher.id,
      billingType: buyer.billingType,
      billableDuration: buyer.billableDuration,
      canPauseTargets: buyer.canPauseTargets,
      canSetCaps: buyer.canSetCaps,
      canDisputeConversions: buyer.canDisputeConversions,
      status: buyer.status,
    });
    setEditBuyerOpen(true);
  };

  const openEditTargetDialog = (target: Target) => {
    setSelectedTarget(target);
    setTargetForm({
      name: target.name,
      type: target.type,
      destination: target.destination,
      priority: target.priority,
      maxCap: target.maxCap,
      capPeriod: target.capPeriod,
      maxConcurrency: target.maxConcurrency,
      status: target.status,
    });
    setEditTargetOpen(true);
  };

  const openCreditsDialog = (buyer: Buyer) => {
    setSelectedBuyer(buyer);
    setCreditsDialogOpen(true);
  };

  const toggleExpand = (buyerId: string) => {
    setExpandedBuyerId(prev => (prev === buyerId ? null : buyerId));
  };

  const getLiveCallsForTarget = (targetId: string): number | null => {
    if (!liveStatus) return null;
    const found = liveStatus.targets.find(t => t.targetId === targetId);
    return found ? found.liveCalls : 0;
  };

  // Filter buyers client-side
  const filteredBuyers = useMemo(
    () =>
      buyers.filter(
        buyer =>
          buyer.name.toLowerCase().includes(search.toLowerCase()) ||
          buyer.code.toLowerCase().includes(search.toLowerCase()) ||
          (buyer.subId && buyer.subId.toLowerCase().includes(search.toLowerCase())) ||
          buyer.publisher.name.toLowerCase().includes(search.toLowerCase())
      ),
    [buyers, search]
  );

  // Get expanded buyer for header
  const expandedBuyer = useMemo(
    () => buyers.find(b => b.id === expandedBuyerId),
    [buyers, expandedBuyerId]
  );

  // -------------------------------------------------------------------------
  // RENDER: Revenue cell with skeleton
  // -------------------------------------------------------------------------
  const RevenueCell = ({ buyerId, field }: { buyerId: string; field: keyof BuyerStats }) => {
    const stats = statsMap.get(buyerId);
    if (statsLoading) {
      return <Skeleton className="h-4 w-14" />;
    }
    const value = stats ? stats[field] : 0;
    return (
      <span className="font-mono text-xs">
        ${typeof value === 'number' ? value.toLocaleString() : '0'}
      </span>
    );
  };

  // -------------------------------------------------------------------------
  // RENDER
  // -------------------------------------------------------------------------
  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0 mb-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="h-6 w-6" />
            Manage Buyers
          </h1>
          <p className="text-sm text-muted-foreground">
            Configure buyer billing, permissions, and targets
          </p>
        </div>
        <Button onClick={() => setCreateBuyerOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Buyer
        </Button>
      </div>

      {/* Content */}
      <Card className="flex-1 flex flex-col overflow-hidden min-h-0">
        <CardHeader className="flex-shrink-0 py-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Buyers</CardTitle>
              <CardDescription className="text-xs">
                Manage buyer accounts, permissions, and nested targets
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search buyers..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-9 w-64 h-8 text-sm"
                />
              </div>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => {
                  void fetchBuyers();
                  void fetchStats();
                }}
                disabled={loading}
              >
                <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="flex-1 overflow-y-auto min-h-0 p-0">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow className="text-xs">
                <TableHead className="w-8"></TableHead>
                <TableHead>Company Name</TableHead>
                <TableHead>Sub ID</TableHead>
                <TableHead className="text-center">Pause</TableHead>
                <TableHead className="text-center">Caps</TableHead>
                <TableHead className="text-center">Dispute</TableHead>
                <TableHead className="text-right">Hour</TableHead>
                <TableHead className="text-right">Day</TableHead>
                <TableHead className="text-right">Month</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={12} className="text-center py-8">
                    <RefreshCw className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : filteredBuyers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={12} className="text-center py-8 text-muted-foreground">
                    No buyers found
                  </TableCell>
                </TableRow>
              ) : (
                filteredBuyers.map(buyer => (
                  <>
                    {/* Buyer Row */}
                    <TableRow
                      key={buyer.id}
                      className={cn(
                        'text-xs cursor-pointer hover:bg-muted/50',
                        expandedBuyerId === buyer.id && 'bg-muted/30'
                      )}
                      onClick={() => toggleExpand(buyer.id)}
                    >
                      <TableCell className="w-8 p-2">
                        {expandedBuyerId === buyer.id ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{buyer.name}</div>
                        <div className="text-[10px] text-muted-foreground font-mono">
                          {buyer.code}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{buyer.subId || '—'}</TableCell>
                      <TableCell className="text-center" onClick={e => e.stopPropagation()}>
                        <Switch
                          checked={buyer.canPauseTargets}
                          onCheckedChange={() => handleTogglePermission(buyer, 'canPauseTargets')}
                          className="scale-75"
                        />
                      </TableCell>
                      <TableCell className="text-center" onClick={e => e.stopPropagation()}>
                        <Switch
                          checked={buyer.canSetCaps}
                          onCheckedChange={() => handleTogglePermission(buyer, 'canSetCaps')}
                          className="scale-75"
                        />
                      </TableCell>
                      <TableCell className="text-center" onClick={e => e.stopPropagation()}>
                        <Switch
                          checked={buyer.canDisputeConversions}
                          onCheckedChange={() =>
                            handleTogglePermission(buyer, 'canDisputeConversions')
                          }
                          className="scale-75"
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <RevenueCell buyerId={buyer.id} field="revenueHour" />
                      </TableCell>
                      <TableCell className="text-right">
                        <RevenueCell buyerId={buyer.id} field="revenueDay" />
                      </TableCell>
                      <TableCell className="text-right">
                        <RevenueCell buyerId={buyer.id} field="revenueMonth" />
                      </TableCell>
                      <TableCell className="text-right">
                        <RevenueCell buyerId={buyer.id} field="revenueTotal" />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <div
                            className={cn(
                              'w-2 h-2 rounded-full',
                              buyer.status === 'ACTIVE' && 'bg-green-500',
                              buyer.status === 'PAUSED' && 'bg-orange-400',
                              buyer.status === 'INACTIVE' && 'bg-gray-400'
                            )}
                          />
                          <span className="capitalize text-xs">{buyer.status.toLowerCase()}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-end gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => openEditBuyerDialog(buyer)}
                            title="Edit"
                          >
                            <Edit className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => handleToggleBuyerStatus(buyer)}
                            title={buyer.status === 'ACTIVE' ? 'Pause' : 'Activate'}
                          >
                            {buyer.status === 'ACTIVE' ? (
                              <Pause className="h-3.5 w-3.5 text-orange-500" />
                            ) : (
                              <Play className="h-3.5 w-3.5 text-green-500" />
                            )}
                          </Button>
                          {buyer.billingType === 'UPFRONT' && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => openCreditsDialog(buyer)}
                              title="Add Credits"
                            >
                              <Wallet className="h-3.5 w-3.5 text-purple-500" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>

                    {/* Expanded Targets Row */}
                    {expandedBuyerId === buyer.id && (
                      <TableRow key={`${buyer.id}-targets`}>
                        <TableCell colSpan={12} className="p-0 bg-muted/20">
                          <div className="p-4">
                            {/* Targets Header */}
                            <div className="flex items-center justify-between mb-3">
                              <h3 className="font-semibold text-sm">
                                Targets for {expandedBuyer?.name}
                              </h3>
                              <Button
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => setCreateTargetOpen(true)}
                              >
                                <Plus className="mr-1 h-3 w-3" />
                                Add Target
                              </Button>
                            </div>

                            {/* Targets Table */}
                            {targetsLoading ? (
                              <div className="flex justify-center py-4">
                                <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
                              </div>
                            ) : targets.length === 0 ? (
                              <div className="text-center py-4 text-muted-foreground text-sm">
                                No targets configured. Add one to start routing calls.
                              </div>
                            ) : (
                              <Table>
                                <TableHeader>
                                  <TableRow className="text-xs">
                                    <TableHead>Name</TableHead>
                                    <TableHead>Destination</TableHead>
                                    <TableHead>Type</TableHead>
                                    <TableHead>Cap Settings</TableHead>
                                    <TableHead>Concurrency</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {targets.map(target => {
                                    const liveCalls = getLiveCallsForTarget(target.id);
                                    const capPercent =
                                      target.maxCap > 0
                                        ? Math.min(
                                            100,
                                            ((statsMap.get(buyer.id)?.capConsumedToday || 0) /
                                              target.maxCap) *
                                              100
                                          )
                                        : 0;

                                    return (
                                      <TableRow key={target.id} className="text-xs">
                                        <TableCell className="font-medium">{target.name}</TableCell>
                                        <TableCell>
                                          <div className="flex items-center gap-1.5">
                                            {target.type === 'SIP' ? (
                                              <Globe className="h-3.5 w-3.5 text-blue-500" />
                                            ) : (
                                              <Phone className="h-3.5 w-3.5 text-green-500" />
                                            )}
                                            <span className="font-mono text-[10px] truncate max-w-[150px]">
                                              {target.destination}
                                            </span>
                                          </div>
                                        </TableCell>
                                        <TableCell>
                                          <Badge variant="outline" className="text-[10px]">
                                            {target.type}
                                          </Badge>
                                        </TableCell>
                                        <TableCell>
                                          {target.maxCap > 0 ? (
                                            <div className="flex items-center gap-2">
                                              <Progress value={capPercent} className="w-16 h-1.5" />
                                              <span className="text-[10px] text-muted-foreground">
                                                {Math.round(capPercent)}%
                                              </span>
                                            </div>
                                          ) : (
                                            <span className="text-muted-foreground">No cap</span>
                                          )}
                                        </TableCell>
                                        <TableCell>
                                          {liveStatusLoading ? (
                                            <Skeleton className="h-4 w-12" />
                                          ) : (
                                            <span
                                              className={cn(
                                                'font-mono',
                                                liveCalls !== null &&
                                                  liveCalls >= target.maxConcurrency &&
                                                  'text-red-500 font-bold'
                                              )}
                                            >
                                              {liveCalls ?? 0}/{target.maxConcurrency}
                                            </span>
                                          )}
                                        </TableCell>
                                        <TableCell>
                                          <Switch
                                            checked={target.status === 'ACTIVE'}
                                            onCheckedChange={() => handleToggleTargetStatus(target)}
                                            className="scale-75"
                                          />
                                        </TableCell>
                                        <TableCell className="text-right">
                                          <div className="flex justify-end gap-0.5">
                                            <Button
                                              variant="ghost"
                                              size="icon"
                                              className="h-6 w-6"
                                              onClick={() => openEditTargetDialog(target)}
                                            >
                                              <Edit className="h-3 w-3" />
                                            </Button>
                                            <Button
                                              variant="ghost"
                                              size="icon"
                                              className="h-6 w-6 text-red-500"
                                              onClick={() => handleDeleteTarget(target)}
                                            >
                                              <Trash2 className="h-3 w-3" />
                                            </Button>
                                          </div>
                                        </TableCell>
                                      </TableRow>
                                    );
                                  })}
                                </TableBody>
                              </Table>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))
              )}
            </TableBody>
          </Table>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 py-4 border-t">
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

      {/* Create Buyer Dialog */}
      <Dialog open={createBuyerOpen} onOpenChange={setCreateBuyerOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add New Buyer</DialogTitle>
            <DialogDescription>
              Create a new buyer with permissions and billing settings
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4 max-h-[60vh] overflow-y-auto">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="name">Company Name *</Label>
                <Input
                  id="name"
                  value={buyerForm.name}
                  onChange={e => setBuyerForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Acme Corp"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="code">Code *</Label>
                <Input
                  id="code"
                  value={buyerForm.code}
                  onChange={e => setBuyerForm(f => ({ ...f, code: e.target.value }))}
                  placeholder="ACME001"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="subId">Sub ID</Label>
                <Input
                  id="subId"
                  value={buyerForm.subId}
                  onChange={e => setBuyerForm(f => ({ ...f, subId: e.target.value }))}
                  placeholder="Optional"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="publisher">Publisher *</Label>
                <Select
                  value={buyerForm.publisherId}
                  onValueChange={value => setBuyerForm(f => ({ ...f, publisherId: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select publisher" />
                  </SelectTrigger>
                  <SelectContent>
                    {publishers.map(pub => (
                      <SelectItem key={pub.id} value={pub.id}>
                        {pub.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="billingType">Billing Type</Label>
                <Select
                  value={buyerForm.billingType}
                  onValueChange={value =>
                    setBuyerForm(f => ({ ...f, billingType: value as 'TERMS' | 'UPFRONT' }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="TERMS">Terms (Post-pay)</SelectItem>
                    <SelectItem value="UPFRONT">Upfront (Pre-pay)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="billableDuration">Billable Duration (sec)</Label>
                <Input
                  id="billableDuration"
                  type="number"
                  value={buyerForm.billableDuration}
                  onChange={e =>
                    setBuyerForm(f => ({ ...f, billableDuration: parseInt(e.target.value) || 60 }))
                  }
                  min={0}
                />
              </div>
            </div>
            <div className="border-t pt-4">
              <Label className="text-sm font-medium mb-3 block">Permissions</Label>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="canPauseTargets" className="font-normal">
                    Allow Buyer to Pause Targets
                  </Label>
                  <Switch
                    id="canPauseTargets"
                    checked={buyerForm.canPauseTargets}
                    onCheckedChange={checked =>
                      setBuyerForm(f => ({ ...f, canPauseTargets: checked }))
                    }
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="canSetCaps" className="font-normal">
                    Allow Buyer to Set Target Caps
                  </Label>
                  <Switch
                    id="canSetCaps"
                    checked={buyerForm.canSetCaps}
                    onCheckedChange={checked => setBuyerForm(f => ({ ...f, canSetCaps: checked }))}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="canDisputeConversions" className="font-normal">
                    Allow Buyer to Dispute Call Conversions
                  </Label>
                  <Switch
                    id="canDisputeConversions"
                    checked={buyerForm.canDisputeConversions}
                    onCheckedChange={checked =>
                      setBuyerForm(f => ({ ...f, canDisputeConversions: checked }))
                    }
                  />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateBuyerOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateBuyer}
              disabled={saving || !buyerForm.name || !buyerForm.code || !buyerForm.publisherId}
            >
              {saving ? 'Creating...' : 'Create Buyer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Buyer Dialog */}
      <Dialog open={editBuyerOpen} onOpenChange={setEditBuyerOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Buyer</DialogTitle>
            <DialogDescription>Update buyer settings and permissions</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4 max-h-[60vh] overflow-y-auto">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-name">Company Name</Label>
                <Input
                  id="edit-name"
                  value={buyerForm.name}
                  onChange={e => setBuyerForm(f => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-code">Code</Label>
                <Input
                  id="edit-code"
                  value={buyerForm.code}
                  onChange={e => setBuyerForm(f => ({ ...f, code: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-subId">Sub ID</Label>
                <Input
                  id="edit-subId"
                  value={buyerForm.subId}
                  onChange={e => setBuyerForm(f => ({ ...f, subId: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-status">Status</Label>
                <Select
                  value={buyerForm.status}
                  onValueChange={value =>
                    setBuyerForm(f => ({ ...f, status: value as 'ACTIVE' | 'INACTIVE' | 'PAUSED' }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACTIVE">Active</SelectItem>
                    <SelectItem value="PAUSED">Paused</SelectItem>
                    <SelectItem value="INACTIVE">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-billingType">Billing Type</Label>
                <Select
                  value={buyerForm.billingType}
                  onValueChange={value =>
                    setBuyerForm(f => ({ ...f, billingType: value as 'TERMS' | 'UPFRONT' }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="TERMS">Terms (Post-pay)</SelectItem>
                    <SelectItem value="UPFRONT">Upfront (Pre-pay)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-billableDuration">Billable Duration (sec)</Label>
                <Input
                  id="edit-billableDuration"
                  type="number"
                  value={buyerForm.billableDuration}
                  onChange={e =>
                    setBuyerForm(f => ({ ...f, billableDuration: parseInt(e.target.value) || 60 }))
                  }
                  min={0}
                />
              </div>
            </div>
            <div className="border-t pt-4">
              <Label className="text-sm font-medium mb-3 block">Permissions</Label>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="edit-canPauseTargets" className="font-normal">
                    Allow Buyer to Pause Targets
                  </Label>
                  <Switch
                    id="edit-canPauseTargets"
                    checked={buyerForm.canPauseTargets}
                    onCheckedChange={checked =>
                      setBuyerForm(f => ({ ...f, canPauseTargets: checked }))
                    }
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="edit-canSetCaps" className="font-normal">
                    Allow Buyer to Set Target Caps
                  </Label>
                  <Switch
                    id="edit-canSetCaps"
                    checked={buyerForm.canSetCaps}
                    onCheckedChange={checked => setBuyerForm(f => ({ ...f, canSetCaps: checked }))}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="edit-canDisputeConversions" className="font-normal">
                    Allow Buyer to Dispute Call Conversions
                  </Label>
                  <Switch
                    id="edit-canDisputeConversions"
                    checked={buyerForm.canDisputeConversions}
                    onCheckedChange={checked =>
                      setBuyerForm(f => ({ ...f, canDisputeConversions: checked }))
                    }
                  />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditBuyerOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleEditBuyer} disabled={saving}>
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Credits Dialog */}
      <Dialog open={creditsDialogOpen} onOpenChange={setCreditsDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Credits</DialogTitle>
            <DialogDescription>Add leads to {selectedBuyer?.name}&apos;s wallet</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="text-center py-4">
              <div className="text-sm text-muted-foreground mb-1">Current Balance</div>
              <div className="text-3xl font-bold">
                {selectedBuyer?.leadsRemaining.toLocaleString() ?? 0}
                <span className="text-lg font-normal text-muted-foreground ml-2">leads</span>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="credits">Leads to Add</Label>
              <Input
                id="credits"
                type="number"
                value={creditsAmount}
                onChange={e => setCreditsAmount(parseInt(e.target.value) || 0)}
                min={1}
              />
            </div>
            <div className="text-center text-sm text-muted-foreground">
              New balance will be:{' '}
              <span className="font-semibold text-foreground">
                {((selectedBuyer?.leadsRemaining ?? 0) + creditsAmount).toLocaleString()} leads
              </span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreditsDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddCredits} disabled={saving || creditsAmount < 1}>
              {saving ? 'Adding...' : `Add ${creditsAmount} Credits`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Target Dialog */}
      <Dialog open={createTargetOpen} onOpenChange={setCreateTargetOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Target</DialogTitle>
            <DialogDescription>
              Create a new routing target for {expandedBuyer?.name}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="target-name">Name *</Label>
              <Input
                id="target-name"
                value={targetForm.name}
                onChange={e => setTargetForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Call Center A"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="target-type">Type *</Label>
                <Select
                  value={targetForm.type}
                  onValueChange={value =>
                    setTargetForm(f => ({ ...f, type: value as 'SIP' | 'PSTN' | 'WEBRTC' }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PSTN">PSTN (Phone)</SelectItem>
                    <SelectItem value="SIP">SIP</SelectItem>
                    <SelectItem value="WEBRTC">WebRTC</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="target-priority">Priority</Label>
                <Input
                  id="target-priority"
                  type="number"
                  value={targetForm.priority}
                  onChange={e =>
                    setTargetForm(f => ({ ...f, priority: parseInt(e.target.value) || 0 }))
                  }
                  min={0}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="target-destination">Destination *</Label>
              <Input
                id="target-destination"
                value={targetForm.destination}
                onChange={e => setTargetForm(f => ({ ...f, destination: e.target.value }))}
                placeholder={targetForm.type === 'SIP' ? 'sip:user@domain.com' : '+15551234567'}
              />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="target-maxCap">Max Cap</Label>
                <Input
                  id="target-maxCap"
                  type="number"
                  value={targetForm.maxCap}
                  onChange={e =>
                    setTargetForm(f => ({ ...f, maxCap: parseInt(e.target.value) || 0 }))
                  }
                  min={0}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="target-capPeriod">Period</Label>
                <Select
                  value={targetForm.capPeriod}
                  onValueChange={value =>
                    setTargetForm(f => ({ ...f, capPeriod: value as 'HOUR' | 'DAY' | 'MONTH' }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="HOUR">Hour</SelectItem>
                    <SelectItem value="DAY">Day</SelectItem>
                    <SelectItem value="MONTH">Month</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="target-maxConcurrency">Max Concurrent</Label>
                <Input
                  id="target-maxConcurrency"
                  type="number"
                  value={targetForm.maxConcurrency}
                  onChange={e =>
                    setTargetForm(f => ({ ...f, maxConcurrency: parseInt(e.target.value) || 10 }))
                  }
                  min={1}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateTargetOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateTarget}
              disabled={saving || !targetForm.name || !targetForm.destination}
            >
              {saving ? 'Creating...' : 'Create Target'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Target Dialog */}
      <Dialog open={editTargetOpen} onOpenChange={setEditTargetOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Target</DialogTitle>
            <DialogDescription>Update target configuration</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-target-name">Name</Label>
              <Input
                id="edit-target-name"
                value={targetForm.name}
                onChange={e => setTargetForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-target-type">Type</Label>
                <Select
                  value={targetForm.type}
                  onValueChange={value =>
                    setTargetForm(f => ({ ...f, type: value as 'SIP' | 'PSTN' | 'WEBRTC' }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PSTN">PSTN (Phone)</SelectItem>
                    <SelectItem value="SIP">SIP</SelectItem>
                    <SelectItem value="WEBRTC">WebRTC</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-target-priority">Priority</Label>
                <Input
                  id="edit-target-priority"
                  type="number"
                  value={targetForm.priority}
                  onChange={e =>
                    setTargetForm(f => ({ ...f, priority: parseInt(e.target.value) || 0 }))
                  }
                  min={0}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-target-destination">Destination</Label>
              <Input
                id="edit-target-destination"
                value={targetForm.destination}
                onChange={e => setTargetForm(f => ({ ...f, destination: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-target-maxCap">Max Cap</Label>
                <Input
                  id="edit-target-maxCap"
                  type="number"
                  value={targetForm.maxCap}
                  onChange={e =>
                    setTargetForm(f => ({ ...f, maxCap: parseInt(e.target.value) || 0 }))
                  }
                  min={0}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-target-capPeriod">Period</Label>
                <Select
                  value={targetForm.capPeriod}
                  onValueChange={value =>
                    setTargetForm(f => ({ ...f, capPeriod: value as 'HOUR' | 'DAY' | 'MONTH' }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="HOUR">Hour</SelectItem>
                    <SelectItem value="DAY">Day</SelectItem>
                    <SelectItem value="MONTH">Month</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-target-maxConcurrency">Max Concurrent</Label>
                <Input
                  id="edit-target-maxConcurrency"
                  type="number"
                  value={targetForm.maxConcurrency}
                  onChange={e =>
                    setTargetForm(f => ({ ...f, maxConcurrency: parseInt(e.target.value) || 10 }))
                  }
                  min={1}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-target-status">Status</Label>
              <Select
                value={targetForm.status}
                onValueChange={value =>
                  setTargetForm(f => ({ ...f, status: value as 'ACTIVE' | 'INACTIVE' | 'FAILED' }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  <SelectItem value="INACTIVE">Inactive</SelectItem>
                  <SelectItem value="FAILED">Failed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTargetOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleEditTarget} disabled={saving}>
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
