'use client';

import { Check, Landmark, Loader2, Search, X } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import {
  CarrierLogo,
  Notice,
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
} from '@/components/domain';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useFexCatalog, useFexSettings } from '@/hooks/use-fex-quote';
import { fexApi, type FexCatalogProduct } from '@/lib/fex/api';
import { cn } from '@/lib/utils';

/**
 * The carriers an agent quotes, kept by the agent, on Account.
 *
 * Only carriers the quoter actually quotes are offered: the list is the
 * catalog's quotable plans, grouped by carrier family -- the same families the
 * quote results are cut by. The pick is saved on the agent
 * (`PUT /api/v1/fex/settings/me`, `{ carriers }`), and from then on every quote
 * they run, on the Quote page, in a call or on a customer, carries only those
 * carriers' plans. Picking every carrier is saved as "every carrier", so a
 * carrier added to the quoter later shows up without a visit here.
 *
 * It narrows the agency's own settings; it never widens them. A carrier the
 * agency is not appointed with is marked, since its plans stay behind "Show not
 * appointed" in the quoter.
 */

interface CarrierOption {
  family: string;
  plans: string[];
  /** False when the agency quotes appointed plans only and none of these is one. */
  appointed: boolean;
}

function carriersOf(products: readonly FexCatalogProduct[]): CarrierOption[] {
  const byFamily = new Map<string, CarrierOption>();
  for (const p of products) {
    if (!p.quotable) continue;
    const option = byFamily.get(p.family) ?? { family: p.family, plans: [], appointed: false };
    option.plans.push(p.product);
    option.appointed ||= p.appointed;
    byFamily.set(p.family, option);
  }
  return [...byFamily.values()].sort((a, b) => a.family.localeCompare(b.family));
}

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
  a.size === b.size && [...a].every(x => b.has(x));

