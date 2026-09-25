'use client';

import { BadgeDollarSign, Download, Loader2, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { count, dollars, duration, pct } from '@/components/delivery/ledger';
import {
  EmptyState,
  Notice,
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  StatTile,
} from '@/components/domain';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PeriodToolbar, saveCsv, usePeriod } from '@/components/white-label/period-toolbar';
import type { CallSalesSummary } from '@/components/white-label/types';
import { usePlatformContext } from '@/hooks/use-platform-context';
import { apiClient, payload } from '@/lib/api';
import type { Envelope } from '@/lib/api';
import { formatDayLabel } from '@/lib/format-time';
import { cn } from '@/lib/utils';

/**
 * Sales: what a white-label agency's calls sold for.
 *
 * ── Whose screen ─────────────────────────────────────────────────────────────
 *
 * A white-label agency's OWNER and ADMIN, and NetEnroll staff inside one. A
 * normal agency is redirected off `/sales` by the dashboard layout, and the
 * API refuses it the summary regardless.
 *
 * ── Nothing is computed here ─────────────────────────────────────────────────
 *
 * `GET /api/v1/call-sales/summary` returns every figure, from the same
 * arithmetic the campaign profitability report runs on. This page formats them
 * and lays them out; it derives no rate and resolves no date.
 */
export default function SalesPage(): JSX.Element {
  const state = usePeriod('TODAY');
  const { sendable, query } = state;

  const [data, setData] = useState<CallSalesSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const platform = usePlatformContext();
  const withoutAgency = platform.needsAgency;

  const load = useCallback(async () => {
    if (!sendable) return;
    setLoading(true);
    try {
      const response = await apiClient.get<Envelope<CallSalesSummary>>(
        `/api/v1/call-sales/summary?${query}`
      );
      if (response.error) {
        setError(response.error.message);
        return;
      }
      setError(null);
      setData(payload(response) ?? null);
    } finally {
      setLoading(false);
    }
  }, [query, sendable]);

  useEffect(() => {
    if (platform.loading || withoutAgency) return;
    void load();
  }, [load, platform.loading, withoutAgency]);

  async function exportCsv(): Promise<void> {
    setExporting(true);
    try {
      const response = await apiClient.get<string>(`/api/v1/call-sales/summary.csv?${query}`, {
        responseType: 'text',
      });
      if (!response.data) {
        setError(response.error ? response.error.message : 'The export returned nothing.');
        return;
      }
      saveCsv(
        response.data,
        `call-sales-${data?.period.from ?? state.from}-to-${data?.period.to ?? state.to}.csv`
      );
    } finally {
      setExporting(false);
    }
  }

  if (withoutAgency) {
    return (
      <div className="page-canvas">
        <Notice title="Select an agency to see what its calls sold for." />
      </div>
    );
  }

  return (
    <div className="page-canvas">
      <PageHeader
        description="What your calls sold for: buyers, revenue, payouts, profit"
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void load()}
              disabled={loading || !sendable}
            >
              <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', loading && 'animate-spin')} />
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void exportCsv()}
              disabled={exporting || !sendable || !data}
            >
              {exporting ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="mr-1.5 h-3.5 w-3.5" />
              )}
              Export CSV
            </Button>
          </>
        }
      />

      <PeriodToolbar state={state} resolved={data?.period ?? null} label="Sales period" />

      {error ? <Notice tone="error" title={error} /> : null}

      {loading && !data ? (
        <div className="flex items-center justify-center py-16 t-body text-ink-3">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading sales
        </div>
      ) : !data ? null : data.totals.inboundCalls === 0 ? (
        <Panel>
          <PanelBody>
            <EmptyState
              headline="No inbound calls in this period."
              body="Revenue, buyers and publishers fill in as soon as calls start arriving on your numbers."
              icon={BadgeDollarSign}
            />
          </PanelBody>
        </Panel>
      ) : (
        <SalesBody data={data} />
      )}
    </div>
  );
}

