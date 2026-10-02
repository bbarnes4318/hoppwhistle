'use client';

import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { WHITE_LABEL_UPGRADES } from '@/components/layout/nav-config';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { apiClient, payload } from '@/lib/api';
import type { Envelope } from '@/lib/api';

import { SettingsSection } from './settings-section';

interface TenantUpgrades {
  tenantId: string;
  upgrades: string[];
}

/**
 * "Upgrades": which paid features an agency has turned on.
 *
 * NetEnroll staff only, beside the white-label tier and the brand theme. The
 * route behind it (`PUT /api/v1/admin/tenants/:tenantId/upgrades`) refuses
 * everybody else and audits every change; the `isPlatformAdmin` check only
 * stops the control rendering for somebody who could not use it.
 *
 * Each switch saves the moment it is flipped, sending the whole list, so
 * there is no half-edited state. The agency sees the change on its next page
 * load: Power Dialer puts the CRM in a white-label owner's sidebar, and every
 * upgrade shows as on for the agency on its Upgrades page.
 */
export function UpgradesControl({
  tenantId,
  agencyName,
}: {
  tenantId: string;
  agencyName: string;
}): JSX.Element | null {
  const { isPlatformAdmin } = useAuth();
  const [saved, setSaved] = useState<string[] | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isPlatformAdmin) return;
    let cancelled = false;
    setSaved(null);
    setError(null);
    void apiClient
      .get<Envelope<TenantUpgrades>>(`/api/v1/admin/tenants/${tenantId}/upgrades`)
      .then(response => {
        if (cancelled) return;
        const data = payload(response);
        if (response.error || !data) {
          setError(response.error?.message ?? 'Could not read this agency’s upgrades.');
          return;
        }
        setSaved(data.upgrades);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, isPlatformAdmin]);

  if (!isPlatformAdmin) return null;

  async function toggle(key: string, name: string, on: boolean): Promise<void> {
    if (saved === null) return;
    const next = on ? [...saved, key] : saved.filter(existing => existing !== key);
    setSaving(key);
    try {
      const response = await apiClient.put<Envelope<TenantUpgrades>>(
        `/api/v1/admin/tenants/${tenantId}/upgrades`,
        { upgrades: next }
      );
      const data = payload(response);
      if (response.error || !data) {
        toast.error(`Could not turn ${name} ${on ? 'on' : 'off'}`, response.error?.message);
        return;
      }
      setSaved(data.upgrades);
      toast.success(
        `${name} ${on ? 'on' : 'off'}`,
        `${agencyName} sees the change on their next page load.`
      );
    } finally {
      setSaving(null);
    }
  }

  return (
    <SettingsSection
      title="Upgrades"
      description="Paid features this agency has turned on. Each switch saves as you flip it."
      data-testid="upgrades-control"
    >
      <UpgradeSwitches
        value={saved}
        saving={saving}
        onToggle={(key, name, on) => void toggle(key, name, on)}
      />
      {error ? <p className="t-meta text-dropped-ink">{error}</p> : null}
    </SettingsSection>
  );
}

/**
 * The upgrade switches, one per upgrade,, and nothing about where they save.
 *
 * Shared by this control (NetEnroll staff, any agency) and a white-label
 * parent's Agencies screen (its own downline, through
 * `PUT /api/v1/network/agencies/:tenantId/settings`), so the two cannot offer
 * different upgrades or name them differently. `value` null means "not loaded
 * yet", and every switch is disabled until it is.
 */
export function UpgradeSwitches({
  value,
  saving,
  onToggle,
  disabled = false,
}: {
  value: readonly string[] | null;
  saving: string | null;
  onToggle: (key: string, name: string, on: boolean) => void;
  disabled?: boolean;
}): JSX.Element {
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {WHITE_LABEL_UPGRADES.map(({ key, item }) => (
        <li key={key}>
          <label
            className="flex items-center justify-between gap-3 rounded-control border border-rule bg-surface px-3 py-2.5"
            title={item.locked?.blurb}
          >
            <span className="flex min-w-0 items-center gap-2 t-body text-ink">
              <span className="truncate">{item.name}</span>
              {saving === key ? <Loader2 className="h-3 w-3 animate-spin text-ink-3" /> : null}
            </span>
            <Switch
              checked={value?.includes(key) === true}
              onCheckedChange={checked => onToggle(key, item.name, checked)}
              disabled={disabled || value === null || saving !== null}
              aria-label={item.name}
              data-upgrade-switch={key}
            />
          </label>
        </li>
      ))}
    </ul>
  );
}
