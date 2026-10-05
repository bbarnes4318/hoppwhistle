'use client';

/**
 * What the quoter knows about each carrier: which plans it quotes, how current
 * the rates are, where the health rules came from, and how much of them is
 * loaded. Names and counts only -- the rate tables and rules stay on the
 * server.
 */

import { BENEFIT_LABEL } from '@hopwhistle/fex-engine/catalog';

import {
  DataTable,
  Notice,
  Panel,
  PanelHeader,
  PanelTitle,
  StatusChip,
  type Column,
} from '@/components/domain';
import { useFexCatalog } from '@/hooks/use-fex-quote';
import type { FexCatalogProduct } from '@/lib/fex/api';

import { dataTone } from '../parts';

export function CarrierCoverage(): JSX.Element {
  const { catalog, error } = useFexCatalog();
  const rows = [...(catalog?.products ?? [])].sort(
    (a, b) =>
      Number(b.quotable) - Number(a.quotable) ||
      a.family.localeCompare(b.family) ||
      a.product.localeCompare(b.product)
  );

  const columns: Column<FexCatalogProduct>[] = [
    {
      id: 'plan',
      header: 'Carrier · plan',
      cell: p => (
        <div className="min-w-0 py-1">
          <p className="text-ink">
            <span className="font-medium">{p.family}</span>
            <span className="text-ink-2"> · {p.product}</span>
          </p>
          <div className="mt-0.5 flex flex-wrap gap-1">
            {!p.quotable ? (
              <StatusChip
                value="NOT_QUOTED"
                tone="neutral"
                size="sm"
                dot={false}
                label="Not quoted"
              />
            ) : null}
            {p.quotable && !p.appointed ? (
              <StatusChip
                value="NOT_APPOINTED"
                tone="neutral"
                size="sm"
                dot={false}
                label="Not appointed"
              />
            ) : null}
          </div>
          {p.alerts.length ? (
            <details className="mt-1">
              <summary className="t-meta cursor-pointer text-brand-ink">
                {p.alerts.length} carrier {p.alerts.length === 1 ? 'note' : 'notes'}
              </summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-ink-2">
                {p.alerts.map(a => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ),
    },
    {
      id: 'classes',
      header: 'Classes',
      hideBelow: 'lg',
      cell: p => (
        <span className="text-ink-2">
          {p.classes.map(c => `${c.label} (${BENEFIT_LABEL[c.benefit] ?? c.benefit})`).join(', ')}
        </span>
      ),
    },
    {
      id: 'rates',
      header: 'Rates',
      cell: p => (
        <div>
          <StatusChip
            value={p.ratesStatus.code}
            tone={dataTone(p.ratesStatus.tone)}
            size="sm"
            label={p.ratesStatus.label}
          />
          {p.sourceDate ? <p className="t-meta mt-0.5 text-ink-3">{p.sourceDate}</p> : null}
        </div>
      ),
    },
    {
      id: 'uw',
      header: 'Health rules',
      hideBelow: 'md',
      cell: p => <span className="text-ink-2">{p.uwStatus.label}</span>,
    },
    {
      id: 'counts',
      header: 'Rules · Rx · build',
      numeric: true,
      hideBelow: 'md',
      cell: p => (
        <span className="t-num tabular-nums text-ink-2">
          {p.counts.rules} · {p.counts.rx} · {p.counts.build}
        </span>
      ),
    },
  ];

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Carrier data</PanelTitle>
        <p className="t-meta mt-1 text-ink-3">
          {catalog
            ? `${catalog.products.filter(p => p.quotable).length} plans quoted · data build ${catalog.engineVersion}`
            : 'Loading the carrier list…'}
        </p>
      </PanelHeader>
      {error ? (
        <Notice tone="error" className="m-4">
          {error}
        </Notice>
      ) : null}
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={p => p.id}
        loading={!catalog && !error}
        caption="Carriers the quoter covers"
        stickyHeader={false}
      />
    </Panel>
  );
}
