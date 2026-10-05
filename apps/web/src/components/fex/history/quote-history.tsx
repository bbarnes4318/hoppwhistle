'use client';

/**
 * Saved quotes. An agent sees their own; an agency principal sees every
 * agent's, with the agent named. Opening one shows the inputs and the ranked
 * results exactly as they were quoted, read-only.
 */

import { BENEFIT_LABEL } from '@hopwhistle/fex-engine/catalog';
import Link from 'next/link';
import * as React from 'react';

import {
  CarrierLogo,
  DataTable,
  DrawerField,
  DrawerSection,
  Notice,
  Panel,
  SheetDrawer,
  type Column,
} from '@/components/domain';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { useFexCatalog } from '@/hooks/use-fex-quote';
import {
  fexApi,
  MODE_SHORT,
  money,
  wholeDollars,
  type FexQuoteDetail,
  type FexQuoteSummary,
} from '@/lib/fex/api';

import { ResultRow } from '../result-row';

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

export function QuoteHistory(): JSX.Element {
  const { hasFullAccess, isPlatformAdmin } = useAuth();
  const principal = hasFullAccess || isPlatformAdmin;
  const [rows, setRows] = React.useState<FexQuoteSummary[]>([]);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [openId, setOpenId] = React.useState<string | null>(null);

  const load = React.useCallback(async (after?: string) => {
    setLoading(true);
    const result = await fexApi.list({ limit: 50, cursor: after });
    setLoading(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setError(null);
    setRows(prev => (after ? [...prev, ...result.data] : result.data));
    setCursor(result.nextCursor ?? null);
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const columns: Column<FexQuoteSummary>[] = [
    {
      id: 'when',
      header: 'Quoted',
      cell: q => <span className="tabular-nums">{dateTime(q.createdAt)}</span>,
    },
    {
      id: 'prospect',
      header: 'Prospect',
      cell: q => q.prospectName ?? <span className="text-ink-3">—</span>,
    },
    {
      id: 'who',
      header: 'State · age',
      hideBelow: 'md',
      cell: q => (
        <span className="tabular-nums">
          {q.state} · {q.age ?? '—'}
        </span>
      ),
    },
    {
      id: 'ask',
      header: 'Face or budget',
      numeric: true,
      hideBelow: 'lg',
      cell: q =>
        q.faceAmount
          ? wholeDollars(q.faceAmount)
          : q.budget
            ? `${money(q.budget)}/${MODE_SHORT[q.paymentMode]}`
            : '—',
    },
    {
      id: 'selected',
      header: 'Selected',
      cell: q =>
        q.selectedCarrier ? (
          <span className="flex items-center gap-2.5">
            <CarrierLogo names={[q.selectedCarrier, q.selectedProductId]} size="xs" />
            <span className="min-w-0">
              <span className="font-medium">{q.selectedCarrier}</span>
              <span className="text-ink-2">
                {' '}
                · {q.selectedProduct} · {q.selectedClass}
              </span>
            </span>
          </span>
        ) : (
          <span className="text-ink-3">Saved, none used</span>
        ),
    },
    {
      id: 'premium',
      header: 'Premium',
      numeric: true,
      cell: q =>
        q.selectedPremium != null ? (
          <span className="t-num tabular-nums">
            {money(q.selectedPremium)}
            <span className="text-ink-3">/{MODE_SHORT[q.paymentMode]}</span>
          </span>
        ) : (
          '—'
        ),
    },
    ...(principal
      ? [
          {
            id: 'agent',
            header: 'Agent',
            hideBelow: 'md' as const,
            cell: (q: FexQuoteSummary) => q.createdBy.name,
          },
        ]
      : []),
    {
      id: 'app',
      header: 'Application',
      hideBelow: 'sm',
      cell: q =>
        q.applicationId ? (
          <Link
            href="/applications"
            className="text-brand-ink hover:underline"
            onClick={e => e.stopPropagation()}
          >
            Application
          </Link>
        ) : null,
    },
  ];

  return (
    <Panel>
      {error ? (
        <Notice
          tone="error"
          className="m-4"
          action={
            <Button size="sm" variant="outline" onClick={() => void load()}>
              Retry
            </Button>
          }
        >
          {error}
        </Notice>
      ) : null}
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={q => q.id}
        loading={loading && rows.length === 0}
        onRowActivate={q => setOpenId(q.id)}
        caption="Saved quotes"
        empty={{
          headline: 'No saved quotes yet',
          body: 'A quote is saved when you use it or choose Save quote on a result.',
        }}
      />
      {cursor ? (
        <div className="border-t border-rule p-3 text-center">
          <Button size="sm" variant="outline" disabled={loading} onClick={() => void load(cursor)}>
            Load more
          </Button>
        </div>
      ) : null}
      <SavedQuoteDrawer id={openId} onClose={() => setOpenId(null)} />
    </Panel>
  );
}

function SavedQuoteDrawer({
  id,
  onClose,
}: {
  id: string | null;
  onClose: () => void;
}): JSX.Element {
  const { isPlatformAdmin } = useAuth();
  const { catalog } = useFexCatalog();
  const [detail, setDetail] = React.useState<FexQuoteDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<string | null>(null);

  React.useEffect(() => {
    setDetail(null);
    setError(null);
    if (!id) return;
    let active = true;
    void fexApi.read(id).then(result => {
      if (!active) return;
      if (result.ok) setDetail(result.data);
      else setError(result.message);
    });
    return () => {
      active = false;
    };
  }, [id]);

  const label = (code: string) => catalog?.conditions.find(c => c.code === code)?.label ?? code;
  const a = detail?.applicant;

  return (
    <SheetDrawer
      open={Boolean(id)}
      onOpenChange={open => !open && onClose()}
      title={detail?.prospectName ? `Quote — ${detail.prospectName}` : 'Saved quote'}
      description={detail ? `${dateTime(detail.createdAt)} · ${detail.createdBy.name}` : undefined}
      size="xl"
    >
      {error ? (
        <Notice tone="error" className="m-4">
          {error}
        </Notice>
      ) : null}
      {a && detail ? (
        <>
          <DrawerSection title="Applicant">
            <DrawerField label="State">{a.state}</DrawerField>
            <DrawerField label="Age">{detail.age ?? '—'}</DrawerField>
            <DrawerField label="Sex">{a.sex === 'F' ? 'Female' : 'Male'}</DrawerField>
            <DrawerField label="Tobacco">{a.tobacco ? 'Yes' : 'No'}</DrawerField>
            {a.heightIn ? (
              <DrawerField label="Build">
                {Math.floor(a.heightIn / 12)}&apos;{a.heightIn % 12}&quot; · {a.weightLb} lb
              </DrawerField>
            ) : null}
            <DrawerField label="Coverage">
              {a.face ? wholeDollars(a.face) : `${money(a.budget)} budget`} · {a.mode}
            </DrawerField>
            <DrawerField label="Conditions">
              {a.conditions.length ? a.conditions.map(c => label(c.code)).join(', ') : 'None'}
            </DrawerField>
            <DrawerField label="Medications">
              {a.meds.length ? a.meds.map(m => m.name ?? m.drugId).join(', ') : 'None'}
            </DrawerField>
            {detail.selectedCarrier ? (
              <DrawerField label="Used">
                <CarrierLogo
                  names={[detail.selectedCarrier, detail.selectedProductId]}
                  size="sm"
                  className="mb-1.5 flex"
                />
                {detail.selectedCarrier} · {detail.selectedProduct} · {detail.selectedClass} (
                {BENEFIT_LABEL[detail.selectedBenefit ?? ''] ?? detail.selectedBenefit}) ·{' '}
                {money(detail.selectedPremium)}/{MODE_SHORT[detail.paymentMode]}
              </DrawerField>
            ) : null}
          </DrawerSection>
          <section className="px-4 py-3">
            <h3 className="t-label mb-2 text-ink-3">Results as quoted</h3>
            <ul className="rounded-card border border-rule">
              {detail.results.map(r => (
                <ResultRow
                  key={r.productId}
                  result={r}
                  expanded={expanded === r.productId}
                  onToggle={() => setExpanded(e => (e === r.productId ? null : r.productId))}
                  isStaff={isPlatformAdmin}
                  priceOnly={r.eligible && !r.uwLoaded}
                />
              ))}
            </ul>
          </section>
        </>
      ) : !error && id ? (
        <p className="t-meta p-4 text-ink-3">Loading…</p>
      ) : null}
    </SheetDrawer>
  );
}
