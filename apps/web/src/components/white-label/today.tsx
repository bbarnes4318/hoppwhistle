'use client';

import { ArrowUpRight, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useState } from 'react';

import { count, dollars, pct } from '@/components/delivery/ledger';
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
import { useLivePoll } from '@/hooks/use-live-poll';
import { usePlatformContext } from '@/hooks/use-platform-context';
import { apiClient, payload } from '@/lib/api';
import type { Envelope } from '@/lib/api';
import { cn } from '@/lib/utils';

import type { WhiteLabelToday as TodayData } from './types';
import { WhereCallsWent } from './where-calls-went';

/** Often enough to watch; the server caches each agency's answer for 15s. */
const REFRESH_MS = 30_000;

/**
 * Today: a white-label owner's first screen.
 *
 * ── What is on it, and what is not ───────────────────────────────────────────
 *
 * What is happening right now (calls up, who can take one, which buyers are
 * still taking calls, returns waiting), where today's calls went, what they
 * made, and what needs a decision. Everything comes from one endpoint,
 * `GET /api/v1/white-label/today`, which builds it from the live board, the
 * Revenue summary for TODAY and the agent roster; nothing is computed here.
 *
 * Not on it: the inbound/outbound chart, the call history (Calls has it) and
 * the separate Sales Today panel, whose figures are rows two and three.
 */
