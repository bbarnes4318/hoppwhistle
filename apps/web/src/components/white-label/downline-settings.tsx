'use client';

import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { UpgradeSwitches } from '@/components/platform/upgrades-control';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/use-toast';
import type { NetworkAgencyRow, NetworkAgencySettings } from '@/components/white-label/types';
import { apiClient, payload } from '@/lib/api';
import type { Envelope } from '@/lib/api';

/**
 * What a white-label parent sets for one of its downline agencies: how many
 * phone numbers it may hold, and which upgrades it has.
 *
 * Read from `GET /api/v1/network/agencies/:tenantId/settings` (the agencies
 * list itself is aggregates only) and saved through the PUT at the same path;
 * both accept only the parent's own children. The upgrade switches are the same
 * component NetEnroll staff use on Admin → Agencies, so a parent is offered
 * exactly the upgrades staff are, named the same way. Each switch saves when
 * flipped; the numbers limit saves on its button.
 */
export function DownlineSettings({
  agency,
  onSaved,
}: {
  agency: Pick<NetworkAgencyRow, 'tenantId' | 'name'>;
  /** Called after each successful save, e.g. to re-read the open requests it closes. */
  onSaved?: (settings: NetworkAgencySettings) => void;
}): JSX.Element {
  // Null until the settings have loaded; every control is disabled until then.
  const [upgrades, setUpgrades] = useState<string[] | null>(null);
  const [limit, setLimit] = useState<number | null>(null);
  const [used, setUsed] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  function adopt(data: NetworkAgencySettings): void {
    const nextLimit = typeof data.numbersLimit === 'number' ? data.numbersLimit : null;
    setUpgrades(Array.isArray(data.upgrades) ? data.upgrades : []);
    setLimit(nextLimit);
    setDraft(nextLimit === null ? '' : String(nextLimit));
    if (typeof data.numbersUsed === 'number') setUsed(data.numbersUsed);
  }

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    void apiClient
      .get<Envelope<NetworkAgencySettings>>(`/api/v1/network/agencies/${agency.tenantId}/settings`)
      .then(response => {
        if (cancelled) return;
        const data = payload(response);
        if (response.error || !data) {
          setLoadError(response.error?.message ?? 'Could not read this agency’s settings.');
          return;
        }
        adopt(data);
      });
    return () => {
      cancelled = true;
    };
  }, [agency.tenantId]);

  async function save(
    body: { maxPhoneNumbers?: number; upgrades?: string[] },
    savingKey: string
  ): Promise<NetworkAgencySettings | null> {
    setSaving(savingKey);
    try {
      const response = await apiClient.put<Envelope<NetworkAgencySettings>>(
        `/api/v1/network/agencies/${agency.tenantId}/settings`,
        body
      );
      const data = payload(response);
      if (response.error || !data) {
        toast.error(`Could not save ${agency.name}`, response.error?.message);
        return null;
      }
      adopt(data);
      onSaved?.(data);
      return data;
    } finally {
      setSaving(null);
    }
  }

  const parsed = draft.trim() === '' ? null : Number(draft);
  const draftValid = parsed !== null && Number.isInteger(parsed) && parsed >= 0;
  const changed = draftValid && parsed !== limit;

  return (
    <div className="flex flex-col gap-6" data-downline-settings={agency.tenantId}>
      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="t-label text-ink-2">Phone numbers</h3>
          {used !== null ? (
            <span className="t-meta tabular-nums text-ink-3">{`${used} in use`}</span>
          ) : null}
        </div>
        <div className="flex max-w-sm flex-col gap-1.5">
          <label htmlFor={`numbers-limit-${agency.tenantId}`} className="t-meta text-ink-3">
            Numbers limit
          </label>
          <div className="flex items-center gap-2">
            <Input
              id={`numbers-limit-${agency.tenantId}`}
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={draft}
              onChange={event => setDraft(event.target.value)}
              className="h-9 w-28"
              disabled={upgrades === null || saving !== null}
            />
            <Button
              size="sm"
              variant="outline"
              className="h-9"
              disabled={upgrades === null || !changed || saving !== null}
              onClick={() => {
                if (parsed === null) return;
                void save({ maxPhoneNumbers: parsed }, 'numbers').then(data => {
                  if (data) toast.success('Numbers limit saved', `${agency.name}: ${parsed}`);
                });
              }}
            >
              {saving === 'numbers' ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
              Save limit
            </Button>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3 border-t border-rule pt-5">
        <div>
          <h3 className="t-label text-ink-2">Upgrades</h3>
          <p className="t-meta mt-1 text-ink-3">
            Each switch saves as you flip it. The agency sees the change on its next page load.
          </p>
        </div>
        <UpgradeSwitches
          value={upgrades}
          saving={saving}
          onToggle={(key, name, on) => {
            if (upgrades === null) return;
            const next = on ? [...upgrades, key] : upgrades.filter(existing => existing !== key);
            void save({ upgrades: next }, key).then(data => {
              if (data) {
                toast.success(
                  `${name} ${on ? 'on' : 'off'}`,
                  `${agency.name} sees the change on their next page load.`
                );
              }
            });
          }}
        />
      </section>
      {loadError ? <p className="t-meta text-dropped-ink">{loadError}</p> : null}
    </div>
  );
}
