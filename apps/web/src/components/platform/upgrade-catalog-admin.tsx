'use client';

import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  StatusChip,
} from '@/components/domain';
import { WHITE_LABEL_UPGRADES } from '@/components/layout/nav-config';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/use-toast';
import { apiClient, payload } from '@/lib/api';
import type { Envelope } from '@/lib/api';
import { formatDisplayDate } from '@/lib/format-time';
import {
  centsFromDollars,
  dollarsFromCents,
  type AdminUpgradeRequest,
  type PriceUnit,
  type UpgradePriceRow,
} from '@/lib/upgrade-catalog';

interface DraftRow {
  monthly: string;
  setup: string;
  unit: PriceUnit;
  note: string;
}
type Draft = Record<string, DraftRow>;

const EMPTY_ROW: DraftRow = { monthly: '', setup: '', unit: 'AGENCY', note: '' };

function draftFrom(rows: UpgradePriceRow[]): Draft {
  return Object.fromEntries(
    rows.map(row => [
      row.key,
      {
        monthly: dollarsFromCents(row.monthlyCents),
        setup: dollarsFromCents(row.setupCents),
        unit: row.priceUnit ?? 'AGENCY',
        note: row.usageNote ?? '',
      },
    ])
  );
}

/**
 * Upgrade prices: NetEnroll's monthly and setup price for each upgrade, in
 * dollars, as agencies read them on /upgrades. Empty means "Ask for pricing";
 * 0 reads "Included". Each price is per agency or per agent, and may carry a
 * one-line note (the minutes it includes) shown under it.
 * One Save for the whole table, through `PUT /api/v1/admin/upgrade-prices`.
 */
