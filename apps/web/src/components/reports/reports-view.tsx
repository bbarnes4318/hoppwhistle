'use client';

import { Download, Loader2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { RoleGuard } from '@/components/auth/role-guard';
import {
  Dollars,
  Panel,
  PanelBody,
  PanelHeader,
  PanelTitle,
  StatTile,
  tileDollars,
} from '@/components/domain';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { PeriodToolbar, usePeriod } from '@/components/white-label/period-toolbar';
import { useAuth } from '@/hooks/use-auth';
import { apiClient } from '@/lib/api';
import { cn } from '@/lib/utils';

/** A report total for a tile: whole dollars from $1,000, zero until the report loads. */
function reportDollars(value: number | string | null | undefined): string {
  return tileDollars(value === null || value === undefined ? 0 : Number(value));
}

/**
 * The period part of an export's file name: the custom range's two days, or
 * the period's name. Never a date the browser computed.
 */
export function reportFileSpan(period: string, from: string, to: string): string {
  return period === 'CUSTOM' ? `${from}-to-${to}` : period.toLowerCase().replace(/_/g, '-');
}

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

  // Filter States. The period is a name the server resolves in New York days,
  // the same picker the Revenue overview uses; the browser computes no range.
  const periodState = usePeriod('THIS_MONTH');
  const { sendable: periodSendable, query: periodParams } = periodState;
  const [campaignId, setCampaignId] = useState('');

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
    if (!periodSendable) return;
    setLoading(true);
    try {
      const query = new URLSearchParams(periodParams);
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
    periodSendable,
    periodParams,
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

  const handleCsvExport = async () => {
    setExporting(true);
    try {
      const query = new URLSearchParams(periodParams);
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

      const filename = `${target.prefix}-${reportFileSpan(
        periodState.period,
        periodState.from,
        periodState.to
      )}.csv`;

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

      {/* Period & filter controls: the Revenue overview's toolbar */}
      <PeriodToolbar state={periodState} resolved={null} label="Report filters">
        <Select
          value={campaignId || 'all-campaigns'}
          onValueChange={val => setCampaignId(val === 'all-campaigns' ? '' : val)}
        >
          <SelectTrigger className="h-7 w-40 border-rule text-xs text-ink" aria-label="Campaign">
            <SelectValue placeholder="All Campaigns" />
          </SelectTrigger>
          <SelectContent className="border-rule bg-surface text-xs text-ink">
            <SelectItem value="all-campaigns">All Campaigns</SelectItem>
            {campaigns.map(c => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7 border-rule text-ink-3"
          aria-label="Refresh report"
          onClick={() => void fetchReport()}
          disabled={loading || !periodSendable}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
        </Button>
      </PeriodToolbar>

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
            {/* The report's four figures */}
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatTile
                size="hero"
                label="Revenue"
                tone="money"
                figure={reportDollars(profitReport?.totals.buyerRevenue)}
              />
              <StatTile
                size="hero"
                label="Publisher payout"
                figure={reportDollars(profitReport?.totals.publisherPayout)}
              />
              <StatTile
                size="hero"
                label="Routing cost"
                figure={reportDollars(profitReport?.totals.callCost)}
              />
              <StatTile
                size="hero"
                label="Net profit"
                tone="money"
                figure={reportDollars(profitReport?.totals.profit)}
                sub={
                  profitReport
                    ? `${(profitReport.totals.margin * 100).toFixed(0)}% margin`
                    : undefined
                }
              />
            </div>

            {/* Detailed Table Card */}
            <Panel className="min-w-0 overflow-hidden">
              <PanelHeader>
                <PanelTitle>Profit and margin by campaign</PanelTitle>
              </PanelHeader>
              <PanelBody flush>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Campaign</TableHead>
                      <TableHead className="text-right">Calls</TableHead>
                      <TableHead className="text-right">Connected</TableHead>
                      <TableHead className="text-right">Billable</TableHead>
                      <TableHead className="text-right">Revenue</TableHead>
                      <TableHead className="text-right">Payout</TableHead>
                      <TableHead className="text-right">Call cost</TableHead>
                      <TableHead className="text-right">Fees</TableHead>
                      <TableHead className="text-right">Profit</TableHead>
                      <TableHead className="text-right">Margin</TableHead>
                      <TableHead className="text-right">Disputes</TableHead>
                      <TableHead className="text-right">Adjustments</TableHead>
                      <TableHead className="text-right">Net payable</TableHead>
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
                            <TableCell className="text-right tabular-nums font-medium">
                              {row.billableCalls}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              <Dollars value={Number(row.buyerRevenue)} />
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              <Dollars value={Number(row.publisherPayout)} />
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              <Dollars value={Number(row.callCost)} />
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-ink-3">
                              <Dollars value={Number(row.otherCosts)} />
                            </TableCell>
                            <TableCell
                              className={cn(
                                'text-right tabular-nums font-medium',
                                Number(row.profit) < 0 && 'text-dropped-ink'
                              )}
                            >
                              <Dollars value={Number(row.profit)} />
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
                              className="text-right tabular-nums"
                              title={`${row.disputesCount} disputes`}
                            >
                              <Dollars value={Number(row.disputes)} />
                            </TableCell>
                            <TableCell
                              className={cn(
                                'text-right tabular-nums',
                                Number(row.adjustments) < 0 && 'text-dropped-ink'
                              )}
                            >
                              <Dollars value={Number(row.adjustments)} />
                            </TableCell>
                            <TableCell
                              className={cn(
                                'text-right tabular-nums font-bold',
                                Number(row.netPayableReceivable) < 0 && 'text-dropped-ink'
                              )}
                            >
                              <Dollars value={Number(row.netPayableReceivable)} />
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
                          <TableCell className="text-right tabular-nums">
                            {profitReport.totals.billableCalls}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            <Dollars value={Number(profitReport.totals.buyerRevenue)} />
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            <Dollars value={Number(profitReport.totals.publisherPayout)} />
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            <Dollars value={Number(profitReport.totals.callCost)} />
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-ink-3">
                            <Dollars value={Number(profitReport.totals.otherCosts)} />
                          </TableCell>
                          <TableCell
                            className={cn(
                              'text-right tabular-nums',
                              Number(profitReport.totals.profit) < 0 && 'text-dropped-ink'
                            )}
                          >
                            <Dollars value={Number(profitReport.totals.profit)} />
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
                          <TableCell className="text-right tabular-nums">
                            <Dollars value={Number(profitReport.totals.disputes)} />
                          </TableCell>
                          <TableCell
                            className={cn(
                              'text-right tabular-nums',
                              Number(profitReport.totals.adjustments) < 0 && 'text-dropped-ink'
                            )}
                          >
                            <Dollars value={Number(profitReport.totals.adjustments)} />
                          </TableCell>
                          <TableCell
                            className={cn(
                              'text-right tabular-nums font-extrabold',
                              Number(profitReport.totals.netPayableReceivable) < 0 &&
                                'text-dropped-ink'
                            )}
                          >
                            <Dollars value={Number(profitReport.totals.netPayableReceivable)} />
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
            {/* The report's three figures */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatTile
                size="hero"
                label="Inbound calls"
                figure={(pubReport?.totals.totalCalls ?? 0).toLocaleString()}
              />
              <StatTile
                size="hero"
                label="Billable calls"
                figure={(pubReport?.totals.billableCalls ?? 0).toLocaleString()}
                sub={
                  pubReport && pubReport.totals.totalCalls > 0
                    ? `${((pubReport.totals.billableCalls / pubReport.totals.totalCalls) * 100).toFixed(0)}% of inbound`
                    : undefined
                }
              />
              <StatTile
                size="hero"
                label="Publisher earnings"
                tone="money"
                figure={reportDollars(pubReport?.totals.publisherRevenue)}
              />
            </div>

            {/* Detailed Table Card */}
            <Panel className="min-w-0 overflow-hidden">
              <PanelHeader>
                <PanelTitle>Publisher earnings by campaign</PanelTitle>
              </PanelHeader>
              <PanelBody flush>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Publisher</TableHead>
                      <TableHead>Campaign</TableHead>
                      <TableHead className="text-right">Calls</TableHead>
                      <TableHead className="text-right">Billable calls</TableHead>
                      <TableHead className="text-right">Not billable</TableHead>
                      <TableHead className="text-right">Payout rate</TableHead>
                      <TableHead className="text-right">Earnings</TableHead>
                      <TableHead className="text-right">Paid</TableHead>
                      <TableHead className="text-right">Pending</TableHead>
                      <TableHead className="text-right">Held or disputed</TableHead>
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
                            <TableCell className="text-right tabular-nums font-medium">
                              {row.billableCalls}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-ink-3">
                              {row.nonBillableCalls}
                            </TableCell>
                            <TableCell className="text-right tabular-nums font-mono text-xs text-ink-3">
                              <Dollars value={Number(row.payoutRate)} />
                            </TableCell>
                            <TableCell className="text-right tabular-nums font-bold">
                              <Dollars value={Number(row.earnings)} />
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              <Dollars value={Number(row.paid)} />
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              <Dollars value={Number(row.pending)} />
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              <Dollars value={Number(row.held)} />
                            </TableCell>
                          </TableRow>
                        ))}
                        {/* Totals Row */}
                        <TableRow className="bg-sunken font-bold border-t-2 border-rule text-ink">
                          <TableCell colSpan={2}>Report Totals</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {pubReport.totals.totalCalls}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {pubReport.totals.billableCalls}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-ink-3">
                            {pubReport.totals.nonBillableCalls}
                          </TableCell>
                          <TableCell className="text-right">—</TableCell>
                          <TableCell className="text-right tabular-nums text-lg">
                            <Dollars value={Number(pubReport.totals.earnings)} />
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            <Dollars value={Number(pubReport.totals.paid)} />
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            <Dollars value={Number(pubReport.totals.pending)} />
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            <Dollars value={Number(pubReport.totals.held)} />
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
            {/* The report's three figures */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatTile
                size="hero"
                label="Inbound calls"
                figure={(buyerReport?.totals.totalCalls ?? 0).toLocaleString()}
              />
              <StatTile
                size="hero"
                label="Billable calls"
                figure={(buyerReport?.totals.billableCalls ?? 0).toLocaleString()}
                sub={
                  buyerReport && buyerReport.totals.totalCalls > 0
                    ? `${((buyerReport.totals.billableCalls / buyerReport.totals.totalCalls) * 100).toFixed(0)}% of inbound`
                    : undefined
                }
              />
              <StatTile
                size="hero"
                label="Buyer cost"
                tone="money"
                figure={reportDollars(buyerReport?.totals.buyerCost)}
              />
            </div>

            {/* Detailed Table Card */}
            <Panel className="min-w-0 overflow-hidden">
              <PanelHeader>
                <PanelTitle>Buyer costs by campaign</PanelTitle>
              </PanelHeader>
              <PanelBody flush>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Buyer</TableHead>
                      <TableHead>Campaign</TableHead>
                      <TableHead>Destination</TableHead>
                      <TableHead className="text-right">Calls</TableHead>
                      <TableHead className="text-right">Billable calls</TableHead>
                      <TableHead className="text-right">Billable %</TableHead>
                      <TableHead className="text-right">Avg duration</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                      <TableHead className="text-right">Wallet debits</TableHead>
                      <TableHead className="text-right">Invoiced</TableHead>
                      <TableHead className="text-right">Pending invoice</TableHead>
                      <TableHead className="text-right">Disputes</TableHead>
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
                            <TableCell className="text-right tabular-nums font-medium">
                              {row.billableCalls}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-xs">
                              {(row.billableRate * 100).toFixed(0)}%
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-xs text-ink-3">
                              {Math.round(row.averageDuration)}s
                            </TableCell>
                            <TableCell className="text-right tabular-nums font-mono text-xs text-ink-3">
                              <Dollars value={Number(row.pricePerBillableCall)} />
                            </TableCell>
                            <TableCell className="text-right tabular-nums font-bold">
                              <Dollars value={Number(row.buyerCost)} />
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              <Dollars value={Number(row.walletDebits)} />
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              <Dollars value={Number(row.invoiced)} />
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              <Dollars value={Number(row.pendingInvoice)} />
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              <Dollars value={Number(row.disputes)} />
                            </TableCell>
                          </TableRow>
                        ))}
                        {/* Totals Row */}
                        <TableRow className="bg-sunken font-bold border-t-2 border-rule text-ink">
                          <TableCell colSpan={3}>Report Totals</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {buyerReport.totals.totalCalls}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
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
                          <TableCell className="text-right tabular-nums text-lg">
                            <Dollars value={Number(buyerReport.totals.buyerCost)} />
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            <Dollars value={Number(buyerReport.totals.walletDebits)} />
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            <Dollars value={Number(buyerReport.totals.invoiced)} />
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            <Dollars value={Number(buyerReport.totals.pendingInvoice)} />
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            <Dollars value={Number(buyerReport.totals.disputes)} />
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

export function ReportsView() {
  return (
    <RoleGuard
      allowedRoles={['ADMIN', 'OWNER', 'READONLY', 'ANALYST']}
      allowedPermissions={['reports:read']}
    >
      <ReportsPage />
    </RoleGuard>
  );
}
