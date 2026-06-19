'use client';

import {
  Activity,
  ArrowUpRight,
  BarChart3,
  Calendar,
  DollarSign,
  FileSpreadsheet,
  Loader2,
  TrendingUp,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAuth } from '@/hooks/use-auth';
import { apiClient } from '@/lib/api';
import { formatDuration } from '@/lib/utils';
import { toast } from '@/components/ui/use-toast';
import { RoleGuard } from '@/components/auth/role-guard';

interface CostSummary {
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
}

interface CostRow {
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

interface Campaign {
  id: string;
  name: string;
}

type DatePreset = 'last-7' | 'last-30' | 'last-90' | 'custom';

function BuyerCostsPage() {
  const { buyerId } = useAuth();

  const [totals, setTotals] = useState<CostSummary | null>(null);
  const [rows, setRows] = useState<CostRow[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [datePreset, setDatePreset] = useState<DatePreset>('last-30');

  // Dates
  const today = new Date().toISOString().split('T')[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const [startDate, setStartDate] = useState(thirtyDaysAgo);
  const [endDate, setEndDate] = useState(today);

  // Fetch campaigns for filter
  const fetchCampaigns = useCallback(async () => {
    try {
      const response = await apiClient.get<Campaign[]>('/api/v1/campaigns');
      if (response.data) {
        setCampaigns(response.data);
      }
    } catch (err) {
      console.error('Failed to fetch campaigns:', err);
    }
  }, []);

  const fetchCosts = useCallback(async () => {
    if (!buyerId) return;
    setLoading(true);
    try {
      let start = startDate;
      let end = endDate;

      if (datePreset === 'last-7') {
        start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        end = today;
      } else if (datePreset === 'last-30') {
        start = thirtyDaysAgo;
        end = today;
      } else if (datePreset === 'last-90') {
        start = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        end = today;
      }

      const queryParams = new URLSearchParams({
        startDate: `${start}T00:00:00.000Z`,
        endDate: `${end}T23:59:59.999Z`,
        buyerId,
      });

      if (selectedCampaign !== 'all') {
        queryParams.append('campaignId', selectedCampaign);
      }

      const response = await apiClient.get<{ totals: CostSummary; rows: CostRow[] }>(
        `/api/v1/reports/buyer-costs?${queryParams.toString()}`
      );

      if (response.data) {
        setTotals(response.data.totals);
        setRows(response.data.rows || []);
      }
    } catch (err) {
      console.error('Failed to fetch costs:', err);
      toast.error('Failed to load cost report');
    } finally {
      setLoading(false);
    }
  }, [buyerId, selectedCampaign, datePreset, startDate, endDate, today, thirtyDaysAgo]);

  useEffect(() => {
    void fetchCampaigns();
  }, [fetchCampaigns]);

  useEffect(() => {
    void fetchCosts();
  }, [fetchCosts]);

  const handleExportCSV = async () => {
    if (!buyerId) return;
    setExporting(true);
    try {
      let start = startDate;
      let end = endDate;

      if (datePreset === 'last-7') {
        start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        end = today;
      } else if (datePreset === 'last-30') {
        start = thirtyDaysAgo;
        end = today;
      } else if (datePreset === 'last-90') {
        start = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        end = today;
      }

      const queryParams = new URLSearchParams({
        startDate: `${start}T00:00:00.000Z`,
        endDate: `${end}T23:59:59.999Z`,
        buyerId,
      });

      if (selectedCampaign !== 'all') {
        queryParams.append('campaignId', selectedCampaign);
      }

      window.open(`/api/v1/reports/buyer-costs/export.csv?${queryParams.toString()}`);
      toast.success('Export initiated successfully');
    } catch (err) {
      console.error('Failed to export costs:', err);
      toast.error('Failed to export costs');
    } finally {
      setExporting(false);
    }
  };

  const costPerBillable =
    totals && totals.billableCalls > 0
      ? parseFloat(totals.buyerCost) / totals.billableCalls
      : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Costs & Reports</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Analyze your campaign cost performance, billing allocation, and dispute tracking.
          </p>
        </div>
        <Button onClick={handleExportCSV} disabled={exporting} variant="outline" size="sm" className="flex items-center gap-2">
          {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
          Export CSV
        </Button>
      </div>

      {/* Filters Card */}
      <Card className="bg-card border-border">
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {/* Campaign */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Campaign</label>
              <Select value={selectedCampaign} onValueChange={setSelectedCampaign}>
                <SelectTrigger className="h-9 border-border bg-background">
                  <SelectValue placeholder="All Campaigns" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Campaigns</SelectItem>
                  {campaigns.map((camp) => (
                    <SelectItem key={camp.id} value={camp.id}>
                      {camp.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Date Preset */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Period</label>
              <Select value={datePreset} onValueChange={(val: any) => setDatePreset(val)}>
                <SelectTrigger className="h-9 border-border bg-background">
                  <SelectValue placeholder="Select period" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="last-7">Last 7 Days</SelectItem>
                  <SelectItem value="last-30">Last 30 Days</SelectItem>
                  <SelectItem value="last-90">Last 90 Days</SelectItem>
                  <SelectItem value="custom">Custom Range</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Custom Dates */}
            {datePreset === 'custom' && (
              <>
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">From</label>
                  <Input
                    type="date"
                    value={startDate}
                    onChange={e => setStartDate(e.target.value)}
                    className="h-9 border-border bg-background"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">To</label>
                  <Input
                    type="date"
                    value={endDate}
                    onChange={e => setEndDate(e.target.value)}
                    className="h-9 border-border bg-background"
                  />
                </div>
              </>
            )}

            {/* Apply Button */}
            <div className="flex items-end">
              <Button onClick={() => void fetchCosts()} className="w-full h-9" variant="secondary">
                Generate Report
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPI Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Total Cost</CardTitle>
            <DollarSign className="h-4 w-4 text-emerald-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-emerald-400">
              {loading ? '...' : `$${parseFloat(totals?.buyerCost || '0').toFixed(2)}`}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Accumulated spend</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Wallet Debits</CardTitle>
            <TrendingUp className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-primary">
              {loading ? '...' : `$${parseFloat(totals?.walletDebits || '0').toFixed(2)}`}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Pre-paid upfront charges</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pending Invoices</CardTitle>
            <BarChart3 className="h-4 w-4 text-cyan-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-cyan-400">
              {loading ? '...' : `$${(parseFloat(totals?.pendingInvoice || '0') + parseFloat(totals?.invoiced || '0')).toFixed(2)}`}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Terms billing balance</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Disputed Amount</CardTitle>
            <Activity className="h-4 w-4 text-red-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-red-400">
              {loading ? '...' : `$${parseFloat(totals?.disputes || '0').toFixed(2)}`}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Currently under review</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="p-4 flex flex-col justify-center bg-card border-border">
          <div className="text-xs text-muted-foreground uppercase tracking-widest">Billable Rate</div>
          <div className="text-2xl font-bold font-mono mt-1 text-slate-100">
            {loading ? '...' : `${((totals?.billableRate || 0) * 100).toFixed(1)}%`}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {totals?.billableCalls || 0} of {totals?.totalCalls || 0} calls
          </div>
        </Card>
        <Card className="p-4 flex flex-col justify-center bg-card border-border">
          <div className="text-xs text-muted-foreground uppercase tracking-widest">Avg Call Duration</div>
          <div className="text-2xl font-bold font-mono mt-1 text-slate-100">
            {loading ? '...' : formatDuration(totals?.averageDuration || 0)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">Average time per call</div>
        </Card>
        <Card className="p-4 flex flex-col justify-center bg-card border-border">
          <div className="text-xs text-muted-foreground uppercase tracking-widest">Cost Per Billable Call</div>
          <div className="text-2xl font-bold font-mono mt-1 text-emerald-400">
            {loading ? '...' : `$${costPerBillable.toFixed(2)}`}
          </div>
          <div className="text-xs text-muted-foreground mt-1">Average charge per connection</div>
        </Card>
      </div>

      {/* Rows Table */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle>Campaign Cost Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/15 border-b border-border">
                <TableRow>
                  <TableHead className="p-4 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Campaign</TableHead>
                  <TableHead className="p-4 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Destination Number</TableHead>
                  <TableHead className="p-4 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">Total Calls</TableHead>
                  <TableHead className="p-4 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">Billable Calls</TableHead>
                  <TableHead className="p-4 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">Billable Rate</TableHead>
                  <TableHead className="p-4 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">Avg Duration</TableHead>
                  <TableHead className="p-4 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">Bid Price</TableHead>
                  <TableHead className="p-4 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground font-semibold">Total Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-border">
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-12 text-center text-sm text-muted-foreground">
                      <div className="flex items-center justify-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        <span>Loading costs breakdown...</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-12 text-center text-sm text-muted-foreground">
                      No cost records found for this period.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row, i) => (
                    <TableRow key={i} className="hover:bg-muted/30 transition-colors duration-150">
                      <TableCell className="p-4 font-medium text-slate-100">{row.campaignName}</TableCell>
                      <TableCell className="p-4 font-mono text-xs">{row.destinationNumber}</TableCell>
                      <TableCell className="p-4 text-center font-mono text-xs">{row.totalCalls}</TableCell>
                      <TableCell className="p-4 text-center font-mono text-xs text-slate-300">{row.billableCalls}</TableCell>
                      <TableCell className="p-4 text-center font-mono text-xs">
                        {((row.billableRate || 0) * 100).toFixed(1)}%
                      </TableCell>
                      <TableCell className="p-4 text-center font-mono text-xs text-muted-foreground">
                        {formatDuration(row.averageDuration)}
                      </TableCell>
                      <TableCell className="p-4 text-right font-mono text-xs">
                        ${Number(row.pricePerBillableCall).toFixed(2)}
                      </TableCell>
                      <TableCell className="p-4 text-right font-mono text-xs text-emerald-400 font-semibold">
                        ${Number(row.buyerCost).toFixed(2)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function GuardedBuyerCostsPage() {
  return (
    <RoleGuard allowedRoles={['BUYER']}>
      <BuyerCostsPage />
    </RoleGuard>
  );
}
