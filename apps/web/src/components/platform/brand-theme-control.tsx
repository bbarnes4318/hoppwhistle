'use client';

import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { apiClient, payload } from '@/lib/api';
import type { Envelope } from '@/lib/api';
import { BRAND_THEME_OPTIONS } from '@/lib/brand-themes';

interface Branding {
  tenantId: string;
  brandTheme: string | null;
  brandName: string | null;
}

/** The select's value for "no theme". A <select> cannot hold null. */
const DEFAULT_VALUE = '';

/**
 * "Brand theme": which agency brand an agency's portal is drawn in.
 *
 * NetEnroll staff only. The route behind it refuses everybody else -- an
 * agency's own OWNER and ADMIN included -- so this is not the guard; the
 * `isPlatformAdmin` check only stops the control rendering for somebody who
 * could not use it. Every change is audited on the server.
 *
 * The change is seen by the agency's users on their next page load, and by an
 * operator inside the agency on theirs.
 */
export function BrandThemeControl({
  tenantId,
  agencyName,
}: {
  tenantId: string;
  agencyName: string;
}): JSX.Element | null {
  const { isPlatformAdmin } = useAuth();
  const [saved, setSaved] = useState<Branding | null>(null);
  const [value, setValue] = useState(DEFAULT_VALUE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isPlatformAdmin) return;
    let cancelled = false;
    setSaved(null);
    setError(null);
    void apiClient
      .get<Envelope<Branding>>(`/api/v1/admin/tenants/${tenantId}/branding`)
      .then(response => {
        if (cancelled) return;
        const branding = payload(response);
        if (response.error || !branding) {
          setError(response.error?.message ?? 'Could not read this agency’s brand theme.');
          return;
        }
        setSaved(branding);
        setValue(branding.brandTheme ?? DEFAULT_VALUE);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, isPlatformAdmin]);

  if (!isPlatformAdmin) return null;

  const dirty = saved !== null && value !== (saved.brandTheme ?? DEFAULT_VALUE);

  async function save(): Promise<void> {
    setSaving(true);
    try {
      const brandTheme = value === DEFAULT_VALUE ? null : value;
      const response = await apiClient.patch<Envelope<Branding>>(
        `/api/v1/admin/tenants/${tenantId}/branding`,
        { brandTheme }
      );
      const branding = payload(response);
      if (response.error || !branding) {
        toast.error('Could not change the brand theme', response.error?.message);
        return;
      }
      setSaved(branding);
      setValue(branding.brandTheme ?? DEFAULT_VALUE);
      toast.success('Brand theme saved', `${agencyName} will see it on their next page load.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-3 border-t border-rule pt-3 text-sm">
      <label className="text-xs text-ink-3">
        Brand theme
        <select
          value={value}
          onChange={event => setValue(event.target.value)}
          disabled={saved === null || saving}
          className="mt-1 block h-8 rounded-control border border-rule bg-surface px-2 text-sm text-ink"
          data-testid="brand-theme-select"
        >
          {BRAND_THEME_OPTIONS.map(option => (
            <option key={option.value ?? 'default'} value={option.value ?? DEFAULT_VALUE}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <Button size="sm" onClick={() => void save()} disabled={!dirty || saving}>
        {saving ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
        Save brand theme
      </Button>
      {error ? <p className="text-[13px] text-ink-3">{error}</p> : null}
    </div>
  );
}
