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
  type UpgradePriceRow,
} from '@/lib/upgrade-catalog';

type Draft = Record<string, { monthly: string; setup: string }>;

function draftFrom(rows: UpgradePriceRow[]): Draft {
  return Object.fromEntries(
    rows.map(row => [
      row.key,
      { monthly: dollarsFromCents(row.monthlyCents), setup: dollarsFromCents(row.setupCents) },
    ])
  );
}

/**
 * Upgrade prices: NetEnroll's monthly and setup price for each upgrade, in
 * dollars, as agencies read them on /upgrades. Empty means "Ask for pricing".
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

  const set = (key: string, field: 'monthly' | 'setup', value: string) =>
    setDraft(current => ({
      ...current,
      [key]: { ...(current[key] ?? { monthly: '', setup: '' }), [field]: value },
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
          In dollars. Leave a price empty and agencies read &ldquo;Ask for pricing&rdquo;.
        </PanelDescription>
      </PanelHeader>
      <PanelBody>
        {error ? <p className="t-meta text-dropped-ink">{error}</p> : null}
        <div className="grid grid-cols-[minmax(0,1fr)_7rem_7rem] items-center gap-x-3 gap-y-2">
          <span className="t-label text-ink-3">Upgrade</span>
          <span className="t-label text-ink-3">Monthly</span>
          <span className="t-label text-ink-3">Setup</span>
          {WHITE_LABEL_UPGRADES.map(({ key, item }) => {
            const row = draft[key] ?? { monthly: '', setup: '' };
            return (
              <div key={key} className="contents" data-upgrade-price-row={key}>
                <span className="truncate t-body text-ink">{item.name}</span>
                {(['monthly', 'setup'] as const).map(field => (
                  <Input
                    key={field}
                    aria-label={`${item.name} ${field === 'monthly' ? 'monthly' : 'setup'} price`}
                    inputMode="decimal"
                    placeholder="—"
                    value={row[field]}
                    disabled={saved === null || busy}
                    aria-invalid={centsFromDollars(row[field]) === undefined}
                    onChange={event => set(key, field, event.target.value)}
                    className="h-8"
                  />
                ))}
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