export function QuoteCarriersPanel({ readOnly = false }: { readOnly?: boolean }): JSX.Element {
  const { catalog, error: catalogError } = useFexCatalog();
  const { settings, loading, setSettings } = useFexSettings();

  const carriers = React.useMemo(() => carriersOf(catalog?.products ?? []), [catalog]);
  const all = React.useMemo(() => new Set(carriers.map(c => c.family)), [carriers]);
  /** What is saved: the agent's pick, or every carrier when they have none. */
  const saved = React.useMemo(
    () =>
      new Set(settings?.me.carriers?.length ? settings.me.carriers.filter(c => all.has(c)) : all),
    [settings, all]
  );

  const [selected, setSelected] = React.useState<Set<string> | null>(null);
  const [query, setQuery] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [justSaved, setJustSaved] = React.useState(false);

  // The form starts from what is saved, once both reads are in.
  const ready = carriers.length > 0 && settings !== null;
  React.useEffect(() => {
    if (ready && selected === null) setSelected(new Set(saved));
  }, [ready, saved, selected]);

  if (catalogError && !catalog) {
    return (
      <PanelShell>
        <Notice tone="error" title="The carrier list could not be loaded." />
      </PanelShell>
    );
  }
  if (!ready || selected === null) {
    return (
      <PanelShell>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {Array.from({ length: loading ? 6 : 3 }, (_, i) => (
            <Skeleton key={i} className="h-[66px] rounded-card" />
          ))}
        </div>
      </PanelShell>
    );
  }

  const changed = !sameSet(selected, saved);
  const everyCarrier = selected.size === all.size;
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? carriers.filter(
        c =>
          c.family.toLowerCase().includes(needle) ||
          c.plans.some(p => p.toLowerCase().includes(needle))
      )
    : carriers;

  const edit = (next: Set<string>) => {
    setSelected(next);
    setError(null);
    setJustSaved(false);
  };
  const toggle = (family: string) => {
    const next = new Set(selected);
    if (next.has(family)) next.delete(family);
    else next.add(family);
    edit(next);
  };

  async function save(): Promise<void> {
    if (!selected || selected.size === 0) {
      setError('Choose at least one carrier to quote.');
      return;
    }
    setSaving(true);
    const result = await fexApi.saveMySettings({
      carriers: selected.size === all.size ? null : [...selected].sort(),
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.message || 'Your carriers were not saved.');
      return;
    }
    if (settings) setSettings({ ...settings, me: result.data.me });
    setSelected(
      new Set(result.data.me.carriers?.length ? result.data.me.carriers : [...all.values()])
    );
    setError(null);
    setJustSaved(true);
  }

  return (
    <PanelShell
      count={
        <span className="t-meta whitespace-nowrap rounded-full bg-sunken px-2.5 py-1 font-medium tabular-nums text-ink-2">
          {everyCarrier ? `All ${all.size}` : `${selected.size} of ${all.size}`} selected
        </span>
      }
    >
      <div className="grid gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-[200px] flex-1">
            <span className="sr-only">Find a carrier</span>
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3"
            />
            <Input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Find a carrier or plan"
              className="pl-9"
            />
          </label>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              disabled={readOnly || everyCarrier}
              onClick={() => edit(new Set(all))}
            >
              <Check aria-hidden className="mr-1.5 h-3.5 w-3.5" />
              Select all
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={readOnly || selected.size === 0}
              onClick={() => edit(new Set())}
            >
              <X aria-hidden className="mr-1.5 h-3.5 w-3.5" />
              Clear
            </Button>
          </div>
        </div>

        {shown.length ? (
          <ul
            role="group"
            aria-label="Carriers you quote"
            className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3"
          >
            {shown.map(carrier => {
              const on = selected.has(carrier.family);
              const id = `quote-carrier-${carrier.family.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
              return (
                <li key={carrier.family}>
                  <label
                    htmlFor={id}
                    data-carrier={carrier.family}
                    data-selected={on || undefined}
                    className={cn(
                      'group flex h-full cursor-pointer items-center gap-3 rounded-card border px-3 py-2.5 transition-colors duration-150 ne-motion',
                      'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-1',
                      on
                        ? 'border-brand bg-brand-tint'
                        : 'border-rule bg-surface hover:border-ink-3',
                      readOnly && 'cursor-not-allowed opacity-70'
                    )}
                  >
                    <input
                      id={id}
                      type="checkbox"
                      className="sr-only"
                      checked={on}
                      disabled={readOnly}
                      onChange={() => toggle(carrier.family)}
                    />
                    <CarrierLogo names={[carrier.family]} size="sm" />
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="truncate text-sm font-medium text-ink">
                        {carrier.family}
                      </span>
                      <span className="t-meta truncate text-ink-3" title={carrier.plans.join(', ')}>
                        {carrier.plans.length === 1
                          ? carrier.plans[0]
                          : `${carrier.plans.length} plans`}
                        {carrier.appointed ? null : (
                          <span className="text-ringing-ink"> · Agency not appointed</span>
                        )}
                      </span>
                    </span>
                    <span
                      aria-hidden
                      className={cn(
                        'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors duration-150 ne-motion',
                        on
                          ? 'border-brand-strong bg-brand-strong text-white'
                          : 'border-rule-strong bg-surface text-transparent group-hover:border-ink-3'
                      )}
                    >
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-card border border-dashed border-rule px-4 py-6 text-center text-sm text-ink-3">
            No carrier matches &ldquo;{query.trim()}&rdquo;.
          </p>
        )}

        {error ? <Notice tone="error" title={error} /> : null}
        {justSaved && !changed ? (
          <Notice
            tone="info"
            title={
              everyCarrier
                ? 'Saved. Your quotes show every carrier.'
                : `Saved. Your quotes show ${selected.size} ${selected.size === 1 ? 'carrier' : 'carriers'}.`
            }
          />
        ) : null}

        <div className="flex flex-wrap items-center gap-2 border-t border-rule pt-4">
          <Button
            size="sm"
            onClick={() => void save()}
            disabled={readOnly || saving || !changed || selected.size === 0}
          >
            {saving ? <Loader2 aria-hidden className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            Save carriers
          </Button>
          {changed ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => edit(new Set(saved))}
              disabled={saving}
            >
              Undo changes
            </Button>
          ) : null}
          <span className="t-meta ml-auto text-ink-3">
            {readOnly ? (
              'Not available in a read-only preview.'
            ) : selected.size === 0 ? (
              <span className="text-dropped-ink">Select at least one carrier.</span>
            ) : changed ? (
              'Unsaved changes'
            ) : (
              <Link href="/quote" className="font-medium text-brand-ink hover:underline">
                Open the quoter
              </Link>
            )}
          </span>
        </div>
      </div>
    </PanelShell>
  );
}

function PanelShell({
  count,
  children,
}: {
  count?: React.ReactNode;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <Panel data-quote-carriers>
      <PanelHeader action={count}>
        <PanelTitle className="flex items-center gap-2">
          <Landmark className="h-4 w-4 text-ink-3" aria-hidden />
          Quote carriers
        </PanelTitle>
        <PanelDescription>
          The quoter shows plans from these carriers only. Changes apply to your next quote.
        </PanelDescription>
      </PanelHeader>
      <PanelBody>{children}</PanelBody>
    </Panel>
  );
}
