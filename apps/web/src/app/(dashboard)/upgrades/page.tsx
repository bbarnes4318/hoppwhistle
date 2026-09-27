'use client';

import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { Notice, Panel, PanelBody, StatusChip } from '@/components/domain';
import { WHITE_LABEL_UPGRADES } from '@/components/layout/nav-config';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { apiClient, payload } from '@/lib/api';
import type { Envelope } from '@/lib/api';
import {
  upgradePriceLine,
  type UpgradeCatalogMeta,
  type UpgradeCatalogRow,
} from '@/lib/upgrade-catalog';

/**
 * Upgrades: what an agency can have turned on, what each costs, and a button
 * to ask for it.
 *
 * The catalog, prices and which are on or asked for come from
 * `GET /api/v1/upgrades`; the names, icons and blurbs from
 * WHITE_LABEL_UPGRADES, so they match the switches staff and a parent flip.
 * "Request this upgrade" does not turn anything on: it records the request and
 * emails whoever can (NetEnroll, or the agency above a downline agency), and
 * the card then reads "Requested" until it is. A downline's page names its
 * parent agency, since that is who receives the request and sets it up.
 */
export default function UpgradesPage(): JSX.Element {
  const { upgrades: sessionUpgrades } = useAuth();
  const [catalog, setCatalog] = useState<Record<string, UpgradeCatalogRow> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  // A downline's parent agency: its owners receive the requests, not NetEnroll.
  const [parentName, setParentName] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await apiClient.get<
      Envelope<UpgradeCatalogRow[]> & { meta?: UpgradeCatalogMeta }
    >('/api/v1/upgrades');
    const rows = payload(response);
    setParentName(response.data?.meta?.parentTenantName ?? null);
    if (response.error || !Array.isArray(rows)) {
      setError(response.error?.message ?? 'Could not read the upgrades.');
      return;
    }
    setError(null);
    setCatalog(Object.fromEntries(rows.map(row => [row.key, row])));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function request(key: string): Promise<void> {
    setSending(key);
    try {
      const response = await apiClient.post<Envelope<{ id: string; status: string }>>(
        `/api/v1/upgrades/${key}/request`,
        // An empty object, not no body: see the applications page.
        {}
      );
      if (response.error) {
        toast.error('The request was not sent', response.error.message);
        return;
      }
      toast.success(
        parentName
          ? `Request sent to your agency's account manager at ${parentName}.`
          : "Request sent. We'll be in touch to set it up."
      );
      setCatalog(current =>
        current && current[key]
          ? { ...current, [key]: { ...current[key], requestOpen: true } }
          : current
      );
    } finally {
      setSending(null);
    }
  }

  return (
    <div className="page-canvas">
      <PageHeader
        description="Features you can add to your agency, and what they cost."
        meta={
          parentName ? (
            <span className="t-meta text-ink-3" data-upgrade-contact="parent">
              {`Your agency's account manager at ${parentName} sets these up for you.`}
            </span>
          ) : null
        }
      />
      {error ? <Notice tone="error" title={error} /> : null}
      <section
        className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
        aria-label="Upgrades"
      >
        {WHITE_LABEL_UPGRADES.map(({ key, item, note, badge }) => {
          const Icon = item.icon;
          const row = catalog?.[key] ?? null;
          // The session knows what is on before the catalog has loaded.
          const on = row ? row.on : sessionUpgrades.includes(key);
          const requested = row?.requestOpen === true;
          return (
            <Panel key={key} data-upgrade={key}>
              <PanelBody className="flex h-full flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-brand-tint text-brand-ink">
                    <Icon className="h-4 w-4" />
                  </span>
                  {on ? <StatusChip value="ACTIVE" label="On" tone="live" size="sm" /> : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="t-title text-ink">{item.name}</h2>
                  {badge ? (
                    <StatusChip value="EARLY_ACCESS" label={badge} tone="neutral" size="sm" />
                  ) : null}
                </div>
                <p className="t-body text-ink-2">{item.locked?.blurb}</p>
                {note ? <p className="t-body text-ink-2">{note}</p> : null}
                <div className="mt-auto">
                  <p className="t-meta tabular-nums text-ink" data-upgrade-price={key}>
                    {row ? upgradePriceLine(row) : ' '}
                  </p>
                  {row?.usageNote ? (
                    <p className="t-meta text-ink-3" data-upgrade-note={key}>
                      {row.usageNote}
                    </p>
                  ) : null}
                </div>
                {on ? (
                  <>
                    <p className="t-meta text-ink-3">Turned on for your agency.</p>
                    {key === 'POWER_DIALER' ? (
                      <div className="flex flex-wrap gap-3 t-meta">
                        <Link href="/call-center" className="text-brand-ink hover:underline">
                          Open the Power Dialer
                        </Link>
                      </div>
                    ) : null}
                  </>
                ) : requested ? (
                  <Button size="sm" variant="outline" className="self-start" disabled>
                    Requested
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="self-start"
                    disabled={!row || sending !== null}
                    onClick={() => void request(key)}
                  >
                    {sending === key ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : null}
                    Request this upgrade
                  </Button>
                )}
              </PanelBody>
            </Panel>
          );
        })}
      </section>
    </div>
  );
}
