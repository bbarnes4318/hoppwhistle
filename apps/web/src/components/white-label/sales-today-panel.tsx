'use client';

import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { count, dollars, pct } from '@/components/delivery/ledger';
import { Panel, PanelBody, PanelHeader, PanelTitle, StatTile } from '@/components/domain';
import { apiClient, payload } from '@/lib/api';
import type { Envelope } from '@/lib/api';

import type { CallSalesSummary } from './types';

/**
 * Today's call sales, at the top of a white-label owner's dashboard.
 *
 * Four figures from the same endpoint /sales reads, for TODAY, and a link to
 * the full screen. The dashboard renders this only for a white-label agency's
 * OWNER or ADMIN; a normal agency's dashboard is unchanged.
 */
export function SalesTodayPanel(): JSX.Element {
  const [totals, setTotals] = useState<CallSalesSummary['totals'] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void apiClient
      .get<Envelope<CallSalesSummary>>('/api/v1/call-sales/summary?period=TODAY')
      .then(response => {
        if (cancelled) return;
        const data = payload(response);
        if (response.error || !data) {
          setFailed(true);
          return;
        }
        setTotals(data.totals);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loading = totals === null && !failed;
  const figure = (value: string) => (failed ? '—' : value);

  return (
    <Panel data-testid="sales-today">
      <PanelHeader
        action={
          <Link
            href="/sales"
            className="inline-flex items-center gap-1 t-meta text-brand-ink hover:underline"
          >
            Sales
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        }
      >
        <PanelTitle>Call sales today</PanelTitle>
      </PanelHeader>
      <PanelBody className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatTile
          label="Revenue"
          loading={loading}
          figure={figure(dollars(totals?.revenue ?? 0))}
          tone="money"
        />
        <StatTile
          label="Profit"
          loading={loading}
          figure={figure(dollars(totals?.profit ?? 0))}
          tone="money"
        />
        <StatTile
          label="Billable to buyers"
          loading={loading}
          figure={figure(count(totals?.billableToBuyers ?? 0))}
        />
        <StatTile
          label="Sell-through"
          loading={loading}
          figure={figure(pct(totals?.sellThroughPct ?? null, 1))}
        />
      </PanelBody>
    </Panel>
  );
}
