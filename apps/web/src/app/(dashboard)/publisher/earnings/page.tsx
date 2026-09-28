'use client';

import {
  Calendar,
  CheckCircle,
  CreditCard,
  DollarSign,
  FileText,
  HelpCircle,
  Loader2,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { RoleGuard } from '@/components/auth/role-guard';
import { dollars } from '@/components/delivery/ledger';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from '@/components/ui/use-toast';
import { PeriodToolbar, usePeriod } from '@/components/white-label/period-toolbar';
import { useAuth } from '@/hooks/use-auth';
import { apiClient, payload } from '@/lib/api';
import type { Envelope } from '@/lib/api';
import { CLAWED_BACK, CLAWED_BACK_BADGE, CLAWED_BACK_LABEL } from '@/lib/payout-status';
import { payoutSummaryPath, type PublisherPayoutSummary } from '@/lib/publisher-portal';
import { formatDuration, formatPhoneNumber } from '@/lib/utils';

interface CallEarningRecord {
  id: string;
  createdAt: string;
  callerId?: string;
  duration?: number;
  connectedDuration?: number;
  billable: boolean;
  payout?: number;
  publisherPayoutStatus?: string | null;
  publisherPayableAt?: string | null;
  campaign?: { name: string } | null;
}

interface CallsPage {
  data: CallEarningRecord[];
  meta?: { page: number; total: number; totalPages: number };
}

/** Rows per page of the ledger. */
const PAGE_SIZE = 50;

/**
 * Earnings: what this publisher's calls earned over a period, call by call.
 *
 * The cards are the same `/payouts/summary` the Payouts page reads -- this
 * publisher's row of the agency's own Payouts screen -- not figures worked out
 * here. They used to be: "Paid" was lifetime earnings minus whatever was
 * pending among the fifty calls the browser had loaded, so it moved when more
 * traffic arrived. The ledger is every call in the period, a page at a time,
 * rather than the last fifty whatever their date.
 */
function PublisherEarningsPage() {
  const { user } = useAuth();
  const publisherId = user?.publisherId;
  const period = usePeriod('THIS_MONTH');
  const { sendable, query } = period;

  const [summary, setSummary] = useState<PublisherPayoutSummary | null>(null);
  const [earnings, setEarnings] = useState<CallEarningRecord[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingCalls, setLoadingCalls] = useState(true);

  const fetchSummary = useCallback(async () => {
    if (!publisherId || !sendable) return;
    setLoading(true);
    try {
      const res = await apiClient.get<Envelope<PublisherPayoutSummary>>(
        payoutSummaryPath(publisherId, query)
      );
      if (res.error) toast.error('Failed to load earnings', res.error.message);
      setSummary(payload(res) ?? null);
      setPage(1);
    } catch (err) {
      console.error('Failed to load earnings summary:', err);
      toast.error('Failed to load earnings');
    } finally {
      setLoading(false);
    }
  }, [publisherId, sendable, query]);

  useEffect(() => {
    void fetchSummary();
  }, [fetchSummary]);

  /*
   * The calls are read between the instants the server resolved the period to,
   * so the ledger covers exactly the days the cards do. The browser never
   * works out where a day starts.
   */
  const startsAt = summary?.period.startsAt;
  const endsAt = summary?.period.endsAt;

  const fetchCalls = useCallback(async () => {
    if (!startsAt || !endsAt) return;
    setLoadingCalls(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_SIZE),
        startDate: startsAt,
        endDate: endsAt,
      });
      const res = await apiClient.get<CallsPage>(`/api/v1/calls?${params.toString()}`);
      if (res.data) {
        setEarnings(res.data.data || []);
        setTotalPages(Math.max(1, res.data.meta?.totalPages ?? 1));
        setTotal(res.data.meta?.total ?? res.data.data?.length ?? 0);
      }
    } catch (err) {
      console.error('Failed to load earnings ledger:', err);
      toast.error('Failed to load financial logs');
    } finally {
      setLoadingCalls(false);
    }
  }, [startsAt, endsAt, page]);

  useEffect(() => {
    void fetchCalls();
  }, [fetchCalls]);

  const label = summary?.period.label ?? 'This month';

  const getPayoutStatusBadge = (status?: string | null) => {
    const s = status || 'PENDING';
    switch (s.toUpperCase()) {
      case 'PAID':
        return (
          <Badge variant="outline" className="bg-live-tint text-live-ink border-live/40">
            Paid
          </Badge>
        );
      case 'PROCESSING':
        return (
          <Badge variant="outline" className="bg-ringing-tint text-ringing-ink border-ringing/40">
            Processing
          </Badge>
        );
      case 'PAYABLE':
        return (
          <Badge variant="outline" className="bg-ringing-tint text-ringing-ink border-ringing/40">
            Payable
          </Badge>
        );
      case 'HELD':
        return (
          <Badge variant="outline" className="bg-dropped-tint text-dropped-ink border-dropped/40">
            Held
          </Badge>
        );
      case 'DISPUTED':
        return (
          <Badge variant="outline" className="bg-dropped-tint text-dropped-ink border-dropped/40">
            Disputed
          </Badge>
        );
      case CLAWED_BACK:
        return (
          <Badge variant="outline" className={CLAWED_BACK_BADGE}>
            {CLAWED_BACK_LABEL}
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

  const cards = [
    {
      title: 'Payable',
      value: summary?.payable,
      icon: DollarSign,
      tone: 'text-money-ink',
      note: summary
        ? `${summary.payableCalls.toLocaleString()} calls owed and not yet paid.`
        : 'Owed and not yet paid.',
      noteIcon: Calendar,
    },
    {
      title: 'Paid',
      value: summary?.paid,
      icon: CreditCard,
      tone: 'text-live-ink',
      note: 'Calls your agency has already paid you for.',
      noteIcon: CheckCircle,
    },
    {
      title: 'Held / Disputed',
      value: summary?.held,
      icon: HelpCircle,
      tone: 'text-dropped-ink',
      note: 'On hold, or disputed and not yet decided.',
      noteIcon: HelpCircle,
    },
  ];

  return (
    <div className="space-y-6 p-6 max-w-7xl mx-auto">
      <div>
        <p className="text-sm text-ink-2">
          What your calls earned over the period, and where each payout stands.
        </p>
      </div>

      <PeriodToolbar state={period} resolved={summary?.period ?? null} label="Earnings period" />

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {cards.map(card => (
          <Card
            key={card.title}
            className="bg-surface border-rule backdrop-blur-xl relative overflow-hidden group"
          >
            <div className="absolute right-0 bottom-0 translate-x-4 translate-y-4 opacity-5 pointer-events-none group-hover:scale-110 transition-transform">
              <card.icon className="w-36 h-36 text-ink" />
            </div>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <span className="t-caption text-ink-2">
                {card.title} · {label}
              </span>
              <card.icon className={`h-5 w-5 ${card.tone}`} />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-extrabold text-ink tabular">
                {loading ? (
                  <Loader2 className="h-7 w-7 animate-spin text-brand-ink" />
                ) : (
                  dollars(card.value ?? 0)
                )}
              </div>
              <p className="text-[10px] text-ink-2 mt-2 flex items-center gap-1">
                <card.noteIcon className={`h-3.5 w-3.5 ${card.tone}`} />
                {card.note}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Transaction Ledger Table */}
      <Card className="bg-surface border-rule backdrop-blur-xl">
        <CardHeader className="flex flex-row items-center justify-between pb-4 border-b border-rule">
          <div>
            <CardTitle className="text-lg font-bold text-ink flex items-center gap-2">
              <FileText className="h-5 w-5 text-brand-ink" />
              Earnings Ledger
            </CardTitle>
            <CardDescription className="text-xs text-ink-2">
              Every call in the period and what it paid.
            </CardDescription>
          </div>
          <span className="text-xs text-ink-3">
            {total.toLocaleString()} call{total === 1 ? '' : 's'}
          </span>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-rule hover:bg-transparent">
                  <TableHead className="text-ink-2 font-medium pl-6">Date</TableHead>
                  <TableHead className="text-ink-2 font-medium">Campaign</TableHead>
                  <TableHead className="text-ink-2 font-medium">Caller ID</TableHead>
                  <TableHead className="text-ink-2 font-medium">Connected</TableHead>
                  <TableHead className="text-ink-2 font-medium">Type</TableHead>
                  <TableHead className="text-ink-2 font-medium">Payout Status</TableHead>
                  <TableHead className="text-ink-2 font-medium text-right pr-6">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading || loadingCalls ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={7} className="h-48 text-center text-ink-3">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <Loader2 className="h-8 w-8 animate-spin text-brand-ink" />
                        <span>Loading calls...</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : earnings.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={7} className="h-48 text-center text-ink-3">
                      <span>No calls in this period.</span>
                    </TableCell>
                  </TableRow>
                ) : (
                  earnings.map(entry => (
                    <TableRow
                      key={entry.id}
                      className="border-rule hover:bg-sunken transition-colors"
                    >
                      <TableCell className="pl-6 font-mono text-xs text-ink">
                        {new Date(entry.createdAt).toLocaleString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </TableCell>
                      <TableCell className="font-medium text-ink">
                        {entry.campaign?.name || '—'}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-ink-2">
                        {entry.callerId ? formatPhoneNumber(entry.callerId) : '—'}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-ink-2">
                        {entry.connectedDuration ? formatDuration(entry.connectedDuration) : '0:00'}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            entry.billable
                              ? 'bg-live-tint text-live-ink border-live/40'
                              : 'bg-dropped-tint text-dropped-ink border-dropped/40'
                          }
                        >
                          {entry.billable ? 'Billable Call' : 'Non-Billable'}
                        </Badge>
                      </TableCell>
                      <TableCell>{getPayoutStatusBadge(entry.publisherPayoutStatus)}</TableCell>
                      <TableCell className="text-right pr-6 font-mono font-bold text-ink">
                        {dollars(
                          entry.payout !== undefined && entry.payout !== null
                            ? Number(entry.payout)
                            : 0
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          {totalPages > 1 ? (
            <div className="flex items-center justify-between border-t border-rule px-6 py-3">
              <span className="text-xs text-ink-3">
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || loadingCalls}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages || loadingCalls}
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

export default function GuardedPublisherEarningsPage() {
  return (
    <RoleGuard allowedRoles={['PUBLISHER']}>
      <PublisherEarningsPage />
    </RoleGuard>
  );
}