/** Everything under the toolbar, once there is at least one call. */
function SalesBody({ data }: { data: CallSalesSummary }): JSX.Element {
  const { totals } = data;
  const leaderboardHref =
    data.period.key === 'CUSTOM'
      ? `/leaderboard?period=CUSTOM&from=${data.period.from}&to=${data.period.to}`
      : `/leaderboard?period=${data.period.key}`;

  return (
    <>
      <section
        className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6"
        aria-label="Sales KPIs"
      >
        <StatTile
          label="Revenue"
          figure={dollars(totals.revenue)}
          data-figure-label="Revenue"
          data-figure-value={dollars(totals.revenue)}
          tone="money"
          sub="billed to buyers"
        />
        <StatTile
          label="Profit"
          figure={dollars(totals.profit)}
          data-figure-label="Profit"
          data-figure-value={dollars(totals.profit)}
          tone="money"
          sub={`after ${dollars(totals.publisherPayouts)} in payouts`}
        />
        <StatTile
          label="Margin"
          figure={pct(totals.marginPct, 1)}
          data-figure-label="Margin"
          data-figure-value={pct(totals.marginPct, 1)}
          sub="profit ÷ revenue"
        />
        <StatTile
          label="Billable to buyers"
          figure={count(totals.billableToBuyers)}
          data-figure-label="Billable to buyers"
          data-figure-value={count(totals.billableToBuyers)}
          sub={`of ${count(totals.sentToBuyers)} sent`}
        />
        <StatTile
          label="Sell-through"
          figure={pct(totals.sellThroughPct, 1)}
          data-figure-label="Sell-through"
          data-figure-value={pct(totals.sellThroughPct, 1)}
          sub="billable ÷ sent to buyers"
        />
        <StatTile
          label="Revenue per billable call"
          figure={dollars(totals.revenuePerBillableCall)}
          data-figure-label="Revenue per billable call"
          data-figure-value={dollars(totals.revenuePerBillableCall)}
        />
      </section>

      <WhereCallsWent data={data} leaderboardHref={leaderboardHref} />

      <Panel className="min-w-0">
        <PanelHeader>
          <PanelTitle>Buyers</PanelTitle>
          <PanelDescription>Sorted by revenue</PanelDescription>
        </PanelHeader>
        <PanelBody flush className="overflow-x-auto">
          {data.byBuyer.length === 0 ? (
            <EmptyState headline="No calls were sent to a buyer in this period." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Buyer</TableHead>
                  <TableHead className="text-right">Calls</TableHead>
                  <TableHead className="text-right">Billable</TableHead>
                  <TableHead className="text-right">Billable %</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Avg connected</TableHead>
                  <TableHead className="text-right">Disputed</TableHead>
                  <TableHead className="text-right">Cap used today</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.byBuyer.map(row => (
                  <TableRow key={row.buyerId}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/buyers?id=${encodeURIComponent(row.buyerId)}`}
                        className="text-brand-ink hover:underline"
                      >
                        {row.buyerName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{count(row.calls)}</TableCell>
                    <TableCell className="text-right tabular-nums">{count(row.billable)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {pct(row.billablePct, 1)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {dollars(row.revenue)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.avgConnectedSeconds === null ? '—' : duration(row.avgConnectedSeconds)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{count(row.disputed)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {count(row.capConsumedToday)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </PanelBody>
      </Panel>

      <Panel className="min-w-0">
        <PanelHeader>
          <PanelTitle>Publishers</PanelTitle>
          <PanelDescription>Sorted by profit</PanelDescription>
        </PanelHeader>
        <PanelBody flush className="overflow-x-auto">
          {data.byPublisher.length === 0 ? (
            <EmptyState headline="No calls came from a publisher in this period." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Publisher</TableHead>
                  <TableHead className="text-right">Calls</TableHead>
                  <TableHead className="text-right">Your agents</TableHead>
                  <TableHead className="text-right">Sent to buyers</TableHead>
                  <TableHead className="text-right">Billable</TableHead>
                  <TableHead className="text-right">Payout</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Profit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.byPublisher.map(row => (
                  <TableRow key={row.publisherId}>
                    <TableCell className="font-medium">{row.publisherName}</TableCell>
                    <TableCell className="text-right tabular-nums">{count(row.calls)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {count(row.answeredByAgents)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {count(row.sentToBuyers)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{count(row.billable)}</TableCell>
                    <TableCell className="text-right tabular-nums">{dollars(row.payout)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {dollars(row.revenue)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right font-medium tabular-nums',
                        row.profit < 0 ? 'text-dropped-ink' : 'text-money-ink'
                      )}
                    >
                      {dollars(row.profit)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </PanelBody>
      </Panel>

      <Panel className="min-w-0">
        <PanelHeader>
          <PanelTitle>By day</PanelTitle>
        </PanelHeader>
        <PanelBody flush className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Day</TableHead>
                <TableHead className="text-right">Inbound</TableHead>
                <TableHead className="text-right">Sent to buyers</TableHead>
                <TableHead className="text-right">Billable</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Payout</TableHead>
                <TableHead className="text-right">Profit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.byDay.map(row => (
                <TableRow key={row.day}>
                  <TableCell>{formatDayLabel(row.day)}</TableCell>
                  <TableCell className="text-right tabular-nums">{count(row.inbound)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {count(row.sentToBuyers)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{count(row.billable)}</TableCell>
                  <TableCell className="text-right tabular-nums">{dollars(row.revenue)}</TableCell>
                  <TableCell className="text-right tabular-nums">{dollars(row.payout)}</TableCell>
                  <TableCell className="text-right tabular-nums">{dollars(row.profit)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </PanelBody>
      </Panel>
    </>
  );
}

/**
 * "Where your calls went": one bar, four parts.
 *
 * The four come from different columns -- who answered, which buyer, blocked
 * -- so the shares are each out of every inbound call and are not forced to
 * add to exactly one hundred.
 */
function WhereCallsWent({
  data,
  leaderboardHref,
}: {
  data: CallSalesSummary;
  leaderboardHref: string;
}): JSX.Element {
  const inbound = data.totals.inboundCalls;
  const parts = [
    { key: 'agents', label: 'Your agents', value: data.disposition.yourAgents, bar: 'bg-live' },
    { key: 'buyers', label: 'Buyers', value: data.disposition.buyers, bar: 'bg-money' },
    {
      key: 'unanswered',
      label: 'Unanswered',
      value: data.disposition.unanswered,
      bar: 'bg-ringing',
    },
    { key: 'blocked', label: 'Blocked', value: data.disposition.blocked, bar: 'bg-blocked' },
  ];
  const share = (value: number) => (inbound > 0 ? (value / inbound) * 100 : 0);

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Where your calls went</PanelTitle>
        <PanelDescription>{`${count(inbound)} inbound calls`}</PanelDescription>
      </PanelHeader>
      <PanelBody className="flex flex-col gap-4">
        <div
          className="flex h-3 w-full overflow-hidden rounded-full bg-sunken"
          role="img"
          aria-label={parts.map(part => `${part.label} ${part.value}`).join(', ')}
        >
          {parts.map(part =>
            part.value > 0 ? (
              <div
                key={part.key}
                className={part.bar}
                style={{ width: `${Math.min(100, share(part.value))}%` }}
              />
            ) : null
          )}
        </div>
        <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {parts.map(part => {
            const figure = (
              <>
                {count(part.value)}{' '}
                <span className="t-meta text-ink-3">{pct(share(part.value), 1)}</span>
              </>
            );
            return (
              <div key={part.key}>
                <dt className="flex items-center gap-2 t-label text-ink-3">
                  <span className={cn('h-2 w-2 rounded-full', part.bar)} aria-hidden />
                  {part.label}
                </dt>
                <dd className="t-data text-ink tabular-nums" data-part={part.key}>
                  {part.key === 'agents' ? (
                    <Link
                      href={leaderboardHref}
                      className="hover:underline"
                      title="Your agents on the Leaderboard, for the same period"
                    >
                      {figure}
                    </Link>
                  ) : (
                    figure
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      </PanelBody>
    </Panel>
  );
}
