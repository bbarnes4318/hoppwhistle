'use client';

/**
 * One condition, every carrier.
 *
 * "How does a stent two years ago land?" -- asked across the whole market at
 * once. The applicant is fixed (Texas, male, non-tobacco, $10,000 monthly, no
 * medications) so the only thing that varies is the condition and its timing.
 */

import { DIAGNOSED_BUCKETS, TREATED_BUCKETS } from '@hopwhistle/fex-engine/catalog';
import * as React from 'react';

import {
  DataTable,
  Notice,
  Panel,
  PanelBody,
  PanelHeader,
  PanelTitle,
  StatusChip,
  type Column,
  CarrierLogo,
} from '@/components/domain';
import { useFexCatalog } from '@/hooks/use-fex-quote';
import { fexApi, money, type FexResult } from '@/lib/fex/api';
import { searchConditions } from '@/lib/fex/condition-search';

import { Combobox } from '../combobox';
import { benefitTone, bucketFrom, bucketValue, Field, NativeSelect, TextInput } from '../parts';

export function ConditionLookup(): JSX.Element {
  const { catalog } = useFexCatalog();
  const [query, setQuery] = React.useState('');
  const [code, setCode] = React.useState<string | null>(null);
  const [age, setAge] = React.useState('65');
  const [diagnosed, setDiagnosed] = React.useState<number | undefined>(undefined);
  const [treated, setTreated] = React.useState<number | null | undefined>(undefined);
  const [results, setResults] = React.useState<FexResult[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const conditions = catalog?.conditions ?? [];
  const label = conditions.find(c => c.code === code)?.label;

  React.useEffect(() => {
    const n = Number(age);
    if (!code || !Number.isInteger(n) || n < 18 || n > 100) return;
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      void fexApi
        .quote(
          {
            state: 'TX',
            sex: 'M',
            tobacco: false,
            age: n,
            face: 10000,
            mode: 'monthly',
            meds: [],
            conditions: [
              {
                code,
                ...(diagnosed !== undefined ? { diagnosedMonthsAgo: diagnosed } : {}),
                ...(treated !== undefined ? { treatedMonthsAgo: treated } : {}),
              },
            ],
          },
          controller.signal
        )
        .then(result => {
          if (controller.signal.aborted) return;
          setLoading(false);
          if (result.ok) {
            setResults(result.data.results);
            setError(null);
          } else setError(result.message);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [code, age, diagnosed, treated]);

  const columns: Column<FexResult>[] = [
    {
      id: 'plan',
      header: 'Carrier · plan',
      cell: r => (
        <span className="flex items-center gap-2.5">
          <CarrierLogo names={[r.family, r.productId]} size="xs" />
          <span className="min-w-0">
            <span className="font-medium text-ink">{r.family}</span>
            <span className="text-ink-2"> · {r.product}</span>
          </span>
        </span>
      ),
    },
    {
      id: 'result',
      header: 'Result',
      cell: r =>
        !r.eligible ? (
          <StatusChip
            value="DECLINE"
            tone="dropped"
            size="sm"
            label={r.outcome === 'DECLINE' ? 'Decline' : 'Not available'}
          />
        ) : !r.uwLoaded ? (
          <StatusChip value="PRICE_ONLY" tone="neutral" size="sm" dot={false} label="Not loaded" />
        ) : (
          <StatusChip
            value={r.best?.benefit ?? 'X'}
            tone={benefitTone(r.best?.benefit)}
            size="sm"
            label={r.outcomeLabel || r.best?.classLabel}
          />
        ),
    },
    {
      id: 'because',
      header: 'Because',
      hideBelow: 'md',
      cell: r => {
        const reason = r.reasons[0];
        if (!reason)
          return <span className="text-ink-3">{r.uwLoaded ? 'No rule triggered' : '—'}</span>;
        return (
          <span className="text-ink-2">
            {reason.text}
            {reason.page != null ? (
              <span className="t-meta ml-1 text-ink-3">p.{reason.page}</span>
            ) : null}
          </span>
        );
      },
    },
    {
      id: 'premium',
      header: '$10k monthly',
      numeric: true,
      cell: r => (
        <span className="t-num tabular-nums">{r.eligible ? money(r.best?.premium) : '—'}</span>
      ),
    },
  ];

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>One condition, every carrier</PanelTitle>
        <p className="t-meta mt-1 text-ink-3">
          A Texas man, non-tobacco, $10,000 monthly, no medications — only the condition changes.
        </p>
      </PanelHeader>
      <PanelBody className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_100px_minmax(0,1fr)_minmax(0,1fr)]">
          <Combobox
            id="lookup-condition"
            label="Condition"
            query={query}
            onQueryChange={setQuery}
            placeholder={label ?? 'Search conditions'}
            options={searchConditions(conditions, query, 12).map(c => ({
              id: c.code,
              label: c.label,
              meta: c.category,
            }))}
            onPick={setCode}
          />
          <Field label="Age" htmlFor="lookup-age">
            <TextInput
              id="lookup-age"
              inputMode="numeric"
              maxLength={3}
              value={age}
              onChange={e => setAge(e.target.value.replace(/\D/g, ''))}
            />
          </Field>
          <Field label="Diagnosed" htmlFor="lookup-dx">
            <NativeSelect
              id="lookup-dx"
              value={bucketValue(diagnosed)}
              onChange={e => setDiagnosed(bucketFrom(e.target.value) ?? undefined)}
            >
              {DIAGNOSED_BUCKETS.map(([text, months]) => (
                <option key={text} value={bucketValue(months)}>
                  {text}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Last treated" htmlFor="lookup-tx">
            <NativeSelect
              id="lookup-tx"
              value={bucketValue(treated)}
              onChange={e => setTreated(bucketFrom(e.target.value))}
            >
              {TREATED_BUCKETS.map(([text, months]) => (
                <option key={text} value={bucketValue(months)}>
                  {text}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
        {label ? (
          <p className="text-sm text-ink">
            Showing: <span className="font-medium">{label}</span>
          </p>
        ) : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
      </PanelBody>
      {code ? (
        <DataTable
          columns={columns}
          rows={results ?? []}
          rowKey={r => r.productId}
          loading={loading && !results}
          caption={`Every carrier for ${label ?? code}`}
          empty={{ headline: 'No carriers returned' }}
        />
      ) : (
        <p className="px-5 pb-6 text-sm text-ink-2">
          Pick a condition to see how every carrier treats it.
        </p>
      )}
    </Panel>
  );
}
