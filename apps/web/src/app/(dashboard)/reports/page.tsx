'use client';

import {
  BarChart3,
  Calendar,
  Download,
  Loader2,
  RefreshCw,
  TrendingUp,
  DollarSign,
  Phone,
  Users,
  ShieldAlert,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { apiClient } from '@/lib/api';
import { cn } from '@/lib/utils';

// Helper to get formatted dates
const getPastDateStr = (daysAgo: number) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
};

interface Campaign {
  id: string;
  name: string;
}

interface PublisherRevenueRow {
  publisherId: string;
  publisherName: string;
  campaignId: string;
  campaignName: string;
  totalCalls: number;
  billableCalls: number;
  nonBillableCalls: number;
  payoutRate: string;
  publisherRevenue: string;
}

interface PublisherRevenueReport {
  totals: {
    totalCalls: number;
    billableCalls: number;
    publisherRevenue: string;
  };
  rows: PublisherRevenueRow[];
}

interface BuyerCostsRow {
  buyerId: string;
  buyerName: string;
  campaignId: string;
  campaignName: string;
  destinationNumber: string;
  totalCalls: number;
  billableCalls: number;
  nonBillableCalls: number;
  billableRate: number;
  averageDuration: number;
  pricePerBillableCall: string;
  buyerCost: string;
}

interface BuyerCostsReport {
  totals: {
    totalCalls: number;
    billableCalls: number;
    buyerCost: string;
  };
  rows: BuyerCostsRow[];
}

interface CampaignProfitabilityRow {
  campaignId: string;
  campaignName: string;
  totalCalls: number;
  billableCalls: number;
  buyerRevenue: string;
  publisherPayout: string;
  callCost: string;
  profit: string;
  margin: number;
}

interface CampaignProfitabilityReport {
  totals: {
    totalCalls: number;
    billableCalls: number;
    buyerRevenue: string;
    publisherPayout: string;
    callCost: string;
    profit: string;
    margin: number;
  };
  rows: CampaignProfitabilityRow[];
}