export function UpgradePricesPanel(): JSX.Element {
  const [saved, setSaved] = useState<Draft | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void apiClient.get<Envelope<UpgradePriceRow[]>>('/api/v1/admin/upgrade-prices').then(res => {
      if (cancelled) return;
      const rows = payload(res);
      if (res.error || !Array.isArray(rows)) {
        setError(res.error?.message ?? 'Could not read the upgrade prices.');
        return;
      }
      const next = draftFrom(rows);
      setSaved(next);
      setDraft(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const invalid = WHITE_LABEL_UPGRADES.some(({ key }) => {
    const row = draft[key];
    return (
      row !== undefined &&
      (centsFromDollars(row.monthly) === undefined || centsFromDollars(row.setup) === undefined)
    );
  });
  const changed = saved !== null && JSON.stringify(saved) !== JSON.stringify(draft);

  async function save(): Promise<void> {
    setBusy(true);
    try {
      const prices = WHITE_LABEL_UPGRADES.map(({ key }) => ({
        key,
        monthlyCents: centsFromDollars(draft[key]?.monthly ?? '') ?? null,
        setupCents: centsFromDollars(draft[key]?.setup ?? '') ?? null,
        priceUnit: draft[key]?.unit ?? 'AGENCY',
        usageNote: draft[key]?.note.trim() || null,
      }));
      const res = await apiClient.put<Envelope<UpgradePriceRow[]>>('/api/v1/admin/upgrade-prices', {
        prices,
      });
      const rows = payload(res);
      if (res.error || !Array.isArray(rows)) {
        toast.error('Prices not saved', res.error?.message);
        return;
      }
      const next = draftFrom(rows);
      setSaved(next);
      setDraft(next);
      toast.success('Upgrade prices saved');
    } finally {
      setBusy(false);
    }
  }

  const set = <F extends keyof DraftRow>(key: string, field: F, value: DraftRow[F]) =>
    setDraft(current => ({
      ...current,
      [key]: { ...(current[key] ?? EMPTY_ROW), [field]: value },
    }));

  return (
    <Panel className="min-w-0" data-upgrade-prices="">
      <PanelHeader
        action={
          <Button size="sm" onClick={() => void save()} disabled={!changed || invalid || busy}>
            {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            Save
          </Button>
        }
      >
        <PanelTitle>Upgrade prices</PanelTitle>
        <PanelDescription>
          In dollars. Leave a price empty and agencies read &ldquo;Ask for pricing&rdquo;; 0 reads
          &ldquo;Included&rdquo;.
        </PanelDescription>
      </PanelHeader>
      <PanelBody>
        {error ? <p className="t-meta text-dropped-ink">{error}</p> : null}
        <div
          className="hidden gap-3 pb-2 t-label text-ink-3 sm:grid sm:grid-cols-[minmax(0,1fr)_7rem_7rem_8.5rem]"
          aria-hidden
        >
          <span>Upgrade</span>
          <span>Monthly</span>
          <span>Setup</span>
          <span>Billed</span>
        </div>
        <div className="flex flex-col divide-y divide-rule border-t border-rule">
          {WHITE_LABEL_UPGRADES.map(({ key, item }) => {
            const row = draft[key] ?? EMPTY_ROW;
            const disabled = saved === null || busy;
            return (
              <div
                key={key}
                className="grid grid-cols-2 items-center gap-x-3 gap-y-2 py-3 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_8.5rem]"
                data-upgrade-price-row={key}
              >
                <span className="col-span-2 t-body font-medium text-ink sm:col-span-1">
                  {item.name}
                </span>
                {(['monthly', 'setup'] as const).map(field => (
                  <div key={field} className="relative">
                    <span
                      aria-hidden
                      className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-ink-3"
                    >
                      $
                    </span>
                    <Input
                      aria-label={`${item.name} ${field === 'monthly' ? 'monthly' : 'setup'} price`}
                      inputMode="decimal"
                      placeholder={field === 'monthly' ? 'Monthly' : 'Setup'}
                      value={row[field]}
                      disabled={disabled}
                      aria-invalid={centsFromDollars(row[field]) === undefined}
                      onChange={event => set(key, field, event.target.value)}
                      className="h-9 pl-6 tabular-nums"
                    />
                  </div>
                ))}
                <select
                  aria-label={`${item.name} price is per`}
                  value={row.unit}
                  disabled={disabled}
                  onChange={event => set(key, 'unit', event.target.value as PriceUnit)}
                  className="col-span-2 h-9 rounded-control border border-rule bg-surface px-2.5 t-body text-ink sm:col-span-1"
                >
                  <option value="AGENCY">per agency</option>
                  <option value="AGENT">per agent</option>
                </select>
                <Input
                  aria-label={`${item.name} note`}
                  placeholder="Note shown under the price, for example the minutes it includes (optional)"
                  value={row.note}
                  maxLength={300}
                  disabled={disabled}
                  onChange={event => set(key, 'note', event.target.value)}
                  className="col-span-2 h-9 text-ink-2 sm:col-span-4"
                />
              </div>
            );
          })}
        </div>
        {invalid ? (
          <p className="mt-2 t-meta text-dropped-ink">
            A price is a dollar amount, like 99 or 249.50.
          </p>
        ) : null}
      </PanelBody>
    </Panel>
  );
}

/**
 * Upgrade requests: every agency's, open ones first. Done and Decline close
 * one by hand; turning the upgrade on for the agency closes it on its own.
 */
export function UpgradeRequestsPanel(): JSX.Element {
  const [rows, setRows] = useState<AdminUpgradeRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await apiClient.get<Envelope<AdminUpgradeRequest[]>>(
      '/api/v1/admin/upgrade-requests'
    );
    const data = payload(res);
    if (res.error || !Array.isArray(data)) {
      setError(res.error?.message ?? 'Could not read the upgrade requests.');
      return;
    }
    setError(null);
    setRows(data);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(row: AdminUpgradeRequest, status: 'DONE' | 'DECLINED'): Promise<void> {
    setBusy(row.id);
    try {
      const res = await apiClient.patch<Envelope<AdminUpgradeRequest>>(
        `/api/v1/admin/upgrade-requests/${row.id}`,
        { status }
      );
      if (res.error) {
        toast.error('Request not updated', res.error.message);
        return;
      }
      toast.success(
        status === 'DONE' ? 'Marked done' : 'Declined',
        `${row.upgradeName} for ${row.tenantName}`
      );
      await load();
    } finally {
      setBusy(null);
    }
  }

  const open = rows?.filter(row => row.status === 'OPEN').length ?? 0;

  return (
    <Panel className="min-w-0" data-upgrade-requests="">
      <PanelHeader>
        <PanelTitle>Upgrade requests</PanelTitle>
        <PanelDescription>
          {rows === null ? 'Loading' : open === 1 ? '1 open' : `${open} open`}. Turning an upgrade
          on for the agency marks its request done.
        </PanelDescription>
      </PanelHeader>
      <PanelBody>
        {error ? <p className="t-meta text-dropped-ink">{error}</p> : null}
        {rows !== null && rows.length === 0 ? (
          <p className="t-meta text-ink-3">No agency has asked for an upgrade yet.</p>
        ) : null}
        <ul className="flex flex-col divide-y divide-rule">
          {(rows ?? []).map(row => (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2"
              data-upgrade-request={row.id}
            >
              <div className="min-w-0">
                <div className="t-body text-ink">
                  {row.upgradeName} <span className="text-ink-3">for</span> {row.tenantName}
                </div>
                <div className="t-meta text-ink-3">
                  {`Asked ${formatDisplayDate(row.createdAt)}`}
                  {row.parentTenantId ? ' · a downline agency' : ''}
                </div>
              </div>
              {row.status === 'OPEN' ? (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() => void decide(row, 'DONE')}
                  >
                    Done
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() => void decide(row, 'DECLINED')}
                  >
                    Decline
                  </Button>
                </div>
              ) : (
                <StatusChip
                  value={row.status}
                  label={row.status === 'DONE' ? 'Done' : 'Declined'}
                  tone={row.status === 'DONE' ? 'live' : 'neutral'}
                  size="sm"
                />
              )}
            </li>
          ))}
        </ul>
      </PanelBody>
    </Panel>
  );
}