export function WhiteLabelToday(): JSX.Element {
  const [data, setData] = useState<TodayData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const platform = usePlatformContext();

  const load = useCallback(async () => {
    const response = await apiClient.get<Envelope<TodayData>>('/api/v1/white-label/today');
    if (response.error) {
      setError(response.error.message);
      return response.error.code === 'NO_ACTING_TENANT'
        ? ('refused' as const)
        : ('failed' as const);
    }
    setError(null);
    setData(payload(response) ?? null);
    return 'ok' as const;
  }, []);

  const { loading, refresh } = useLivePoll(load, {
    intervalMs: REFRESH_MS,
    enabled: !platform.loading && !platform.needsAgency,
  });

  if (platform.needsAgency) {
    return (
      <div className="page-canvas">
        <Notice title="Select an agency to see its day." />
      </div>
    );
  }

  const busy = loading && !data;
  const figure = (value: string) => (data ? value : '—');

  return (
    <div className="page-canvas" data-testid="white-label-today">
      <PageHeader
        description="Your calls, agents, buyers and money right now"
        actions={
          <Button variant="outline" size="sm" onClick={refresh} disabled={busy}>
            <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', busy && 'animate-spin')} />
            Refresh
          </Button>
        }
      />

      {error ? <Notice tone="error" title={error} /> : null}

      <section aria-labelledby="today-now" className="flex flex-col gap-3">
        <h2 id="today-now" className="t-label text-ink-3">
          Right now
        </h2>
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          <StatTile
            label="Calls up"
            loading={busy}
            figure={figure(count(data?.now.callsUp))}
            data-figure-label="Calls up"
            data-figure-value={count(data?.now.callsUp)}
            sub="in progress now"
          />
          <StatTile
            label="Agents ready"
            loading={busy}
            figure={figure(`${count(data?.now.agentsReady)} of ${count(data?.now.agentsActive)}`)}
            data-figure-label="Agents ready"
            data-figure-value={`${count(data?.now.agentsReady)} of ${count(data?.now.agentsActive)}`}
            sub={`${count(data?.now.agentsOnCall)} on a call`}
          />
          <StatTile
            label="Buyers taking calls"
            loading={busy}
            figure={figure(`${count(data?.now.buyersTaking)} of ${count(data?.now.buyersActive)}`)}
            data-figure-label="Buyers taking calls"
            data-figure-value={`${count(data?.now.buyersTaking)} of ${count(data?.now.buyersActive)}`}
            sub={`${count(data?.now.buyersAtCap)} at cap`}
          />
          <Link
            href="/buyers?tab=returns"
            className="rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Returns waiting: ${count(data?.now.returnsOpen)}`}
          >
            <StatTile
              label="Returns waiting"
              loading={busy}
              figure={figure(count(data?.now.returnsOpen))}
              data-figure-label="Returns waiting"
              data-figure-value={count(data?.now.returnsOpen)}
              sub={
                <span className="inline-flex items-center gap-1 text-brand-ink">
                  Open Returns <ArrowUpRight className="h-3 w-3" />
                </span>
              }
              className="h-full transition-colors hover:bg-sunken"
            />
          </Link>
        </div>
      </section>

      <section aria-labelledby="today-today" className="flex flex-col gap-3">
        <h2 id="today-today" className="t-label text-ink-3">
          Today
        </h2>
        {data ? (
          <WhereCallsWent
            inbound={data.today.inbound}
            disposition={{
              yourAgents: data.today.answeredByAgents,
              buyers: data.today.sentToBuyers,
              unanswered: data.today.unanswered,
              blocked: data.today.blocked,
            }}
            agentsHref="/agents?tab=performance"
          />
        ) : null}
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4" aria-label="Today's money">
          <StatTile
            label="Revenue"
            loading={busy}
            tone="money"
            figure={figure(dollars(data?.today.revenue))}
            data-figure-label="Revenue"
            data-figure-value={dollars(data?.today.revenue)}
            sub="billed to buyers today"
          />
          <StatTile
            label="Profit"
            loading={busy}
            tone="money"
            figure={figure(dollars(data?.today.profit))}
            data-figure-label="Profit"
            data-figure-value={dollars(data?.today.profit)}
            sub="after publisher payouts and call cost"
          />
          <StatTile
            label="Applications"
            loading={busy}
            figure={figure(count(data?.today.applications))}
            data-figure-label="Applications"
            data-figure-value={count(data?.today.applications)}
            sub="written today"
          />
          <StatTile
            label="Closing %"
            loading={busy}
            figure={figure(pct(data?.today.closingPct ?? null, 1))}
            data-figure-label="Closing %"
            data-figure-value={pct(data?.today.closingPct ?? null, 1)}
            sub="applications ÷ delivered calls"
          />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Panel className="min-w-0">
          <PanelHeader>
            <PanelTitle>Needs attention</PanelTitle>
          </PanelHeader>
          <PanelBody>
            {!data ? null : data.attention.length === 0 ? (
              <p className="t-body text-ink-3">Nothing needs you right now.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-rule" aria-label="Needs attention">
                {data.attention.map(item => (
                  <li key={item.kind} data-attention={item.kind}>
                    <Link
                      href={item.href}
                      className="flex items-center justify-between gap-3 py-2.5 hover:text-brand-ink"
                    >
                      <span className="t-body text-ink">{item.label}</span>
                      <span className="flex items-center gap-1 t-data tabular-nums text-ink">
                        {item.kind === 'payouts_owed' && item.amount !== undefined
                          ? dollars(item.amount)
                          : count(item.count)}
                        <ArrowUpRight className="h-3.5 w-3.5 text-ink-3" />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </PanelBody>
        </Panel>

        <Panel className="min-w-0">
          <PanelHeader>
            <PanelTitle>Buyers today</PanelTitle>
            <PanelDescription>Calls up, delivered and cap, per buyer</PanelDescription>
          </PanelHeader>
          <PanelBody flush className="overflow-x-auto">
            {!data ? null : data.buyers.length === 0 ? (
              <EmptyState headline="No buyers have taken a call today." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Buyer</TableHead>
                    <TableHead className="text-right">Calls up</TableHead>
                    <TableHead className="text-right">Delivered</TableHead>
                    <TableHead className="text-right">Cap</TableHead>
                    <TableHead className="text-right">Applications</TableHead>
                    <TableHead className="text-right">Closing %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.buyers.map(buyer => (
                    <TableRow key={buyer.id} data-buyer={buyer.id}>
                      <TableCell className="font-medium">
                        <Link
                          href={`/buyers?id=${encodeURIComponent(buyer.id)}`}
                          className="text-brand-ink hover:underline"
                        >
                          {buyer.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {count(buyer.callsInFlight)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {count(buyer.deliveredToday)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'text-right tabular-nums',
                          buyer.atCap && 'font-medium text-dropped-ink'
                        )}
                        data-cap
                      >
                        {buyer.capMax === null
                          ? `${count(buyer.capUsed)} / —`
                          : `${count(buyer.capUsed)} / ${count(buyer.capMax)}`}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {count(buyer.applicationsToday)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {pct(buyer.closingPct, 1)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </PanelBody>
        </Panel>
      </div>
    </div>
  );
}
