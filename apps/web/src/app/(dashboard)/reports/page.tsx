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
import { CompactPageShell, CompactPageHeader, DenseCard } from '@/components/layout/compact-layout';

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
  earnings: string;
  paid: string;
  pending: string;
  held: string;
}

interface PublisherRevenueReport {
  totals: {
    totalCalls: number;
    billableCalls: number;
    nonBillableCalls: number;
    earnings: string;
    publisherRevenue: string;
    paid: string;
    pending: string;
    held: string;
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
  walletDebits: string;
  invoiced: string;
  pendingInvoice: string;
  disputes: string;
}

interface BuyerCostsReport {
  totals: {
    totalCalls: number;
    billableCalls: number;
    nonBillableCalls: number;
    averageDuration: number;
    billableRate: number;
    buyerCost: string;
    walletDebits: string;
    invoiced: string;
    pendingInvoice: string;
    disputes: string;
  };
  rows: BuyerCostsRow[];
}

interface CampaignProfitabilityRow {
  campaignId: string;
  campaignName: string;
  totalCalls: number;
  connectedCalls: number;
  billableCalls: number;
  buyerRevenue: string;
  publisherPayout: string;
  callCost: string;
  otherCosts: string;
  profit: string;
  margin: number;
  disputes: string;
  disputesCount: number;
  adjustments: string;
  netPayableReceivable: string;
}

interface CampaignProfitabilityReport {
  totals: {
    totalCalls: number;
    connectedCalls: number;
    billableCalls: number;
    buyerRevenue: string;
    publisherPayout: string;
    callCost: string;
    otherCosts: string;
    profit: string;
    margin: number;
    disputes: string;
    disputesCount: number;
    adjustments: string;
    netPayableReceivable: string;
  };
  rows: CampaignProfitabilityRow[];
}

function ReportsPage() {
  const { user } = useAuth();
  const { toast } = useToast();

  const isPublisher = user?.roles.includes('PUBLISHER') && !user?.roles.includes('ADMIN') && !user?.roles.includes('OWNER');
  const isBuyer = user?.roles.includes('BUYER') && !user?.roles.includes('ADMIN') && !user?.roles.includes('OWNER');
  const isReadOnly = user?.roles.includes('READONLY');
  const isAgent = user?.roles.includes('AGENT');

  const showProfitability = !isPublisher && !isBuyer && !isAgent;
  const showPublisherRevenue = !isBuyer && !isAgent;
  const showBuyerCosts = !isPublisher && !isAgent;

  // Active Tab state
  const [activeTab, setActiveTab] = useState(
    showProfitability 
      ? 'campaign-profitability' 
      : showPublisherRevenue 
        ? 'publisher-revenue' 
        : 'buyer-costs'
  );

  // Filter States
  const [startDate, setStartDate] = useState(getPastDateStr(30));
  const [endDate, setEndDate] = useState(getPastDateStr(0));
  const [campaignId, setCampaignId] = useState('');
  const [datePreset, setDatePreset] = useState('last-30');

  // Data States
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [profitReport, setProfitReport] = useState<CampaignProfitabilityReport | null>(null);
  const [pubReport, setPubReport] = useState<PublisherRevenueReport | null>(null);
  const [buyerReport, setBuyerReport] = useState<BuyerCostsReport | null>(null);

  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  // Fetch campaigns for dropdown list
  const fetchCampaigns = useCallback(async () => {
    try {
      const response = await apiClient.get<{ data: Campaign[] }>('/api/v1/campaigns?limit=250');
      if (response.data?.data) {
        setCampaigns(response.data.data);
      }
    } catch (error) {
      console.error('Failed to load campaigns list:', error);
    }
  }, []);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        startDate: new Date(startDate).toISOString(),
        endDate: new Date(endDate + 'T23:59:59').toISOString(),
      });
      if (campaignId) {
        query.append('campaignId', campaignId);
      }

      if (activeTab === 'campaign-profitability' && showProfitability) {
        const response = await apiClient.get<CampaignProfitabilityReport>(`/api/v1/reports/profitability?${query.toString()}`);
        if (response.data) setProfitReport(response.data);
      } else if (activeTab === 'publisher-revenue' && showPublisherRevenue) {
        const response = await apiClient.get<PublisherRevenueReport>(`/api/v1/reports/publisher-revenue?${query.toString()}`);
        if (response.data) setPubReport(response.data);
      } else if (activeTab === 'buyer-costs' && showBuyerCosts) {
        const response = await apiClient.get<BuyerCostsReport>(`/api/v1/reports/buyer-costs?${query.toString()}`);
        if (response.data) setBuyerReport(response.data);
      }
    } catch (error) {
      console.error('Failed to fetch financial report:', error);
      toast({
        title: 'Error loading report',
        description: 'Check connectivity or role permissions and try again.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [activeTab, startDate, endDate, campaignId, showProfitability, showPublisherRevenue, showBuyerCosts, toast]);

  useEffect(() => {
    void fetchCampaigns();
  }, [fetchCampaigns]);

  useEffect(() => {
    void fetchReport();
  }, [fetchReport, activeTab]);

  const handlePresetSelect = (preset: string) => {
    setDatePreset(preset);
    let start = getPastDateStr(0);
    let end = getPastDateStr(0);

    switch (preset) {
      case 'today':
        start = getPastDateStr(0);
        break;
      case 'yesterday':
        start = getPastDateStr(1);
        end = getPastDateStr(1);
        break;
      case 'last-7':
        start = getPastDateStr(7);
        break;
      case 'last-30':
        start = getPastDateStr(30);
        break;
      case 'this-month':
        const now = new Date();
        start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
        break;
    }
    setStartDate(start);
    setEndDate(end);
  };

  const handleCsvExport = async () => {
    setExporting(true);
    try {
      const query = new URLSearchParams({
        startDate: new Date(startDate).toISOString(),
        endDate: new Date(endDate + 'T23:59:59').toISOString(),
        format: 'csv'
      });
      if (campaignId) {
        query.append('campaignId', campaignId);
      }

      let endpoint = '';
      let filename = 'report.csv';

      if (activeTab === 'campaign-profitability') {
        endpoint = '/api/v1/reports/profitability';
        filename = `profitability-report-${startDate}-to-${endDate}.csv`;
      } else if (activeTab === 'publisher-revenue') {
        endpoint = '/api/v1/reports/publisher-revenue';
        filename = `publisher-revenue-${startDate}-to-${endDate}.csv`;
      } else if (activeTab === 'buyer-costs') {
        endpoint = '/api/v1/reports/buyer-costs';
        filename = `buyer-costs-${startDate}-to-${endDate}.csv`;
      }

      const response = await apiClient.get<string>(`${endpoint}?${query.toString()}`, {
        responseType: 'text'
      });

      if (response.data) {
        const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        toast({
          title: 'Export Complete',
          description: `Downloaded ${filename} successfully.`,
        });
      }
    } catch (error) {
      console.error('Failed to export CSV:', error);
      toast({
        title: 'Export Failed',
        description: 'An error occurred while compiling the CSV ledger.',
        variant: 'destructive',
      });
    } finally {
      setExporting(false);
    }
  };

  if (isAgent || (!showProfitability && !showPublisherRevenue && !showBuyerCosts)) {
    return (
      <div className="h-full flex items-center justify-center p-8 text-center">
        <p className="text-muted-foreground text-sm max-w-md">
          You do not have the required roles to view billing and financial reports. Please contact your system administrator.
        </p>
      </div>
    );
  }

  return (
    <CompactPageShell>
      <CompactPageHeader
        title="Financial Reports"
        subtitle="Analyze publisher revenue, buyer costs, and campaign profit margins."
      >
        <Button 
          onClick={handleCsvExport} 
          disabled={exporting || loading}
          size="sm"
          className="h-8 text-xs bg-cyan-600 hover:bg-cyan-500 text-white"
        >
          {exporting ? (
            <>
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              Generating CSV...
            </>
          ) : (
            <>
              <Download className="mr-2 h-3.5 w-3.5" />
              Export CSV
            </>
          )}
        </Button>
      </CompactPageHeader>

      {/* Date & Filter Controls Bar */}
      <div className="bg-card border border-border/40 rounded-lg p-2 flex flex-col gap-2.5 md:flex-row md:items-center justify-between flex-shrink-0">
        <div className="flex flex-wrap gap-3 items-center flex-1">
          {/* Start Date */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground uppercase font-semibold">Start:</span>
            <div className="relative">
              <Calendar className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setDatePreset('custom');
                }}
                className="pl-8 h-7 text-xs w-32 bg-background border-border/50 text-foreground"
              />
            </div>
          </div>

          {/* End Date */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground uppercase font-semibold">End:</span>
            <div className="relative">
              <Calendar className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setDatePreset('custom');
                }}
                className="pl-8 h-7 text-xs w-32 bg-background border-border/50 text-foreground"
              />
            </div>
          </div>

          {/* Campaign Select */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground uppercase font-semibold">Campaign:</span>
            <Select value={campaignId || 'all-campaigns'} onValueChange={(val) => setCampaignId(val === 'all-campaigns' ? '' : val)}>
              <SelectTrigger className="h-7 text-xs w-40 bg-background border-border/50 text-foreground">
                <SelectValue placeholder="All Campaigns" />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-white/10 text-white text-xs">
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
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="flex bg-muted/40 p-0.5 rounded border border-border/40">
            {['today', 'yesterday', 'last-7', 'last-30', 'this-month'].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => handlePresetSelect(p)}
                className={cn(
                  'px-2 py-0.5 text-[10px] font-semibold rounded capitalize transition-colors',
                  datePreset === p 
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {p.replace('-', ' ')}
              </button>
            ))}
          </div>

          <Button variant="outline" size="icon" className="h-7 w-7 border-border/40 text-muted-foreground" onClick={fetchReport} disabled={loading}>
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {/* Tabs Layout */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 min-h-0 flex flex-col gap-3">
        <TabsList className="bg-muted/40 p-0.5 border border-border/40 self-start">
          {showProfitability && (
            <TabsTrigger value="campaign-profitability" className="text-xs h-7">Campaign Profitability</TabsTrigger>
          )}
          {showPublisherRevenue && (
            <TabsTrigger value="publisher-revenue" className="text-xs h-7">Publisher Revenue</TabsTrigger>
          )}
          {showBuyerCosts && (
            <TabsTrigger value="buyer-costs" className="text-xs h-7">Buyer Costs</TabsTrigger>
          )}
        </TabsList>

        {/* Tab 1: Campaign Profitability */}
        {showProfitability && (
          <TabsContent value="campaign-profitability" className="m-0 flex-1 min-h-0 flex flex-col gap-2.5 overflow-hidden">
            {/* Quick Metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 flex-shrink-0">
              <div className="rounded border border-border/40 bg-card p-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                  <span>Total Revenue</span>
                  <DollarSign className="h-3 w-3 text-emerald-400" />
                </div>
                <div className="text-base font-bold text-white mt-1">
                  ${profitReport ? Number(profitReport.totals.buyerRevenue).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}
                </div>
              </div>

              <div className="rounded border border-border/40 bg-card p-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                  <span>Publisher Payout</span>
                  <Users className="h-3 w-3 text-amber-400" />
                </div>
                <div className="text-base font-bold text-amber-400 mt-1">
                  ${profitReport ? Number(profitReport.totals.publisherPayout).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}
                </div>
              </div>

              <div className="rounded border border-border/40 bg-card p-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                  <span>Routing Cost</span>
                  <Phone className="h-3 w-3 text-rose-400" />
                </div>
                <div className="text-base font-bold text-rose-400 mt-1">
                  ${profitReport ? Number(profitReport.totals.callCost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}
                </div>
              </div>

              <div className="rounded border border-border/40 bg-card p-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                  <span>Net Profit</span>
                  <TrendingUp className="h-3 w-3 text-emerald-400" />
                </div>
                <div className="text-base font-bold text-emerald-400 mt-1 flex items-baseline justify-between">
                  <span>${profitReport ? Number(profitReport.totals.profit).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}</span>
                  <Badge variant="outline" className={cn(
                    "text-[8px] px-1.5 py-0 border-none",
                    profitReport && profitReport.totals.margin >= 0 ? "text-emerald-400 bg-emerald-500/10" : "text-rose-500 bg-rose-500/10"
                  )}>
                    {profitReport ? (profitReport.totals.margin * 100).toFixed(0) : '0'}% Marg
                  </Badge>
                </div>
              </div>
            </div>

            {/* Detailed Table Card */}
            <Card className="flex-1 min-h-0 flex flex-col overflow-hidden bg-card border-border/40 shadow-sm">
              <CardHeader className="flex-shrink-0 py-2 px-3 border-b border-border/10">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Profit & Margin Ledger</CardTitle>
              </CardHeader>
              <CardContent className="flex-grow min-h-0 overflow-auto p-0">
                <Table className="table-dense">
                  <TableHeader className="sticky top-0 bg-background z-10">
                    <TableRow className="border-b border-border/10">
                      <TableHead>Campaign</TableHead>
                      <TableHead className="text-right">Total Calls</TableHead>
                      <TableHead className="text-right">Connected</TableHead>
                      <TableHead className="text-right">Billable</TableHead>
                      <TableHead className="text-right">Revenue ($)</TableHead>
                      <TableHead className="text-right">Payout ($)</TableHead>
                      <TableHead className="text-right">Call Cost ($)</TableHead>
                      <TableHead className="text-right">Fees ($)</TableHead>
                      <TableHead className="text-right">Profit ($)</TableHead>
                      <TableHead className="text-right">Margin (%)</TableHead>
                      <TableHead className="text-right">Disputes ($)</TableHead>
                      <TableHead className="text-right">Adj ($)</TableHead>
                      <TableHead className="text-right">Net Payable ($)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow>
                        <TableCell colSpan={13} className="text-center py-8">
                          <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                        </TableCell>
                      </TableRow>
                    ) : !profitReport || profitReport.rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={13} className="text-center py-8 text-muted-foreground text-xs">
                          No profit report records found.
                        </TableCell>
                      </TableRow>
                    ) : (
                      <>
                        {profitReport.rows.map((row) => (
                          <TableRow key={row.campaignId} className="hover:bg-muted/30">
                            <TableCell className="font-semibold text-white">{row.campaignName}</TableCell>
                            <TableCell className="text-right tabular-nums">{row.totalCalls}</TableCell>
                            <TableCell className="text-right tabular-nums text-muted-foreground">{row.connectedCalls}</TableCell>
                            <TableCell className="text-right tabular-nums text-cyan-400 font-medium">{row.billableCalls}</TableCell>
                            <TableCell className="text-right tabular-nums text-emerald-400">${Number(row.buyerRevenue).toFixed(2)}</TableCell>
                            <TableCell className="text-right tabular-nums text-amber-400">${Number(row.publisherPayout).toFixed(2)}</TableCell>
                            <TableCell className="text-right tabular-nums text-rose-400">${Number(row.callCost).toFixed(2)}</TableCell>
                            <TableCell className="text-right tabular-nums text-muted-foreground">${Number(row.otherCosts).toFixed(2)}</TableCell>
                            <TableCell className={cn(
                              "text-right tabular-nums font-medium",
                              Number(row.profit) >= 0 ? "text-emerald-400" : "text-rose-400"
                            )}>
                              ${Number(row.profit).toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right">
                              <Badge variant="outline" className={cn(
                                "font-mono text-[9px] px-1 py-0 border-none",
                                row.margin >= 0 ? "text-emerald-400 bg-emerald-500/10" : "text-rose-500 bg-rose-500/10"
                              )}>
                                {(row.margin * 100).toFixed(0)}%
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-amber-400" title={`${row.disputesCount} disputes`}>
                              ${Number(row.disputes).toFixed(2)}
                            </TableCell>
                            <TableCell className={cn(
                              "text-right tabular-nums",
                              Number(row.adjustments) >= 0 ? "text-emerald-400" : "text-rose-400"
                            )}>
                              ${Number(row.adjustments).toFixed(2)}
                            </TableCell>
                            <TableCell className={cn(
                              "text-right tabular-nums font-bold",
                              Number(row.netPayableReceivable) >= 0 ? "text-emerald-400" : "text-rose-500"
                            )}>
                              ${Number(row.netPayableReceivable).toFixed(2)}
                            </TableCell>
                          </TableRow>
                        ))}
                        {/* Totals Row */}
                        <TableRow className="bg-muted/40 font-bold border-t-2 border-border/20 hover:bg-muted/50 text-white">
                          <TableCell>Report Totals</TableCell>
                          <TableCell className="text-right tabular-nums">{profitReport.totals.totalCalls}</TableCell>
                          <TableCell className="text-right tabular-nums">{profitReport.totals.connectedCalls}</TableCell>
                          <TableCell className="text-right tabular-nums text-cyan-400">{profitReport.totals.billableCalls}</TableCell>
                          <TableCell className="text-right tabular-nums text-emerald-400">${Number(profitReport.totals.buyerRevenue).toFixed(2)}</TableCell>
                          <TableCell className="text-right tabular-nums text-amber-400">${Number(profitReport.totals.publisherPayout).toFixed(2)}</TableCell>
                          <TableCell className="text-right tabular-nums text-rose-400">${Number(profitReport.totals.callCost).toFixed(2)}</TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">${Number(profitReport.totals.otherCosts).toFixed(2)}</TableCell>
                          <TableCell className={cn(
                            "text-right tabular-nums",
                            Number(profitReport.totals.profit) >= 0 ? "text-emerald-400" : "text-rose-500"
                          )}>
                            ${Number(profitReport.totals.profit).toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge variant="outline" className={cn(
                              "font-mono text-[9px] px-1.5 py-0 border-none",
                              profitReport.totals.margin >= 0 ? "text-emerald-400 bg-emerald-500/10" : "text-rose-500 bg-rose-500/10"
                            )}>
                              {(profitReport.totals.margin * 100).toFixed(0)}%
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-amber-400">
                            ${Number(profitReport.totals.disputes).toFixed(2)}
                          </TableCell>
                          <TableCell className={cn(
                            "text-right tabular-nums",
                            Number(profitReport.totals.adjustments) >= 0 ? "text-emerald-400" : "text-rose-400"
                          )}>
                            ${Number(profitReport.totals.adjustments).toFixed(2)}
                          </TableCell>
                          <TableCell className={cn(
                            "text-right tabular-nums text-sm font-extrabold",
                            Number(profitReport.totals.netPayableReceivable) >= 0 ? "text-emerald-400" : "text-rose-500"
                          )}>
                            ${Number(profitReport.totals.netPayableReceivable).toFixed(2)}
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
          <TabsContent value="publisher-revenue" className="m-0 flex-1 min-h-0 flex flex-col gap-2.5 overflow-hidden">
            {/* Quick Metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 flex-shrink-0">
              <div className="rounded border border-border/40 bg-card p-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Total Inbound Calls</div>
                <div className="text-base font-bold text-white mt-1">
                  {pubReport ? pubReport.totals.totalCalls.toLocaleString() : '0'}
                </div>
              </div>

              <div className="rounded border border-border/40 bg-card p-2 flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Billable Calls</div>
                  <div className="text-base font-bold text-emerald-400 mt-1">
                    {pubReport ? pubReport.totals.billableCalls.toLocaleString() : '0'}
                  </div>
                </div>
                <Badge variant="outline" className="text-[8px] px-1 py-0 border-none text-emerald-400 bg-emerald-500/10 font-mono">
                  {pubReport && pubReport.totals.totalCalls > 0 ? ((pubReport.totals.billableCalls / pubReport.totals.totalCalls) * 100).toFixed(0) : '0'}% Rate
                </Badge>
              </div>

              <div className="rounded border border-border/40 bg-card p-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Total Earnings</div>
                <div className="text-base font-bold text-emerald-400 mt-1">
                  ${pubReport ? Number(pubReport.totals.publisherRevenue).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}
                </div>
              </div>
            </div>

            {/* Detailed Table Card */}
            <Card className="flex-1 min-h-0 flex flex-col overflow-hidden bg-card border-border/40 shadow-sm">
              <CardHeader className="flex-shrink-0 py-2 px-3 border-b border-border/10">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Publisher Revenue Ledger</CardTitle>
              </CardHeader>
              <CardContent className="flex-grow min-h-0 overflow-auto p-0">
                <Table className="table-dense">
                  <TableHeader className="sticky top-0 bg-background z-10">
                    <TableRow className="border-b border-border/10">
                      <TableHead>Publisher Name</TableHead>
                      <TableHead>Campaign Name</TableHead>
                      <TableHead className="text-right">Total Calls</TableHead>
                      <TableHead className="text-right">Billable Calls</TableHead>
                      <TableHead className="text-right">Non-Billable</TableHead>
                      <TableHead className="text-right">Payout Rate ($)</TableHead>
                      <TableHead className="text-right">Earnings ($)</TableHead>
                      <TableHead className="text-right">Paid ($)</TableHead>
                      <TableHead className="text-right">Pending ($)</TableHead>
                      <TableHead className="text-right">Held/Disputed ($)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow>
                        <TableCell colSpan={10} className="text-center py-8">
                          <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                        </TableCell>
                      </TableRow>
                    ) : !pubReport || pubReport.rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={10} className="text-center py-8 text-muted-foreground text-xs">
                          No publisher revenue records found.
                        </TableCell>
                      </TableRow>
                    ) : (
                      <>
                        {pubReport.rows.map((row, idx) => (
                          <TableRow key={`${row.publisherId}-${row.campaignId}-${idx}`} className="hover:bg-muted/30">
                            <TableCell className="font-semibold text-white">{row.publisherName}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{row.campaignName}</TableCell>
                            <TableCell className="text-right tabular-nums">{row.totalCalls}</TableCell>
                            <TableCell className="text-right tabular-nums text-emerald-400 font-medium">{row.billableCalls}</TableCell>
                            <TableCell className="text-right tabular-nums text-muted-foreground">{row.nonBillableCalls}</TableCell>
                            <TableCell className="text-right tabular-nums font-mono text-xs text-muted-foreground">${Number(row.payoutRate).toFixed(2)}</TableCell>
                            <TableCell className="text-right tabular-nums font-bold text-emerald-400">${Number(row.earnings).toFixed(2)}</TableCell>
                            <TableCell className="text-right tabular-nums text-emerald-400">${Number(row.paid).toFixed(2)}</TableCell>
                            <TableCell className="text-right tabular-nums text-amber-400">${Number(row.pending).toFixed(2)}</TableCell>
                            <TableCell className="text-right tabular-nums text-rose-500">${Number(row.held).toFixed(2)}</TableCell>
                          </TableRow>
                        ))}
                        {/* Totals Row */}
                        <TableRow className="bg-muted/40 font-bold border-t-2 border-border/20 hover:bg-muted/50 text-white">
                          <TableCell colSpan={2}>Report Totals</TableCell>
                          <TableCell className="text-right tabular-nums">{pubReport.totals.totalCalls}</TableCell>
                          <TableCell className="text-right tabular-nums text-emerald-400">{pubReport.totals.billableCalls}</TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {pubReport.totals.nonBillableCalls}
                          </TableCell>
                          <TableCell className="text-right">—</TableCell>
                          <TableCell className="text-right tabular-nums text-lg text-emerald-400">${Number(pubReport.totals.earnings).toFixed(2)}</TableCell>
                          <TableCell className="text-right tabular-nums text-emerald-400">${Number(pubReport.totals.paid).toFixed(2)}</TableCell>
                          <TableCell className="text-right tabular-nums text-amber-400">${Number(pubReport.totals.pending).toFixed(2)}</TableCell>
                          <TableCell className="text-right tabular-nums text-rose-500">${Number(pubReport.totals.held).toFixed(2)}</TableCell>
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
          <TabsContent value="buyer-costs" className="m-0 flex-1 min-h-0 flex flex-col gap-2.5 overflow-hidden">
            {/* Quick Metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 flex-shrink-0">
              <div className="rounded border border-border/40 bg-card p-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Total Inbound Calls</div>
                <div className="text-base font-bold text-white mt-1">
                  {buyerReport ? buyerReport.totals.totalCalls.toLocaleString() : '0'}
                </div>
              </div>

              <div className="rounded border border-border/40 bg-card p-2 flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Billable Calls</div>
                  <div className="text-base font-bold text-emerald-400 mt-1">
                    {buyerReport ? buyerReport.totals.billableCalls.toLocaleString() : '0'}
                  </div>
                </div>
                <Badge variant="outline" className="text-[8px] px-1 py-0 border-none text-emerald-400 bg-emerald-500/10 font-mono">
                  {buyerReport && buyerReport.totals.totalCalls > 0 ? ((buyerReport.totals.billableCalls / buyerReport.totals.totalCalls) * 100).toFixed(0) : '0'}% Conv
                </Badge>
              </div>

              <div className="rounded border border-border/40 bg-card p-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Total Buyer Cost</div>
                <div className="text-base font-bold text-rose-400 mt-1">
                  ${buyerReport ? Number(buyerReport.totals.buyerCost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}
                </div>
              </div>
            </div>

            {/* Detailed Table Card */}
            <Card className="flex-1 min-h-0 flex flex-col overflow-hidden bg-card border-border/40 shadow-sm">
              <CardHeader className="flex-shrink-0 py-2 px-3 border-b border-border/10">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Buyer Costs Ledger</CardTitle>
              </CardHeader>
              <CardContent className="flex-grow min-h-0 overflow-auto p-0">
                <Table className="table-dense">
                  <TableHeader className="sticky top-0 bg-background z-10">
                    <TableRow className="border-b border-border/10">
                      <TableHead>Buyer Name</TableHead>
                      <TableHead>Campaign Name</TableHead>
                      <TableHead>Destination DID</TableHead>
                      <TableHead className="text-right">Total Calls</TableHead>
                      <TableHead className="text-right">Billable Calls</TableHead>
                      <TableHead className="text-right">Billable (%)</TableHead>
                      <TableHead className="text-right">Avg Duration</TableHead>
                      <TableHead className="text-right">Rate ($)</TableHead>
                      <TableHead className="text-right">Cost ($)</TableHead>
                      <TableHead className="text-right">Wallet Debits ($)</TableHead>
                      <TableHead className="text-right">Invoiced ($)</TableHead>
                      <TableHead className="text-right">Pending Invoice ($)</TableHead>
                      <TableHead className="text-right">Disputes ($)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow>
                        <TableCell colSpan={13} className="text-center py-8">
                          <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                        </TableCell>
                      </TableRow>
                    ) : !buyerReport || buyerReport.rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={13} className="text-center py-8 text-muted-foreground text-xs">
                          No buyer cost records found.
                        </TableCell>
                      </TableRow>
                    ) : (
                      <>
                        {buyerReport.rows.map((row, idx) => (
                          <TableRow key={`${row.buyerId}-${row.campaignId}-${idx}`} className="hover:bg-muted/30">
                            <TableCell className="font-semibold text-white">{row.buyerName}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{row.campaignName}</TableCell>
                            <TableCell className="font-mono text-[10px] font-semibold">{row.destinationNumber}</TableCell>
                            <TableCell className="text-right tabular-nums">{row.totalCalls}</TableCell>
                            <TableCell className="text-right tabular-nums text-emerald-400 font-medium">{row.billableCalls}</TableCell>
                            <TableCell className="text-right tabular-nums text-xs">
                              {(row.billableRate * 100).toFixed(0)}%
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                              {Math.round(row.averageDuration)}s
                            </TableCell>
                            <TableCell className="text-right tabular-nums font-mono text-xs text-muted-foreground">${Number(row.pricePerBillableCall).toFixed(2)}</TableCell>
                            <TableCell className="text-right tabular-nums font-bold text-rose-400">${Number(row.buyerCost).toFixed(2)}</TableCell>
                            <TableCell className="text-right tabular-nums text-rose-400">${Number(row.walletDebits).toFixed(2)}</TableCell>
                            <TableCell className="text-right tabular-nums text-emerald-400">${Number(row.invoiced).toFixed(2)}</TableCell>
                            <TableCell className="text-right tabular-nums text-amber-400">${Number(row.pendingInvoice).toFixed(2)}</TableCell>
                            <TableCell className="text-right tabular-nums text-rose-500">${Number(row.disputes).toFixed(2)}</TableCell>
                          </TableRow>
                        ))}
                        {/* Totals Row */}
                        <TableRow className="bg-muted/40 font-bold border-t-2 border-border/20 hover:bg-muted/50 text-white">
                          <TableCell colSpan={3}>Report Totals</TableCell>
                          <TableCell className="text-right tabular-nums">{buyerReport.totals.totalCalls}</TableCell>
                          <TableCell className="text-right tabular-nums text-emerald-400">{buyerReport.totals.billableCalls}</TableCell>
                          <TableCell className="text-right tabular-nums text-xs">
                            {buyerReport.totals.totalCalls > 0 ? ((buyerReport.totals.billableCalls / buyerReport.totals.totalCalls) * 100).toFixed(0) : '0'}%
                          </TableCell>
                          <TableCell className="text-right">—</TableCell>
                          <TableCell className="text-right">—</TableCell>
                          <TableCell className="text-right tabular-nums text-lg text-rose-400">${Number(buyerReport.totals.buyerCost).toFixed(2)}</TableCell>
                          <TableCell className="text-right tabular-nums text-rose-400">${Number(buyerReport.totals.walletDebits).toFixed(2)}</TableCell>
                          <TableCell className="text-right tabular-nums text-emerald-400">${Number(buyerReport.totals.invoiced).toFixed(2)}</TableCell>
                          <TableCell className="text-right tabular-nums text-amber-400">${Number(buyerReport.totals.pendingInvoice).toFixed(2)}</TableCell>
                          <TableCell className="text-right tabular-nums text-rose-500">${Number(buyerReport.totals.disputes).toFixed(2)}</TableCell>
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
    </CompactPageShell>
  );
}

import { RoleGuard } from '@/components/auth/role-guard';

export default function GuardedReportsPage() {
  return (
    <RoleGuard allowedRoles={['ADMIN', 'OWNER', 'READONLY', 'ANALYST']} allowedPermissions={['reports:read']}>
      <ReportsPage />
    </RoleGuard>
  );
}
