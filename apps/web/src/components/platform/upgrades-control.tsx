'use client';

import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { WHITE_LABEL_UPGRADES } from '@/components/layout/nav-config';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { apiClient, payload } from '@/lib/api';
import type { Envelope } from '@/lib/api';

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
    <div className="flex flex-col gap-2 border-t border-rule pt-3" data-testid="upgrades-control">
      <span className="text-xs font-medium text-ink-2">Upgrades</span>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {WHITE_LABEL_UPGRADES.map(({ key, item }) => (
          <label
            key={key}
            className="flex items-center gap-2 text-xs text-ink-3"
            title={item.locked?.blurb}
          >
            <Switch
              checked={saved?.includes(key) === true}
              onCheckedChange={checked => void toggle(key, item.name, checked)}
              disabled={saved === null || saving !== null}
              aria-label={item.name}
              data-upgrade-switch={key}
            />
            {item.name}
            {saving === key ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          </label>
        ))}
      </div>
      {error ? <p className="text-[13px] text-ink-3">{error}</p> : null}
    </div>
  );
}
