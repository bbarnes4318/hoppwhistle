'use client';

import {
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

import { RoleGuard } from '@/components/auth/role-guard';
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/domain';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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

  const isPublisher =
    user?.roles.includes('PUBLISHER') &&
    !user?.roles.includes('ADMIN') &&
    !user?.roles.includes('OWNER');
  const isBuyer =
    user?.roles.includes('BUYER') &&
    !user?.roles.includes('ADMIN') &&
    !user?.roles.includes('OWNER');
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
        const response = await apiClient.get<CampaignProfitabilityReport>(
          `/api/v1/reports/campaign-profitability?${query.toString()}`
        );
        if (response.data) setProfitReport(response.data);
      } else if (activeTab === 'publisher-revenue' && showPublisherRevenue) {
        const response = await apiClient.get<PublisherRevenueReport>(
          `/api/v1/reports/publisher-revenue?${query.toString()}`
        );
        if (response.data) setPubReport(response.data);
      } else if (activeTab === 'buyer-costs' && showBuyerCosts) {
        const response = await apiClient.get<BuyerCostsReport>(
          `/api/v1/reports/buyer-costs?${query.toString()}`
        );
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
  }, [
    activeTab,
    startDate,
    endDate,
    campaignId,
    showProfitability,
    showPublisherRevenue,
    showBuyerCosts,
    toast,
  ]);

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
      case 'this-month': {
        const now = new Date();
        start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
        break;
      }
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
      });
      if (campaignId) {
        query.append('campaignId', campaignId);
      }

      // Each tab exports from its own route. A chain of ifs left `endpoint`
      // empty for any tab not in the list, and the export then asked the
      // portal itself for `/?startDate=…` — a 404 reported as "an error
      // occurred". A table cannot be half-assigned, and an unknown tab now
      // says so instead of requesting nothing.
      //
      // Each one is the report's `/export.csv` route. They used to be the JSON
      // routes with `format=csv` added, which none of them reads: two tabs
      // saved a JSON body under a .csv name, and Campaign Profitability asked
      // for `/reports/profitability`, which the API has never registered.
      // `app/__tests__/reports-api-paths.test.ts` checks every path here
      // against the routes the API actually registers.
      const EXPORTS: Record<string, { endpoint: string; prefix: string }> = {
        'campaign-profitability': {
          endpoint: '/api/v1/reports/campaign-profitability/export.csv',
          prefix: 'profitability-report',
        },
        'publisher-revenue': {
          endpoint: '/api/v1/reports/publisher-revenue/export.csv',
          prefix: 'publisher-revenue',
        },
        'buyer-costs': {
          endpoint: '/api/v1/reports/buyer-costs/export.csv',
          prefix: 'buyer-costs',
        },
      };

      const target = EXPORTS[activeTab];
      if (!target) {
        toast({
          title: 'Nothing to export',
          description: 'This report has no CSV export.',
          variant: 'destructive',
        });
        return;
      }

      const filename = `${target.prefix}-${startDate}-to-${endDate}.csv`;

      const response = await apiClient.get<string>(`${target.endpoint}?${query.toString()}`, {
        responseType: 'text',
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
      <div className="page-canvas items-center text-center">
        <p className="t-body max-w-md text-ink-3">
          You do not have the required roles to view billing and financial reports. Please contact
          your system administrator.
        </p>
      </div>
    );
  }

  return (
    <div className="page-canvas">
      <PageHeader
        description="Analyze publisher revenue, buyer costs, and campaign profit margins."
        actions={
          <Button onClick={() => void handleCsvExport()} disabled={exporting || loading} size="sm">
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
        }
      />

      {/* Date & Filter Controls Bar */}
      <div className="bg-surface border border-rule rounded-card shadow-card p-2 flex flex-col gap-2.5 md:flex-row md:items-center justify-between flex-shrink-0">
        <div className="flex flex-wrap gap-3 items-center flex-1">
          {/* Start Date */}
          <div className="flex items-center gap-1.5">
            <span className="t-label text-ink-3">Start:</span>
            <div className="relative">
              <Calendar className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3" />
              <Input
                type="date"
                value={startDate}
                onChange={e => {
                  setStartDate(e.target.value);
                  setDatePreset('custom');
                }}
                className="pl-8 h-7 text-xs w-32 border-rule text-ink"
              />
            </div>
          </div>

          {/* End Date */}
          <div className="flex items-center gap-1.5">
            <span className="t-label text-ink-3">End:</span>
            <div className="relative">
              <Calendar className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3" />
              <Input
                type="date"
                value={endDate}
                onChange={e => {
                  setEndDate(e.target.value);
                  setDatePreset('custom');
                }}
                className="pl-8 h-7 text-xs w-32 border-rule text-ink"
              />
            </div>
          </div>

          {/* Campaign Select */}
          <div className="flex items-center gap-1.5">
            <span className="t-label text-ink-3">Campaign:</span>
            <Select
              value={campaignId || 'all-campaigns'}
              onValueChange={val => setCampaignId(val === 'all-campaigns' ? '' : val)}
            >
              <SelectTrigger className="h-7 text-xs w-40 border-rule text-ink">
                <SelectValue placeholder="All Campaigns" />
              </SelectTrigger>
              <SelectContent className="bg-surface border-rule text-ink text-xs">
                <SelectItem value="all-campaigns">All Campaigns</SelectItem>
                {campaigns.map(c => (
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
          <div className="flex bg-sunken p-0.5 rounded border border-rule">
            {['today', 'yesterday', 'last-7', 'last-30', 'this-month'].map(p => (
              <button
                key={p}
                type="button"
                onClick={() => handlePresetSelect(p)}
                className={cn(
                  't-meta px-2 py-0.5 font-medium rounded capitalize transition-colors',
                  datePreset === p ? 'bg-surface text-ink shadow-card' : 'text-ink-3 hover:text-ink'
                )}
              >
                {p.replace('-', ' ')}
              </button>
            ))}
          </div>

          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7 border-rule text-ink-3"
            aria-label="Refresh report"
            onClick={() => void fetchReport()}
            disabled={loading}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {/* Tabs Layout */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full flex flex-col gap-3">
        <TabsList className="bg-sunken p-0.5 border border-rule self-start">
          {showProfitability && (
            <TabsTrigger value="campaign-profitability" className="text-xs h-7">
              Campaign Profitability
            </TabsTrigger>
          )}
          {showPublisherRevenue && (
            <TabsTrigger value="publisher-revenue" className="text-xs h-7">
              Publisher Revenue
            </TabsTrigger>
          )}
          {showBuyerCosts && (
            <TabsTrigger value="buyer-costs" className="text-xs h-7">
              Buyer Costs
            </TabsTrigger>
          )}
        </TabsList>

        {/* Tab 1: Campaign Profitability */}
        {showProfitability && (
          <TabsContent value="campaign-profitability" className="m-0 w-full flex flex-col gap-2.5">
            {/* Quick Metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 flex-shrink-0">
              <div className="rounded-card border border-rule bg-surface shadow-card p-3">
                <div className="t-label text-ink-3 flex items-center justify-between">
                  <span>Total Revenue</span>
                  <DollarSign className="h-3 w-3 text-live-ink" />
                </div>
                <div className="text-base font-bold text-ink mt-1">
                  $
                  {profitReport
                    ? Number(profitReport.totals.buyerRevenue).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })
                    : '0.00'}
                </div>
              </div>

              <div className="rounded-card border border-rule bg-surface shadow-card p-3">
                <div className="t-label text-ink-3 flex items-center justify-between">
                  <span>Publisher Payout</span>
                  <Users className="h-3 w-3 text-ringing-ink" />
                </div>
                <div className="text-base font-bold text-ringing-ink mt-1">
                  $
                  {profitReport
                    ? Number(profitReport.totals.publisherPayout).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })
                    : '0.00'}
                </div>
              </div>

              <div className="rounded-card border border-rule bg-surface shadow-card p-3">
                <div className="t-label text-ink-3 flex items-center justify-between">
                  <span>Routing Cost</span>
                  <Phone className="h-3 w-3 text-dropped-ink" />
                </div>
                <div className="text-base font-bold text-dropped-ink mt-1">
                  $
                  {profitReport
                    ? Number(profitReport.totals.callCost).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })
                    : '0.00'}
                </div>
              </div>

              <div className="rounded-card border border-rule bg-surface shadow-card p-3">
                <div className="t-label text-ink-3 flex items-center justify-between">
                  <span>Net Profit</span>
                  <TrendingUp className="h-3 w-3 text-live-ink" />
                </div>
                <div className="text-base font-bold text-live-ink mt-1 flex items-baseline justify-between">
                  <span>
                    $
                    {profitReport
                      ? Number(profitReport.totals.profit).toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })
                      : '0.00'}
                  </span>
                  <Badge
                    variant="outline"
                    className={cn(
                      't-meta px-1.5 py-0 border-none',
                      profitReport && profitReport.totals.margin >= 0
                        ? 'text-live-ink bg-live-tint'
                        : 'text-dropped-ink bg-dropped-tint'
                    )}
                  >
                    {profitReport ? (profitReport.totals.margin * 100).toFixed(0) : '0'}% Marg
                  </Badge>
                </div>
              </div>
            </div>

            {/* Detailed Table Card */}
            <Panel className="min-w-0 overflow-hidden">
              <PanelHeader>
                <PanelTitle>Profit & Margin Ledger</PanelTitle>
              </PanelHeader>
              <PanelBody flush>
                <Table>
                  <TableHeader>
                    <TableRow>
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
                          <Loader2 className="h-6 w-6 animate-spin mx-auto text-ink-3" />
                        </TableCell>
                      </TableRow>
                    ) : !profitReport || profitReport.rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={13} className="t-meta text-center py-8 text-ink-3">
                          No profit report records found.
                        </TableCell>
                      </TableRow>
                    ) : (
                      <>
                        {profitReport.rows.map(row => (
                          <TableRow key={row.campaignId}>
                            <TableCell className="font-semibold text-ink">
                              {row.campaignName}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {row.totalCalls}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-ink-3">
                              {row.connectedCalls}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-money-ink font-medium">
                              {row.billableCalls}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-live-ink">
                              ${Number(row.buyerRevenue).toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-ringing-ink">
                              ${Number(row.publisherPayout).toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-dropped-ink">
                              ${Number(row.callCost).toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-ink-3">
                              ${Number(row.otherCosts).toFixed(2)}
                            </TableCell>
                            <TableCell
                              className={cn(
                                'text-right tabular-nums font-medium',
                                Number(row.profit) >= 0 ? 'text-live-ink' : 'text-dropped-ink'
                              )}
                            >
                              ${Number(row.profit).toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right">
                              <Badge
                                variant="outline"
                                className={cn(
                                  't-meta tabular px-1 py-0 border-none',
                                  row.margin >= 0
                                    ? 'text-live-ink bg-live-tint'
                                    : 'text-dropped-ink bg-dropped-tint'
                                )}
                              >
                                {(row.margin * 100).toFixed(0)}%
                              </Badge>
                            </TableCell>
                            <TableCell
                              className="text-right tabular-nums text-ringing-ink"
                              title={`${row.disputesCount} disputes`}
                            >
                              ${Number(row.disputes).toFixed(2)}
                            </TableCell>
                            <TableCell
                              className={cn(
                                'text-right tabular-nums',
                                Number(row.adjustments) >= 0 ? 'text-live-ink' : 'text-dropped-ink'
                              )}
                            >
                              ${Number(row.adjustments).toFixed(2)}
                            </TableCell>
                            <TableCell
                              className={cn(
                                'text-right tabular-nums font-bold',
                                Number(row.netPayableReceivable) >= 0
                                  ? 'text-live-ink'
                                  : 'text-dropped-ink'
                              )}
                            >
                              ${Number(row.netPayableReceivable).toFixed(2)}
                            </TableCell>
                          </TableRow>
                        ))}
                        {/* Totals Row */}
                        <TableRow className="bg-sunken font-bold border-t-2 border-rule text-ink">
                          <TableCell>Report Totals</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {profitReport.totals.totalCalls}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {profitReport.totals.connectedCalls}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-money-ink">
                            {profitReport.totals.billableCalls}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-live-ink">
                            ${Number(profitReport.totals.buyerRevenue).toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-ringing-ink">
                            ${Number(profitReport.totals.publisherPayout).toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-dropped-ink">
                            ${Number(profitReport.totals.callCost).toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-ink-3">
                            ${Number(profitReport.totals.otherCosts).toFixed(2)}
                          </TableCell>
                          <TableCell
                            className={cn(
                              'text-right tabular-nums',
                              Number(profitReport.totals.profit) >= 0
                                ? 'text-live-ink'
                                : 'text-dropped-ink'
                            )}
                          >
                            ${Number(profitReport.totals.profit).toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge
                              variant="outline"
                              className={cn(
                                't-meta tabular px-1.5 py-0 border-none',
                                profitReport.totals.margin >= 0
                                  ? 'text-live-ink bg-live-tint'
                                  : 'text-dropped-ink bg-dropped-tint'
                              )}
                            >
                              {(profitReport.totals.margin * 100).toFixed(0)}%
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-ringing-ink">
                            ${Number(profitReport.totals.disputes).toFixed(2)}
                          </TableCell>
                          <TableCell
                            className={cn(
                              'text-right tabular-nums',
                              Number(profitReport.totals.adjustments) >= 0
                                ? 'text-live-ink'
                                : 'text-dropped-ink'
                            )}
                          >
                            ${Number(profitReport.totals.adjustments).toFixed(2)}
                          </TableCell>
                          <TableCell
                            className={cn(
                              'text-right tabular-nums font-extrabold',
                              Number(profitReport.totals.netPayableReceivable) >= 0
                                ? 'text-live-ink'
                                : 'text-dropped-ink'
                            )}
                          >
                            ${Number(profitReport.totals.netPayableReceivable).toFixed(2)}
                          </TableCell>
                        </TableRow>
                      </>
                    )}
                  </TableBody>
                </Table>
              </PanelBody>
            </Panel>
          </TabsContent>
        )}

        {/* Tab 2: Publisher Revenue */}
        {showPublisherRevenue && (
          <TabsContent value="publisher-revenue" className="m-0 w-full flex flex-col gap-2.5">
            {/* Quick Metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 flex-shrink-0">
              <div className="rounded-card border border-rule bg-surface shadow-card p-3">
                <div className="t-label text-ink-3">Total Inbound Calls</div>
                <div className="text-base font-bold text-ink mt-1">
                  {pubReport ? pubReport.totals.totalCalls.toLocaleString() : '0'}
                </div>
              </div>

              <div className="rounded-card border border-rule bg-surface shadow-card p-3 flex items-center justify-between">
                <div>
                  <div className="t-label text-ink-3">Billable Calls</div>
                  <div className="text-base font-bold text-live-ink mt-1">
                    {pubReport ? pubReport.totals.billableCalls.toLocaleString() : '0'}
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className="t-meta tabular px-1 py-0 border-none text-live-ink bg-live-tint"
                >
                  {pubReport && pubReport.totals.totalCalls > 0
                    ? (
                        (pubReport.totals.billableCalls / pubReport.totals.totalCalls) *
                        100
                      ).toFixed(0)
                    : '0'}
                  % Rate
                </Badge>
              </div>

              <div className="rounded-card border border-rule bg-surface shadow-card p-3">
                <div className="t-label text-ink-3">Total Earnings</div>
                <div className="text-base font-bold text-live-ink mt-1">
                  $
                  {pubReport
                    ? Number(pubReport.totals.publisherRevenue).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })
                    : '0.00'}
                </div>
              </div>
            </div>

            {/* Detailed Table Card */}
            <Panel className="min-w-0 overflow-hidden">
              <PanelHeader>
                <PanelTitle>Publisher Revenue Ledger</PanelTitle>
              </PanelHeader>
              <PanelBody flush>
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
                      <TableHead className="text-right">Paid ($)</TableHead>
                      <TableHead className="text-right">Pending ($)</TableHead>
                      <TableHead className="text-right">Held/Disputed ($)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow>
                        <TableCell colSpan={10} className="text-center py-8">
                          <Loader2 className="h-6 w-6 animate-spin mx-auto text-ink-3" />
                        </TableCell>
                      </TableRow>
                    ) : !pubReport || pubReport.rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={10} className="t-meta text-center py-8 text-ink-3">
                          No publisher revenue records found.
                        </TableCell>
                      </TableRow>
                    ) : (
                      <>
                        {pubReport.rows.map((row, idx) => (
                          <TableRow key={`${row.publisherId}-${row.campaignId}-${idx}`}>
                            <TableCell className="font-semibold text-ink">
                              {row.publisherName}
                            </TableCell>
                            <TableCell className="text-xs text-ink-3">{row.campaignName}</TableCell>
                            <TableCell className="text-right tabular-nums">
                              {row.totalCalls}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-live-ink font-medium">
                              {row.billableCalls}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-ink-3">
                              {row.nonBillableCalls}
                            </TableCell>
                            <TableCell className="text-right tabular-nums font-mono text-xs text-ink-3">
                              ${Number(row.payoutRate).toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums font-bold text-live-ink">
                              ${Number(row.earnings).toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-live-ink">
                              ${Number(row.paid).toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-ringing-ink">
                              ${Number(row.pending).toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-dropped-ink">
                              ${Number(row.held).toFixed(2)}
                            </TableCell>
                          </TableRow>
                        ))}
                        {/* Totals Row */}
                        <TableRow className="bg-sunken font-bold border-t-2 border-rule text-ink">
                          <TableCell colSpan={2}>Report Totals</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {pubReport.totals.totalCalls}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-live-ink">
                            {pubReport.totals.billableCalls}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-ink-3">
                            {pubReport.totals.nonBillableCalls}
                          </TableCell>
                          <TableCell className="text-right">—</TableCell>
                          <TableCell className="text-right tabular-nums text-lg text-live-ink">
                            ${Number(pubReport.totals.earnings).toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-live-ink">
                            ${Number(pubReport.totals.paid).toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-ringing-ink">
                            ${Number(pubReport.totals.pending).toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-dropped-ink">
                            ${Number(pubReport.totals.held).toFixed(2)}
                          </TableCell>
                        </TableRow>
                      </>
                    )}
                  </TableBody>
                </Table>
              </PanelBody>
            </Panel>
          </TabsContent>
        )}

        {/* Tab 3: Buyer Costs */}
        {showBuyerCosts && (
          <TabsContent value="buyer-costs" className="m-0 w-full flex flex-col gap-2.5">
            {/* Quick Metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 flex-shrink-0">
              <div className="rounded-card border border-rule bg-surface shadow-card p-3">
                <div className="t-label text-ink-3">Total Inbound Calls</div>
                <div className="text-base font-bold text-ink mt-1">
                  {buyerReport ? buyerReport.totals.totalCalls.toLocaleString() : '0'}
                </div>
              </div>

              <div className="rounded-card border border-rule bg-surface shadow-card p-3 flex items-center justify-between">
                <div>
                  <div className="t-label text-ink-3">Billable Calls</div>
                  <div className="text-base font-bold text-live-ink mt-1">
                    {buyerReport ? buyerReport.totals.billableCalls.toLocaleString() : '0'}
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className="t-meta tabular px-1 py-0 border-none text-live-ink bg-live-tint"
                >
                  {buyerReport && buyerReport.totals.totalCalls > 0
                    ? (
                        (buyerReport.totals.billableCalls / buyerReport.totals.totalCalls) *
                        100
                      ).toFixed(0)
                    : '0'}
                  % Conv
                </Badge>
              </div>

              <div className="rounded-card border border-rule bg-surface shadow-card p-3">
                <div className="t-label text-ink-3">Total Buyer Cost</div>
                <div className="text-base font-bold text-dropped-ink mt-1">
                  $
                  {buyerReport
                    ? Number(buyerReport.totals.buyerCost).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })
                    : '0.00'}
                </div>
              </div>
            </div>

            {/* Detailed Table Card */}
            <Panel className="min-w-0 overflow-hidden">
              <PanelHeader>
                <PanelTitle>Buyer Costs Ledger</PanelTitle>
              </PanelHeader>
              <PanelBody flush>
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
                          <Loader2 className="h-6 w-6 animate-spin mx-auto text-ink-3" />
                        </TableCell>
                      </TableRow>
                    ) : !buyerReport || buyerReport.rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={13} className="t-meta text-center py-8 text-ink-3">
                          No buyer cost records found.
                        </TableCell>
                      </TableRow>
                    ) : (
                      <>
                        {buyerReport.rows.map((row, idx) => (
                          <TableRow key={`${row.buyerId}-${row.campaignId}-${idx}`}>
                            <TableCell className="font-semibold text-ink">
                              {row.buyerName}
                            </TableCell>
                            <TableCell className="text-xs text-ink-3">{row.campaignName}</TableCell>
                            <TableCell className="t-data">{row.destinationNumber}</TableCell>
                            <TableCell className="text-right tabular-nums">
                              {row.totalCalls}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-live-ink font-medium">
                              {row.billableCalls}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-xs">
                              {(row.billableRate * 100).toFixed(0)}%
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-xs text-ink-3">
                              {Math.round(row.averageDuration)}s
                            </TableCell>
                            <TableCell className="text-right tabular-nums font-mono text-xs text-ink-3">
                              ${Number(row.pricePerBillableCall).toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums font-bold text-dropped-ink">
                              ${Number(row.buyerCost).toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-dropped-ink">
                              ${Number(row.walletDebits).toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-live-ink">
                              ${Number(row.invoiced).toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-ringing-ink">
                              ${Number(row.pendingInvoice).toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-dropped-ink">
                              ${Number(row.disputes).toFixed(2)}
                            </TableCell>
                          </TableRow>
                        ))}
                        {/* Totals Row */}
                        <TableRow className="bg-sunken font-bold border-t-2 border-rule text-ink">
                          <TableCell colSpan={3}>Report Totals</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {buyerReport.totals.totalCalls}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-live-ink">
                            {buyerReport.totals.billableCalls}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-xs">
                            {buyerReport.totals.totalCalls > 0
                              ? (
                                  (buyerReport.totals.billableCalls /
                                    buyerReport.totals.totalCalls) *
                                  100
                                ).toFixed(0)
                              : '0'}
                            %
                          </TableCell>
                          <TableCell className="text-right">—</TableCell>
                          <TableCell className="text-right">—</TableCell>
                          <TableCell className="text-right tabular-nums text-lg text-dropped-ink">
                            ${Number(buyerReport.totals.buyerCost).toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-dropped-ink">
                            ${Number(buyerReport.totals.walletDebits).toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-live-ink">
                            ${Number(buyerReport.totals.invoiced).toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-ringing-ink">
                            ${Number(buyerReport.totals.pendingInvoice).toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-dropped-ink">
                            ${Number(buyerReport.totals.disputes).toFixed(2)}
                          </TableCell>
                        </TableRow>
                      </>
                    )}
                  </TableBody>
                </Table>
              </PanelBody>
            </Panel>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

export default function GuardedReportsPage() {
  return (
    <RoleGuard
      allowedRoles={['ADMIN', 'OWNER', 'READONLY', 'ANALYST']}
      allowedPermissions={['reports:read']}
    >
      <ReportsPage />
    </RoleGuard>
  );
}
