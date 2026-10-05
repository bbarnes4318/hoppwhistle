'use client';

/**
 * How your agents quote: how many quotes, how many were used, how many became
 * applications, and which plans they choose. Agency principals only (the API
 * answers 403 to an agent).
 */

import * as React from 'react';

import {
  DataTable,
  Notice,
  Panel,
  PanelHeader,
  PanelTitle,
  StatTile,
  StatTileRow,
  type Column,
} from '@/components/domain';
import { isSendable, localDayKey, PeriodPicker } from '@/components/leaderboard/period-picker';
import type { PeriodKey } from '@/components/leaderboard/types';
import { fexApi, money, type FexInsights } from '@/lib/fex/api';

type AgentRow = FexInsights['savedBy'][number];
type PlanRow = FexInsights['topSelected'][number];

function daysBetween(from: string, to: string): number {
  return (
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1
  );
}

export function QuoteInsights(): JSX.Element {
  const [period, setPeriod] = React.useState<{ period: PeriodKey; from: string; to: string }>({
    period: 'THIS_MONTH',
    from: localDayKey(7),
    to: localDayKey(0),
  });
  const [data, setData] = React.useState<FexInsights | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    if (!isSendable(period.period, period.from, period.to)) return;
    let active = true;
    setLoading(true);
    const custom = period.period === 'CUSTOM';
    void fexApi
      .insights(period.period, custom ? period.from : undefined, custom ? period.to : undefined)
      .then(result => {
        if (!active) return;
        setLoading(false);
        if (result.ok) {
          setData(result.data);
          setError(null);
        } else setError(result.message);
      });
    return () => {
      active = false;
    };
  }, [period]);

  const agentColumns: Column<AgentRow>[] = [
    { id: 'name', header: 'Agent', cell: r => r.name },
    {
      id: 'quotes',
      header: 'Quotes saved',
      numeric: true,
      cell: r => <span className="tabular-nums">{r.quotes}</span>,
    },
    {
      id: 'used',
      header: 'Used',
      numeric: true,
      cell: r => <span className="tabular-nums">{r.used}</span>,
    },
    {
      id: 'apps',
      header: 'Applications',
      numeric: true,
      cell: r => <span className="tabular-nums">{r.applications}</span>,
    },
  ];
  const planColumns: Column<PlanRow>[] = [
    {
      id: 'plan',
      header: 'Carrier · plan',
      cell: r => (
        <span>
          <span className="font-medium">{r.carrier}</span>
          <span className="text-ink-2"> · {r.product}</span>
        </span>
      ),
    },
    {
      id: 'count',
      header: 'Times used',
      numeric: true,
      cell: r => <span className="tabular-nums">{r.count}</span>,
    },
    {
      id: 'avg',
      header: 'Average premium',
      numeric: true,
      cell: r => <span className="tabular-nums">{money(r.avgPremium)}</span>,
    },
  ];

  const rate = data?.conversion.rate;

  return (
    <div className="space-y-4">
      <PeriodPicker
        period={period.period}
        from={period.from}
        to={period.to}
        resolved={
          data
            ? {
                from: data.period.from,
                to: data.period.to,
                days: daysBetween(data.period.from, data.period.to),
                complete: true,
              }
            : null
        }
        onChange={setPeriod}
        disabled={loading}
      />
      {error ? <Notice tone="error">{error}</Notice> : null}
      <StatTileRow>
        <StatTile
          label="Quotes"
          value={data?.quotes ?? 0}
          loading={loading && !data}
          sub="saved by your agents"
        />
        <StatTile
          label="Used"
          value={data?.used ?? 0}
          loading={loading && !data}
          sub="a plan was chosen"
        />
        <StatTile
          label="Applications from quotes"
          value={data?.conversion.applications ?? 0}
          loading={loading && !data}
          sub="written from a saved quote"
        />
        <StatTile
          label="Quote → application"
          figure={rate == null ? '—' : `${Math.round(rate * 100)}%`}
          loading={loading && !data}
          sub="of saved quotes"
        />
      </StatTileRow>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel>
          <PanelHeader>
            <PanelTitle>By agent</PanelTitle>
          </PanelHeader>
          <DataTable
            columns={agentColumns}
            rows={data?.savedBy ?? []}
            rowKey={r => r.agentId}
            loading={loading && !data}
            caption="Quotes by agent"
            empty={{ headline: 'No quotes in this period' }}
          />
        </Panel>
        <Panel>
          <PanelHeader>
            <PanelTitle>Plans your agents choose</PanelTitle>
          </PanelHeader>
          <DataTable
            columns={planColumns}
            rows={data?.topSelected ?? []}
            rowKey={r => r.productId}
            loading={loading && !data}
            caption="Most-used plans"
            empty={{ headline: 'No plan used in this period' }}
          />
        </Panel>
      </div>
    </div>
  );
}