export default function ReportsPage() {
  const { toast } = useToast();
  const { hasFullAccess, userRoles, isBuyerOnly, isBuyer } = useAuth();
  const [activeTab, setActiveTab] = useState('campaign-profitability');

  // Filters
  const [startDate, setStartDate] = useState(getPastDateStr(30));
  const [endDate, setEndDate] = useState(getPastDateStr(0));
  const [campaignId, setCampaignId] = useState('');
  const [datePreset, setDatePreset] = useState('last-30');

  // Dropdown lists
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);

  // Report states
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [pubReport, setPubReport] = useState<PublisherRevenueReport | null>(null);
  const [buyerReport, setBuyerReport] = useState<BuyerCostsReport | null>(null);
  const [profitReport, setProfitReport] = useState<CampaignProfitabilityReport | null>(null);

  // Determine tab visibilities
  const showProfitability = hasFullAccess;
  const showPublisherRevenue = hasFullAccess || userRoles.includes('PUBLISHER');
  const showBuyerCosts = hasFullAccess || isBuyer;

  // Set default tab based on roles
  useEffect(() => {
    if (showProfitability) {
      setActiveTab('campaign-profitability');
    } else if (showBuyerCosts) {
      setActiveTab('buyer-costs');
    } else if (showPublisherRevenue) {
      setActiveTab('publisher-revenue');
    }
  }, [showProfitability, showBuyerCosts, showPublisherRevenue]);

  // Load Campaigns dropdown list
  useEffect(() => {
    const fetchCampaigns = async () => {
      try {
        const res = await apiClient.get<{ data: Campaign[] }>('/api/v1/campaigns?limit=100');
        if (res.data?.data) {
          setCampaigns(res.data.data);
        }
      } catch (err) {
        console.error('Failed to load campaigns list:', err);
      }
    };
    void fetchCampaigns();
  }, []);

  // Fetch report data based on active tab and filters
  const fetchReport = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      startDate,
      endDate: `${endDate}T23:59:59.999Z`,
      ...(campaignId ? { campaignId } : {}),
    });

    try {
      if (activeTab === 'campaign-profitability' && showProfitability) {
        const res = await apiClient.get<CampaignProfitabilityReport>(
          `/api/v1/reports/campaign-profitability?${params.toString()}`
        );
        if (res.data) setProfitReport(res.data);
      } else if (activeTab === 'publisher-revenue' && showPublisherRevenue) {
        const res = await apiClient.get<PublisherRevenueReport>(
          `/api/v1/reports/publisher-revenue?${params.toString()}`
        );
        if (res.data) setPubReport(res.data);
      } else if (activeTab === 'buyer-costs' && showBuyerCosts) {
        const res = await apiClient.get<BuyerCostsReport>(
          `/api/v1/reports/buyer-costs?${params.toString()}`
        );
        if (res.data) setBuyerReport(res.data);
      }
    } catch (err) {
      console.error('Failed to load report:', err);
      toast({
        title: 'Error',
        description: 'Failed to retrieve report data.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [activeTab, startDate, endDate, campaignId, showProfitability, showPublisherRevenue, showBuyerCosts, toast]);

  useEffect(() => {
    void fetchReport();
  }, [fetchReport, activeTab]);

  // Handle Preset Clicks
  const handlePresetSelect = (preset: string) => {
    setDatePreset(preset);
    const today = getPastDateStr(0);
    if (preset === 'today') {
      setStartDate(today);
      setEndDate(today);
    } else if (preset === 'yesterday') {
      const yesterday = getPastDateStr(1);
      setStartDate(yesterday);
      setEndDate(yesterday);
    } else if (preset === 'last-7') {
      setStartDate(getPastDateStr(7));
      setEndDate(today);
    } else if (preset === 'last-30') {
      setStartDate(getPastDateStr(30));
      setEndDate(today);
    } else if (preset === 'this-month') {
      const d = new Date();
      const firstDay = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
      setStartDate(firstDay);
      setEndDate(today);
    }
  };

  // Secure authenticated CSV download helper
  const handleCsvExport = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams({
        startDate,
        endDate: `${endDate}T23:59:59.999Z`,
        ...(campaignId ? { campaignId } : {}),
      });

      const token = localStorage.getItem('token');
      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const endpoint = `${apiUrl}/api/v1/reports/${activeTab}/export.csv?${params.toString()}`;

      const res = await fetch(endpoint, {
        headers,
        credentials: 'include',
      });

      if (!res.ok) {
        throw new Error('Server returned an error for export.');
      }

      const blob = await res.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `${activeTab}_report_${startDate}_to_${endDate}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);

      toast({
        title: 'Export Complete',
        description: 'Your CSV file has been generated and downloaded.',
        variant: 'success',
      });
    } catch (err) {
      console.error('Export error:', err);
      toast({
        title: 'Export Failed',
        description: 'An error occurred during report generation.',
        variant: 'destructive',
      });
    } finally {
      setExporting(false);
    }
  };

  // If no roles are loaded or not logged in
  if (!showProfitability && !showPublisherRevenue && !showBuyerCosts) {
    return (
      <div className="flex flex-col items-center justify-center h-[350px] border border-dashed rounded-lg p-6 bg-muted/25">
        <ShieldAlert className="h-12 w-12 text-rose-500 mb-4 animate-pulse" />
        <h3 className="text-xl font-medium">Access Restricted</h3>
        <p className="text-sm text-muted-foreground mt-2 text-center max-w-md">
          You do not have the required roles to view billing and financial reports. Please contact your system administrator.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Financial Reports</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Analyze publisher revenue, buyer costs, and campaign profit margins.
          </p>
        </div>
        <Button 
          onClick={handleCsvExport} 
          disabled={exporting || loading}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {exporting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Generating CSV...
            </>
          ) : (
            <>
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </>
          )}
        </Button>
      </div>

      {/* Date & Filter Controls Card */}
      <Card className="border border-border">
        <CardContent className="p-5 flex flex-col gap-4 md:flex-row md:items-end justify-between">
          <div className="flex flex-col sm:flex-row gap-4 flex-1">
            {/* Start Date */}
            <div className="space-y-1.5 flex-1 max-w-[200px]">
              <Label className="text-xs text-muted-foreground">Start Date</Label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    setDatePreset('custom');
                  }}
                  className="pl-9"
                />
              </div>
            </div>

            {/* End Date */}
            <div className="space-y-1.5 flex-1 max-w-[200px]">
              <Label className="text-xs text-muted-foreground">End Date</Label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => {
                    setEndDate(e.target.value);
                    setDatePreset('custom');
                  }}
                  className="pl-9"
                />
              </div>
            </div>

            {/* Campaign Select */}
            <div className="space-y-1.5 flex-1 max-w-[240px]">
              <Label className="text-xs text-muted-foreground">Campaign Filter</Label>
              <Select value={campaignId} onValueChange={setCampaignId}>
                <SelectTrigger>
                  <SelectValue placeholder="All Campaigns" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all-campaigns">All Campaigns</SelectItem>
                  {campaigns.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Date presets and refresh */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex bg-muted/60 p-1 rounded-lg border border-border">
              {['today', 'yesterday', 'last-7', 'last-30', 'this-month'].map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => handlePresetSelect(p)}
                  className={cn(
                    'px-2.5 py-1 text-xs font-semibold rounded-md capitalize transition-colors',
                    datePreset === p 
                      ? 'bg-card text-foreground shadow-sm border border-border'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {p.replace('-', ' ')}
                </button>
              ))}
            </div>

            <Button variant="outline" size="icon" onClick={fetchReport} disabled={loading}>
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Tabs Layout */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="bg-muted/50 p-1 border border-border">
          {showProfitability && (
            <TabsTrigger value="campaign-profitability">Campaign Profitability</TabsTrigger>
          )}
          {showPublisherRevenue && (
            <TabsTrigger value="publisher-revenue">Publisher Revenue</TabsTrigger>
          )}
          {showBuyerCosts && (
            <TabsTrigger value="buyer-costs">Buyer Costs</TabsTrigger>
          )}
        </TabsList>

        {/* Tab 1: Campaign Profitability */}
        {showProfitability && (
          <TabsContent value="campaign-profitability" className="space-y-6">
            {/* Quick Metrics */}
            <div className="grid gap-4 sm:grid-cols-4">
              <Card className="bg-card border border-border">
                <CardHeader className="py-4 flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Total Revenue</CardTitle>
                  <DollarSign className="h-4 w-4 text-emerald-400" />
                </CardHeader>
                <CardContent className="pb-4">
                  <div className="text-2xl font-bold">
                    ${profitReport ? Number(profitReport.totals.buyerRevenue).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-card border border-border">
                <CardHeader className="py-4 flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Publisher Payout</CardTitle>
                  <Users className="h-4 w-4 text-amber-400" />
                </CardHeader>
                <CardContent className="pb-4">
                  <div className="text-2xl font-bold text-amber-400">
                    ${profitReport ? Number(profitReport.totals.publisherPayout).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-card border border-border">
                <CardHeader className="py-4 flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Call Routing Cost</CardTitle>
                  <Phone className="h-4 w-4 text-rose-400" />
                </CardHeader>
                <CardContent className="pb-4">
                  <div className="text-2xl font-bold text-rose-400">
                    ${profitReport ? Number(profitReport.totals.callCost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-card border border-border">
                <CardHeader className="py-4 flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Net Margin / Profit</CardTitle>
                  <TrendingUp className="h-4 w-4 text-emerald-400" />
                </CardHeader>
                <CardContent className="pb-4 flex items-baseline justify-between">
                  <div className="text-2xl font-bold text-emerald-400">
                    ${profitReport ? Number(profitReport.totals.profit).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}
                  </div>
                  <Badge variant="outline" className="text-emerald-400 bg-emerald-500/10 border-emerald-500/20 font-mono">
                    {profitReport ? (profitReport.totals.margin * 100).toFixed(1) : '0.0'}%
                  </Badge>
                </CardContent>
              </Card>
            </div>

            {/* Detailed Table */}
            <Card>
              <CardHeader>
                <CardTitle>Campaign Profitability Matrix</CardTitle>
                <CardDescription>
                  Reconciles buyer revenue, publisher payouts, and network costs on a per-campaign basis.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Campaign Name</TableHead>
                      <TableHead className="text-right">Total Calls</TableHead>
                      <TableHead className="text-right">Billable Calls</TableHead>
                      <TableHead className="text-right">Revenue ($)</TableHead>
                      <TableHead className="text-right">Payout ($)</TableHead>
                      <TableHead className="text-right">Carrier Cost ($)</TableHead>
                      <TableHead className="text-right">Profit ($)</TableHead>
                      <TableHead className="text-right">Margin (%)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-8">
                          <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                        </TableCell>
                      </TableRow>
                    ) : !profitReport || profitReport.rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-8 text-muted-foreground text-sm">
                          No report data found for the selected filters.
                        </TableCell>
                      </TableRow>
                    ) : (
                      <>
                        {profitReport.rows.map((row) => (
                          <TableRow key={row.campaignId}>
                            <TableCell className="font-semibold text-foreground">{row.campaignName}</TableCell>
                            <TableCell className="text-right tabular-nums">{row.totalCalls}</TableCell>
                            <TableCell className="text-right tabular-nums text-primary font-medium">{row.billableCalls}</TableCell>
                            <TableCell className="text-right tabular-nums text-emerald-400">${Number(row.buyerRevenue).toFixed(2)}</TableCell>
                            <TableCell className="text-right tabular-nums text-amber-400">${Number(row.publisherPayout).toFixed(2)}</TableCell>
                            <TableCell className="text-right tabular-nums text-rose-400">${Number(row.callCost).toFixed(2)}</TableCell>
                            <TableCell className={cn(
                              "text-right tabular-nums font-bold",
                              Number(row.profit) >= 0 ? "text-emerald-400" : "text-rose-500"
                            )}>
                              ${Number(row.profit).toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right">
                              <Badge variant="outline" className={cn(
                                "font-mono text-xs",
                                row.margin >= 0 ? "text-emerald-400 bg-emerald-500/5 border-emerald-500/20" : "text-rose-500 bg-rose-500/5 border-rose-500/20"
                              )}>
                                {(row.margin * 100).toFixed(1)}%
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                        {/* Totals Row */}
                        <TableRow className="bg-muted/40 font-bold border-t-2 border-border hover:bg-muted/50">
                          <TableCell>Report Totals</TableCell>
                          <TableCell className="text-right tabular-nums">{profitReport.totals.totalCalls}</TableCell>
                          <TableCell className="text-right tabular-nums text-primary">{profitReport.totals.billableCalls}</TableCell>
                          <TableCell className="text-right tabular-nums text-emerald-400">${Number(profitReport.totals.buyerRevenue).toFixed(2)}</TableCell>
                          <TableCell className="text-right tabular-nums text-amber-400">${Number(profitReport.totals.publisherPayout).toFixed(2)}</TableCell>
                          <TableCell className="text-right tabular-nums text-rose-400">${Number(profitReport.totals.callCost).toFixed(2)}</TableCell>
                          <TableCell className={cn(
                            "text-right tabular-nums text-lg",
                            Number(profitReport.totals.profit) >= 0 ? "text-emerald-400" : "text-rose-500"
                          )}>
                            ${Number(profitReport.totals.profit).toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge variant="outline" className={cn(
                              "font-mono text-xs font-bold",
                              profitReport.totals.margin >= 0 ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/30" : "text-rose-500 bg-rose-500/10 border-rose-500/30"
                            )}>
                              {(profitReport.totals.margin * 100).toFixed(1)}%
                            </Badge>
                          </TableCell>
                        </TableRow>
                      </>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Tab 2: Publisher Revenue */}
        {showPublisherRevenue && (
          <TabsContent value="publisher-revenue" className="space-y-6">
            {/* Quick Metrics */}
            <div className="grid gap-4 sm:grid-cols-3">
              <Card className="bg-card border border-border">
                <CardHeader className="py-4 flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Total Inbound Calls</CardTitle>
                  <Phone className="h-4 w-4 text-primary" />
                </CardHeader>
                <CardContent className="pb-4">
                  <div className="text-2xl font-bold">
                    {pubReport ? pubReport.totals.totalCalls.toLocaleString() : '0'}
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-card border border-border">
                <CardHeader className="py-4 flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Billable Calls</CardTitle>
                  <Badge variant="outline" className="text-emerald-400 bg-emerald-500/10 border-emerald-500/20 font-mono">
                    {pubReport && pubReport.totals.totalCalls > 0 ? ((pubReport.totals.billableCalls / pubReport.totals.totalCalls) * 100).toFixed(1) : '0.0'}% Rate
                  </Badge>
                </CardHeader>
                <CardContent className="pb-4">
                  <div className="text-2xl font-bold text-emerald-400">
                    {pubReport ? pubReport.totals.billableCalls.toLocaleString() : '0'}
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-card border border-border">
                <CardHeader className="py-4 flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Total Earnings</CardTitle>
                  <DollarSign className="h-4 w-4 text-emerald-400" />
                </CardHeader>
                <CardContent className="pb-4">
                  <div className="text-2xl font-bold text-emerald-400">
                    ${pubReport ? Number(pubReport.totals.publisherRevenue).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Detailed Table */}
            <Card>
              <CardHeader>
                <CardTitle>Publisher Revenue Breakdown</CardTitle>
                <CardDescription>
                  Tracks calls routed from publishers, billing status, and payout metrics.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Publisher Name</TableHead>
                      <TableHead>Campaign Name</TableHead>
                      <TableHead className="text-right">Total Calls</TableHead>
                      <TableHead className="text-right">Billable Calls</TableHead>
                      <TableHead className="text-right">Non-Billable</TableHead>
                      <TableHead className="text-right">Payout Rate ($)</TableHead>
                      <TableHead className="text-right">Earnings ($)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8">
                          <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                        </TableCell>
                      </TableRow>
                    ) : !pubReport || pubReport.rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-muted-foreground text-sm">
                          No publisher revenue records found.
                        </TableCell>
                      </TableRow>
                    ) : (
                      <>
                        {pubReport.rows.map((row, idx) => (
                          <TableRow key={`${row.publisherId}-${row.campaignId}-${idx}`}>
                            <TableCell className="font-semibold text-foreground">{row.publisherName}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{row.campaignName}</TableCell>
                            <TableCell className="text-right tabular-nums">{row.totalCalls}</TableCell>
                            <TableCell className="text-right tabular-nums text-emerald-400 font-medium">{row.billableCalls}</TableCell>
                            <TableCell className="text-right tabular-nums text-muted-foreground">{row.nonBillableCalls}</TableCell>
                            <TableCell className="text-right tabular-nums font-mono text-xs text-muted-foreground">${Number(row.payoutRate).toFixed(2)}</TableCell>
                            <TableCell className="text-right tabular-nums font-bold text-emerald-400">${Number(row.publisherRevenue).toFixed(2)}</TableCell>
                          </TableRow>
                        ))}
                        {/* Totals Row */}
                        <TableRow className="bg-muted/40 font-bold border-t-2 border-border hover:bg-muted/50">
                          <TableCell colSpan={2}>Report Totals</TableCell>
                          <TableCell className="text-right tabular-nums">{pubReport.totals.totalCalls}</TableCell>
                          <TableCell className="text-right tabular-nums text-emerald-400">{pubReport.totals.billableCalls}</TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {pubReport.totals.totalCalls - pubReport.totals.billableCalls}
                          </TableCell>
                          <TableCell className="text-right">—</TableCell>
                          <TableCell className="text-right tabular-nums text-lg text-emerald-400">${Number(pubReport.totals.publisherRevenue).toFixed(2)}</TableCell>
                        </TableRow>
                      </>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Tab 3: Buyer Costs */}
        {showBuyerCosts && (
          <TabsContent value="buyer-costs" className="space-y-6">
            {/* Quick Metrics */}
            <div className="grid gap-4 sm:grid-cols-3">
              <Card className="bg-card border border-border">
                <CardHeader className="py-4 flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Total Inbound Calls</CardTitle>
                  <Phone className="h-4 w-4 text-primary" />
                </CardHeader>
                <CardContent className="pb-4">
                  <div className="text-2xl font-bold">
                    {buyerReport ? buyerReport.totals.totalCalls.toLocaleString() : '0'}
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-card border border-border">
                <CardHeader className="py-4 flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Billable Calls</CardTitle>
                  <Badge variant="outline" className="text-emerald-400 bg-emerald-500/10 border-emerald-500/20 font-mono">
                    {buyerReport && buyerReport.totals.totalCalls > 0 ? ((buyerReport.totals.billableCalls / buyerReport.totals.totalCalls) * 100).toFixed(1) : '0.0'}% Conversion
                  </Badge>
                </CardHeader>
                <CardContent className="pb-4">
                  <div className="text-2xl font-bold text-emerald-400">
                    {buyerReport ? buyerReport.totals.billableCalls.toLocaleString() : '0'}
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-card border border-border">
                <CardHeader className="py-4 flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Total Invoiced Cost</CardTitle>
                  <DollarSign className="h-4 w-4 text-rose-400" />
                </CardHeader>
                <CardContent className="pb-4">
                  <div className="text-2xl font-bold text-rose-400">
                    ${buyerReport ? Number(buyerReport.totals.buyerCost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Detailed Table */}
            <Card>
              <CardHeader>
                <CardTitle>Buyer Billing & Cost breakdown</CardTitle>
                <CardDescription>
                  Details billable calls, destinations routed to, billable ratios, and total buyer costs.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Buyer Name</TableHead>
                      <TableHead>Campaign Name</TableHead>
                      <TableHead>Destination DID</TableHead>
                      <TableHead className="text-right">Total Calls</TableHead>
                      <TableHead className="text-right">Billable Calls</TableHead>
                      <TableHead className="text-right">Billable (%)</TableHead>
                      <TableHead className="text-right">Avg Duration</TableHead>
                      <TableHead className="text-right">Rate ($)</TableHead>
                      <TableHead className="text-right">Cost ($)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center py-8">
                          <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                        </TableCell>
                      </TableRow>
                    ) : !buyerReport || buyerReport.rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center py-8 text-muted-foreground text-sm">
                          No buyer cost records found.
                        </TableCell>
                      </TableRow>
                    ) : (
                      <>
                        {buyerReport.rows.map((row, idx) => (
                          <TableRow key={`${row.buyerId}-${row.campaignId}-${idx}`}>
                            <TableCell className="font-semibold text-foreground">{row.buyerName}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{row.campaignName}</TableCell>
                            <TableCell className="font-mono text-xs font-semibold">{row.destinationNumber}</TableCell>
                            <TableCell className="text-right tabular-nums">{row.totalCalls}</TableCell>
                            <TableCell className="text-right tabular-nums text-emerald-400 font-medium">{row.billableCalls}</TableCell>
                            <TableCell className="text-right tabular-nums text-xs">
                              {(row.billableRate * 100).toFixed(1)}%
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                              {Math.round(row.averageDuration)}s
                            </TableCell>
                            <TableCell className="text-right tabular-nums font-mono text-xs text-muted-foreground">${Number(row.pricePerBillableCall).toFixed(2)}</TableCell>
                            <TableCell className="text-right tabular-nums font-bold text-rose-400">${Number(row.buyerCost).toFixed(2)}</TableCell>
                          </TableRow>
                        ))}
                        {/* Totals Row */}
                        <TableRow className="bg-muted/40 font-bold border-t-2 border-border hover:bg-muted/50">
                          <TableCell colSpan={3}>Report Totals</TableCell>
                          <TableCell className="text-right tabular-nums">{buyerReport.totals.totalCalls}</TableCell>
                          <TableCell className="text-right tabular-nums text-emerald-400">{buyerReport.totals.billableCalls}</TableCell>
                          <TableCell className="text-right tabular-nums text-xs">
                            {buyerReport.totals.totalCalls > 0 ? ((buyerReport.totals.billableCalls / buyerReport.totals.totalCalls) * 100).toFixed(1) : '0.0'}%
                          </TableCell>
                          <TableCell className="text-right">—</TableCell>
                          <TableCell className="text-right">—</TableCell>
                          <TableCell className="text-right tabular-nums text-lg text-rose-400">${Number(buyerReport.totals.buyerCost).toFixed(2)}</TableCell>
                        </TableRow>
                      </>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
