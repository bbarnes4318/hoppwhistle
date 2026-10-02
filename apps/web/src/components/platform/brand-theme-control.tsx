'use client';

import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { apiClient, payload } from '@/lib/api';
import type { Envelope } from '@/lib/api';
import { BRAND_THEME_OPTIONS } from '@/lib/brand-themes';

import { SettingsField, SettingsSection, SettingsToggleRow, selectClass } from './settings-section';

interface Branding {
  tenantId: string;
  brandTheme: string | null;
  brandName: string | null;
  /** The white-label tier. Saved through the same route, audited the same way. */
  whiteLabel?: boolean;
  /**
   * The agency's own portal host (e.g. agents.lifeleadsplus.com), or null for
   * agents.netenroll.com. Its child agencies inherit it. Decides the login
   * page's brand on that host and the host every emailed link names; never
   * who is signed in.
   */
  domain?: string | null;
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
  const [savingTier, setSavingTier] = useState(false);
  const [domain, setDomain] = useState('');
  const [savingDomain, setSavingDomain] = useState(false);
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
        setDomain(branding.domain ?? '');
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, isPlatformAdmin]);

  if (!isPlatformAdmin) return null;

  const dirty = saved !== null && value !== (saved.brandTheme ?? DEFAULT_VALUE);
  const domainDirty = saved !== null && domain.trim() !== (saved.domain ?? '');

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

  /*
   * The white-label tier, saved the moment it is switched: it opens or closes
   * whole screens for the agency's OWNER and ADMIN -- Sales, the call network,
   * Payouts and their own downline -- so there is no half-edited state worth
   * holding in the form. Same route, same audit row as the theme.
   */
  async function saveTier(whiteLabel: boolean): Promise<void> {
    setSavingTier(true);
    try {
      const response = await apiClient.patch<Envelope<Branding>>(
        `/api/v1/admin/tenants/${tenantId}/branding`,
        { whiteLabel }
      );
      const branding = payload(response);
      if (response.error || !branding) {
        toast.error('Could not change the white-label tier', response.error?.message);
        return;
      }
      setSaved(current => (current ? { ...current, whiteLabel: branding.whiteLabel } : branding));
      toast.success(
        whiteLabel ? 'White-label tier on' : 'White-label tier off',
        `${agencyName}'s owners see the change on their next page load.`
      );
    } finally {
      setSavingTier(false);
    }
  }

  /*
   * The portal domain. Only set it once DNS, the certificate and the nginx
   * server block for the host are live (docs/WHITE_LABEL_DOMAIN.md): from the
   * moment it is saved, every invitation and reset link for this agency and
   * its child agencies names it.
   */
  async function saveDomain(): Promise<void> {
    setSavingDomain(true);
    try {
      const response = await apiClient.patch<Envelope<Branding>>(
        `/api/v1/admin/tenants/${tenantId}/branding`,
        { domain: domain.trim() || null }
      );
      const branding = payload(response);
      if (response.error || !branding) {
        toast.error('Could not change the portal domain', response.error?.message);
        return;
      }
      setSaved(current => (current ? { ...current, domain: branding.domain } : branding));
      setDomain(branding.domain ?? '');
      toast.success(
        'Portal domain saved',
        branding.domain
          ? `${agencyName}'s links now go to ${branding.domain}.`
          : `${agencyName}'s links now go to the default portal.`
      );
    } finally {
      setSavingDomain(false);
    }
  }

  return (
    <SettingsSection
      title="Brand and portal"
      description="How this agency's portal looks, and the address its people sign in on."
      data-testid="brand-control"
    >
      <SettingsToggleRow
        title="White-label tier"
        description="Opens Sales, the call network, Payouts and their own agencies for this agency's owner and admin."
      >
        {savingTier ? <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-3" /> : null}
        <Switch
          checked={saved?.whiteLabel === true}
          onCheckedChange={checked => void saveTier(checked)}
          disabled={saved === null || savingTier}
          aria-label="White-label tier"
          data-testid="white-label-switch"
        />
      </SettingsToggleRow>

      <SettingsField label="Brand theme" htmlFor="brand-theme">
        <div className="flex items-center gap-2">
          <select
            id="brand-theme"
            value={value}
            onChange={event => setValue(event.target.value)}
            disabled={saved === null || saving}
            className={selectClass}
            data-testid="brand-theme-select"
          >
            {BRAND_THEME_OPTIONS.map(option => (
              <option key={option.value ?? 'default'} value={option.value ?? DEFAULT_VALUE}>
                {option.label}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="outline"
            className="h-9 shrink-0"
            onClick={() => void save()}
            disabled={!dirty || saving}
          >
            {saving ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
            Save theme
          </Button>
        </div>
      </SettingsField>

      <SettingsField
        label="Portal domain"
        htmlFor="portal-domain"
        hint="Set this only once DNS, the certificate and the nginx server block are live. From the moment it is saved, every invitation and reset link for this agency and its downline names it."
      >
        <div className="flex items-center gap-2">
          <Input
            id="portal-domain"
            value={domain}
            onChange={event => setDomain(event.target.value)}
            disabled={saved === null || savingDomain}
            placeholder="agents.netenroll.com (default)"
            className="h-9"
            data-testid="portal-domain-input"
          />
          <Button
            size="sm"
            variant="outline"
            className="h-9 shrink-0"
            onClick={() => void saveDomain()}
            disabled={!domainDirty || savingDomain}
          >
            {savingDomain ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
            Save domain
          </Button>
        </div>
      </SettingsField>

      {error ? <p className="t-meta text-dropped-ink">{error}</p> : null}
    </SettingsSection>
  );
}
