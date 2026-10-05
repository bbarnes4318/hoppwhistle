'use client';

/**
 * One medication, every carrier: how each carrier's prescription list prints
 * it, what use it is listed for, and what it does to the case.
 */

import * as React from 'react';

import { Notice, Panel, PanelBody, PanelHeader, PanelTitle, StatusChip } from '@/components/domain';
import { useAuth } from '@/hooks/use-auth';
import { fexApi, type FexDrugDetail, type FexDrugHit, type FexDrugRule } from '@/lib/fex/api';

import { Combobox } from '../combobox';
import { outcomeTone } from '../parts';

export function DrugLookup(): JSX.Element {
  const { isPlatformAdmin } = useAuth();
  const [query, setQuery] = React.useState('');
  const [hits, setHits] = React.useState<FexDrugHit[]>([]);
  const [detail, setDetail] = React.useState<FexDrugDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void fexApi.searchDrugs(q, 10, controller.signal).then(result => {
        if (!controller.signal.aborted) setHits(result.ok ? result.data : []);
      });
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const pick = async (id: string) => {
    setLoading(true);
    const result = await fexApi.drug(id);
    setLoading(false);
    if (result.ok) {
      setDetail(result.data);
      setError(null);
    } else setError(result.message);
  };

  const byCarrier = React.useMemo(() => {
    const groups = new Map<string, FexDrugRule[]>();
    for (const rule of detail?.rules ?? []) {
      const key = `${rule.family} · ${rule.product}`;
      groups.set(key, [...(groups.get(key) ?? []), rule]);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [detail]);

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>One medication, every carrier</PanelTitle>
        <p className="t-meta mt-1 text-ink-3">
          Each carrier&apos;s prescription list, as printed, with the page it is on.
        </p>
      </PanelHeader>
      <PanelBody className="space-y-4">
        <Combobox
          id="lookup-drug"
          label="Medication"
          query={query}
          onQueryChange={setQuery}
          minChars={2}
          placeholder="Brand or generic"
          options={hits.map(h => ({
            id: h.id,
            label: (
              <>
                <span className="capitalize">{h.generic}</span>
                {h.brands.length ? (
                  <span className="text-ink-2"> · {h.brands.join(', ')}</span>
                ) : null}
              </>
            ),
            meta: h.drugClass ?? undefined,
          }))}
          onPick={id => void pick(id)}
        />
        {error ? <Notice tone="error">{error}</Notice> : null}
        {loading ? <p className="t-meta text-ink-3">Loading…</p> : null}
        {detail ? (
          <div>
            <h3 className="t-section text-ink">
              <span className="capitalize">{detail.generic}</span>
              {detail.brands.length ? (
                <span className="font-normal text-ink-2">
                  {' '}
                  · {detail.brands.slice(0, 4).join(', ')}
                </span>
              ) : null}
            </h3>
            {detail.drugClass ? <p className="t-meta text-ink-3">{detail.drugClass}</p> : null}
            {byCarrier.length === 0 ? (
              <p className="mt-3 text-sm text-ink-2">
                No carrier lists this medication. It does not change any result on its own.
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">How each carrier lists {detail.generic}</caption>
                  <thead>
                    <tr className="border-b border-rule-strong text-left">
                      {['Carrier · plan', 'Printed as', 'Use', 'Result', 'Window', 'Page'].map(
                        (h, i) => (
                          <th
                            key={h}
                            scope="col"
                            className={`t-caption px-2 py-2 font-medium text-ink-2 ${i === 1 || i >= 4 ? 'hidden md:table-cell' : ''}`}
                          >
                            {h}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {byCarrier.map(([carrier, rules]) =>
                      rules.map((rule, i) => (
                        <tr key={`${carrier}-${i}`} className="border-b border-rule align-top">
                          <td className="px-2 py-2 font-medium text-ink">
                            {i === 0 ? carrier : ''}
                          </td>
                          <td className="hidden px-2 py-2 text-ink-2 md:table-cell">
                            {rule.printedAs}
                          </td>
                          <td className="px-2 py-2 text-ink-2">
                            {rule.use}
                            {rule.dependsOnUse ? (
                              <span className="t-meta block text-ringing-ink">Depends on use</span>
                            ) : null}
                          </td>
                          <td className="px-2 py-2">
                            <StatusChip
                              value={rule.outcome}
                              tone={outcomeTone(rule.outcome)}
                              size="sm"
                              label={rule.outcomeLabel}
                            />
                            {isPlatformAdmin && rule.note ? (
                              <span className="t-meta mt-1 block text-ink-3">
                                Source note: {rule.note}
                              </span>
                            ) : null}
                          </td>
                          <td className="hidden px-2 py-2 text-ink-2 md:table-cell">
                            {rule.window ?? '—'}
                          </td>
                          <td className="t-num hidden px-2 py-2 tabular-nums text-ink-2 md:table-cell">
                            {rule.page ?? '—'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}
      </PanelBody>
    </Panel>
  );
}
